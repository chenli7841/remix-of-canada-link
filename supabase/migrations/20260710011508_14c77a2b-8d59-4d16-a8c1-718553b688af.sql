-- personal_freight_override / business_freight_override let a product override the route's
-- weight_mode/divisor/unit_price/min_charge/extra_fee/insurance_rate_pct. Since the pooled
-- per-route-group freight rewrite (20260710002418), the actually-charged freight total is
-- always computed from the route's own freight_rules (g_rule) — per-product overrides for
-- weight_mode/divisor/unit_price/min_charge/extra_fee stopped affecting the real total and
-- only leaked into the per-line display numbers, which was misleading. Insurance is the only
-- sub-field still summed per-line, so keeping the override machinery around just for that one
-- field isn't worth the inconsistency. Drop both columns and always read freight params
-- straight off the route's freight_rules.
CREATE OR REPLACE FUNCTION public._compute_line_quote(_product products, _route shipping_routes, _rule freight_rules, _customs customs_rules, _qty integer, _mode text DEFAULT 'personal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  weight_mode text; divisor numeric; unit_price numeric;
  min_charge numeric; extra_fee numeric; ins_pct numeric;
  L numeric; W numeric; H numeric; kg numeric; units numeric;
  aw numeric; vw numeric; cw numeric;
  subtotal numeric; line_freight numeric; line_ins numeric; line_customs numeric;
  total_customs_rate numeric;
  fx_cad_cny numeric;
  last_mile_cny numeric;
  is_business boolean;
  per_unit_cny numeric;
  pack_qty int;
BEGIN
  is_business := (_mode = 'business');

  weight_mode := COALESCE(_rule.weight_mode, 'max');
  divisor     := COALESCE(_rule.volumetric_divisor, 6000);
  unit_price  := COALESCE(_rule.unit_price_cny, 0);
  min_charge  := COALESCE(_rule.min_charge_cny, 0);
  extra_fee   := COALESCE(_rule.extra_fee_cny, 0);
  ins_pct     := COALESCE(_rule.insurance_rate_pct, 0);

  subtotal := _product.price_cny * _qty;
  pack_qty := GREATEST(COALESCE(_product.pack_qty,1),1);
  units := ceil(_qty::numeric / pack_qty);
  L := COALESCE(_product.pack_length_cm, _product.length_cm, 0);
  W := COALESCE(_product.pack_width_cm,  _product.width_cm,  0);
  H := COALESCE(_product.pack_height_cm, _product.height_cm, 0);
  kg := COALESCE(_product.pack_weight_kg, _product.weight_kg, 0);
  aw := kg * units;
  vw := CASE WHEN divisor > 0 THEN (L * W * H * units) / divisor ELSE 0 END;
  cw := CASE weight_mode WHEN 'actual' THEN aw WHEN 'volumetric' THEN vw ELSE GREATEST(aw, vw) END;

  -- Customs = subtotal × (MFN + GST + anti-dumping), per product, regardless of personal/business.
  total_customs_rate := COALESCE(_product.customs_mfn_rate,0) + COALESCE(_product.customs_gst_rate,0) + COALESCE(_product.customs_antidumping_rate,0);
  line_customs := round(subtotal * total_customs_rate, 2);

  IF is_business THEN
    -- Business: package weight/volume × route rules → chargeable weight per box,
    -- already scaled by box count above (aw/vw carry the × units factor).
    line_freight := GREATEST(round(cw * unit_price, 2), min_charge) + extra_fee;
    SELECT COALESCE((value->>'rate')::numeric, 5.26) INTO fx_cad_cny
      FROM public.app_settings WHERE key = 'fx_cad_to_cny';
    last_mile_cny := round(COALESCE(_product.last_mile_fee_cad,0) * COALESCE(fx_cad_cny,5.26), 2);
    line_freight := line_freight + last_mile_cny;
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
      -- Personal items ship individually — use the item's own weight/dimensions (not the
      -- bulk pack_* fields) for chargeable weight, and multiply by quantity directly
      -- (no box rounding).
      aw := COALESCE(_product.weight_kg, 0) * _qty;
      vw := CASE WHEN divisor > 0 THEN (COALESCE(_product.length_cm,0) * COALESCE(_product.width_cm,0) * COALESCE(_product.height_cm,0) * _qty) / divisor ELSE 0 END;
      cw := CASE weight_mode WHEN 'actual' THEN aw WHEN 'volumetric' THEN vw ELSE GREATEST(aw, vw) END;
      units := _qty;
      line_freight := GREATEST(round(cw * unit_price, 2), min_charge) + extra_fee;
    END IF;
    last_mile_cny := 0;
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
    'last_mile_cny', last_mile_cny,
    'insurance_cny', line_ins,
    'customs_cny', line_customs,
    'extra_cny', extra_fee
  );
END $function$;

ALTER TABLE public.products
  DROP COLUMN IF EXISTS personal_freight_override,
  DROP COLUMN IF EXISTS business_freight_override;
