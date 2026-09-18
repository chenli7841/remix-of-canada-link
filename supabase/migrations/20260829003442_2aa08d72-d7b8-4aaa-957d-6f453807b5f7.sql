CREATE OR REPLACE FUNCTION public._compute_line_quote(_product products, _route shipping_routes, _rule freight_rules, _customs customs_rules, _qty integer, _mode text DEFAULT 'personal', _variant product_variants DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  weight_mode text; divisor numeric; unit_price numeric;
  min_charge numeric; extra_fee numeric; ins_pct numeric;
  L numeric; W numeric; H numeric; kg numeric; units numeric;
  aw numeric; vw numeric; cw numeric;
  subtotal numeric; line_freight numeric; line_ins numeric; line_customs numeric;
  total_customs_rate numeric;
  is_business boolean;
  per_unit_cny numeric;
  pack_qty int;
  unit_price_cny numeric;
  cny_per_cad numeric;
BEGIN
  is_business := (_mode = 'business');

  cny_per_cad := COALESCE(NULLIF((SELECT (value->>'cny_per_cad')::numeric FROM public.app_settings WHERE key = 'fx_rate'), 0), 5.26);

  weight_mode := COALESCE(_rule.weight_mode, 'max');
  divisor     := COALESCE(_rule.volumetric_divisor, 6000);
  -- Rates may be configured in CNY or CAD; fall back to the CAD column converted at the
  -- current FX rate so a CAD-only rule doesn't quote 0 freight.
  unit_price  := COALESCE(NULLIF(_rule.unit_price_cny, 0), COALESCE(_rule.unit_price_cad, 0) * cny_per_cad, 0);
  min_charge  := COALESCE(NULLIF(_rule.min_charge_cny, 0), COALESCE(_rule.min_charge_cad, 0) * cny_per_cad, 0);
  extra_fee   := COALESCE(_rule.extra_fee_cny, 0);
  ins_pct     := COALESCE(_rule.insurance_rate_pct, 0);

  unit_price_cny := COALESCE(_variant.price_cny, _product.price_cny);
  subtotal := unit_price_cny * _qty;

  pack_qty := GREATEST(COALESCE(_variant.pack_qty, _product.pack_qty, 1), 1);
  units := ceil(_qty::numeric / pack_qty);
  L := COALESCE(_variant.pack_length_cm, _product.pack_length_cm, _variant.length_cm, _product.length_cm, 0);
  W := COALESCE(_variant.pack_width_cm,  _product.pack_width_cm,  _variant.width_cm,  _product.width_cm,  0);
  H := COALESCE(_variant.pack_height_cm, _product.pack_height_cm, _variant.height_cm, _product.height_cm, 0);
  kg := COALESCE(_variant.pack_weight_kg, _product.pack_weight_kg, _variant.weight_kg, _product.weight_kg, 0);
  aw := kg * units;
  vw := CASE WHEN divisor > 0 THEN (L * W * H * units) / divisor ELSE 0 END;
  cw := CASE weight_mode WHEN 'actual' THEN aw WHEN 'volumetric' THEN vw ELSE GREATEST(aw, vw) END;

  total_customs_rate := COALESCE(_product.customs_mfn_rate,0) + COALESCE(_product.customs_gst_rate,0) + COALESCE(_product.customs_antidumping_rate,0);
  line_customs := round(subtotal * total_customs_rate, 2);

  IF is_business THEN
    line_freight := GREATEST(round(cw * unit_price, 2), min_charge) + extra_fee;
  ELSE
    IF _product.personal_freight_mode = 'per_unit' THEN
      per_unit_cny := CASE
        WHEN _route.shipping_method = 'sea' AND COALESCE(_product.personal_per_unit_freight_sea_cny,0) > 0
          THEN _product.personal_per_unit_freight_sea_cny
        WHEN _route.shipping_method = 'air' AND COALESCE(_product.personal_per_unit_freight_air_cny,0) > 0
          THEN _product.personal_per_unit_freight_air_cny
        ELSE COALESCE(_product.personal_per_unit_freight_cny, 0)
      END;
      line_freight := round(_qty * per_unit_cny, 2);
    ELSE
      aw := COALESCE(_variant.weight_kg, _product.weight_kg, 0) * _qty;
      vw := CASE WHEN divisor > 0 THEN (
              COALESCE(_variant.length_cm, _product.length_cm, 0) *
              COALESCE(_variant.width_cm,  _product.width_cm,  0) *
              COALESCE(_variant.height_cm, _product.height_cm, 0) * _qty
            ) / divisor ELSE 0 END;
      cw := CASE weight_mode WHEN 'actual' THEN aw WHEN 'volumetric' THEN vw ELSE GREATEST(aw, vw) END;
      units := _qty;
      line_freight := GREATEST(round(cw * unit_price, 2), min_charge) + extra_fee;
    END IF;
  END IF;

  line_ins := round(subtotal * ins_pct / 100.0, 2);

  RETURN jsonb_build_object(
    'slug', _product.slug,
    'mode', _mode,
    'route_code', _route.code,
    'units', units,
    'chargeable_kg', round(cw, 3),
    'actual_kg', round(aw,3),
    'volumetric_kg', round(vw,3),
    'subtotal_cny', subtotal,
    'freight_cny', line_freight,
    'last_mile_cny', 0,
    'insurance_cny', line_ins,
    'customs_cny', line_customs,
    'extra_cny', extra_fee,
    'variant_id', _variant.id,
    'sku', COALESCE(_variant.sku, _product.sku)
  );
END $$;

REVOKE ALL ON FUNCTION public._compute_line_quote(products, shipping_routes, freight_rules, customs_rules, integer, text, product_variants) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._compute_line_quote(products, shipping_routes, freight_rules, customs_rules, integer, text, product_variants) TO authenticated, anon, service_role;