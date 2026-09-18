CREATE OR REPLACE FUNCTION public.quote_shop_order(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_route shipping_routes; v_rule freight_rules; v_customs customs_rules;
  it jsonb; v_product products; v_variant product_variants; v_qty int; v_mode text; v_default_mode text;
  v_method text; v_route_code text;
  v_lines jsonb := '[]'::jsonb; v_line jsonb;
  s_sub numeric := 0; s_ins numeric := 0; s_customs numeric := 0; s_freight numeric := 0;
  v_coupon jsonb; v_disc numeric := 0;
  v_routes_used jsonb := '[]'::jsonb;
  v_groups jsonb := '{}'::jsonb;
  v_group_key text; v_group jsonb;
  v_route_keys text[];
  g_rule freight_rules; g_route shipping_routes;
  g_aw numeric; g_vw numeric; g_cw numeric; g_flat numeric; g_last_mile numeric;
  g_line jsonb; g_mode text;
  g_unit numeric; g_min numeric; cny_per_cad numeric;
BEGIN
  v_default_mode := COALESCE(_payload->>'mode', 'personal');
  v_method := _payload->>'shipping_method';
  cny_per_cad := COALESCE(NULLIF((SELECT (value->>'cny_per_cad')::numeric FROM public.app_settings WHERE key = 'fx_rate'), 0), 5.26);

  FOR it IN SELECT jsonb_array_elements(_payload->'items') LOOP
    SELECT * INTO v_product FROM public.products
      WHERE slug = it->>'slug' AND status = 'active';
    IF v_product IS NULL THEN CONTINUE; END IF;

    v_variant := NULL;
    IF COALESCE(it->>'variant_id','') <> '' THEN
      SELECT * INTO v_variant FROM public.product_variants
        WHERE id = (it->>'variant_id')::uuid AND product_id = v_product.id AND is_active = true;
    END IF;

    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_mode := COALESCE(it->>'mode', v_default_mode);
    IF v_mode = 'business' AND NOT v_product.allow_business THEN v_mode := 'personal'; END IF;
    IF v_mode = 'personal' AND NOT v_product.allow_personal THEN v_mode := 'business'; END IF;

    IF v_mode = 'business' AND v_qty < COALESCE(v_product.moq,1) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'below_moq',
        'slug', v_product.slug, 'moq', v_product.moq);
    END IF;

    IF COALESCE(_payload->>'route_code','') <> '' THEN
      v_route_code := _payload->>'route_code';
    ELSIF v_method IS NOT NULL THEN
      v_route_code := public._product_route_code(v_product, v_mode, v_method);
    ELSE
      v_route_code := NULL;
    END IF;

    IF v_route_code IS NULL OR v_route_code = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no_route_for_product',
        'slug', v_product.slug, 'mode', v_mode, 'method', v_method);
    END IF;

    SELECT * INTO v_route FROM public.shipping_routes
      WHERE code = v_route_code AND is_active = true;
    IF v_route IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'route_unavailable',
        'slug', v_product.slug, 'route_code', v_route_code);
    END IF;

    SELECT * INTO v_rule FROM public.freight_rules
      WHERE route_id = v_route.id AND is_active = true
      ORDER BY created_at DESC LIMIT 1;
    SELECT * INTO v_customs FROM public.customs_rules WHERE route_id = v_route.id LIMIT 1;

    v_line := public._compute_line_quote(v_product, v_route, v_rule, v_customs, v_qty, v_mode, v_variant)
              || jsonb_build_object('route_code', v_route.code, 'mode', v_mode,
                                    'destination_code', v_route.destination_code,
                                    'shipping_method', v_route.shipping_method,
                                    'personal_freight_mode', v_product.personal_freight_mode);
    v_lines := v_lines || v_line;

    IF NOT (v_routes_used @> jsonb_build_array(v_route.code)) THEN
      v_routes_used := v_routes_used || to_jsonb(v_route.code);
    END IF;

    s_sub     := s_sub     + (v_line->>'subtotal_cny')::numeric;
    s_ins     := s_ins     + (v_line->>'insurance_cny')::numeric;
    s_customs := s_customs + (v_line->>'customs_cny')::numeric;

    v_group_key := v_route.code;
    v_group := COALESCE(v_groups->v_group_key, jsonb_build_object('lines', '[]'::jsonb));
    v_group := jsonb_set(v_group, '{lines}', (v_group->'lines') || v_line);
    v_groups := jsonb_set(v_groups, ARRAY[v_group_key], v_group, true);
  END LOOP;

  SELECT array_agg(k) INTO v_route_keys FROM jsonb_object_keys(v_groups) k;
  FOREACH v_group_key IN ARRAY COALESCE(v_route_keys, ARRAY[]::text[]) LOOP
    v_group := v_groups->v_group_key;
    SELECT * INTO g_route FROM public.shipping_routes WHERE code = v_group_key AND is_active = true;
    SELECT * INTO g_rule FROM public.freight_rules
      WHERE route_id = g_route.id AND is_active = true ORDER BY created_at DESC LIMIT 1;
    g_unit := COALESCE(NULLIF(g_rule.unit_price_cny, 0), COALESCE(g_rule.unit_price_cad, 0) * cny_per_cad, 0);
    g_min  := COALESCE(NULLIF(g_rule.min_charge_cny, 0), COALESCE(g_rule.min_charge_cad, 0) * cny_per_cad, 0);
    g_aw := 0; g_vw := 0; g_flat := 0; g_last_mile := 0;
    FOR g_line IN SELECT jsonb_array_elements(v_group->'lines') LOOP
      g_last_mile := g_last_mile + COALESCE((g_line->>'last_mile_cny')::numeric, 0);
      g_mode := g_line->>'mode';
      IF g_mode = 'personal' AND (g_line->>'personal_freight_mode') = 'per_unit' THEN
        g_flat := g_flat + (g_line->>'freight_cny')::numeric - COALESCE((g_line->>'last_mile_cny')::numeric, 0);
      ELSE
        g_aw := g_aw + COALESCE((g_line->>'actual_kg')::numeric, 0);
        g_vw := g_vw + COALESCE((g_line->>'volumetric_kg')::numeric, 0);
      END IF;
    END LOOP;
    g_cw := CASE COALESCE(g_rule.weight_mode,'max')
              WHEN 'actual' THEN g_aw WHEN 'volumetric' THEN g_vw ELSE GREATEST(g_aw, g_vw) END;
    IF g_cw > 0 OR g_flat > 0 OR g_last_mile > 0 THEN
      s_freight := s_freight
        + CASE WHEN g_cw > 0 THEN GREATEST(round(g_cw * g_unit, 2), g_min) + COALESCE(g_rule.extra_fee_cny, 0) ELSE 0 END
        + g_flat + g_last_mile;
    END IF;
  END LOOP;

  IF _payload ? 'coupon_code' AND COALESCE(_payload->>'coupon_code','') <> '' THEN
    v_coupon := public.validate_coupon(_payload->>'coupon_code', s_sub);
    IF (v_coupon->>'ok')::boolean THEN
      v_disc := (v_coupon->>'discount_cny')::numeric;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'shipping_method', v_method,
    'routes_used', v_routes_used,
    'subtotal_cny', s_sub,
    'freight_cny', s_freight,
    'insurance_cny', s_ins,
    'customs_cny', s_customs,
    'discount_cny', v_disc,
    'coupon', v_coupon,
    'shipping_total_cny', s_freight + s_ins + s_customs,
    'total_cny', GREATEST(s_sub + s_freight + s_ins + s_customs - v_disc, 0),
    'lines', v_lines,
    'has_freight_rule', true
  );
END $function$;

REVOKE ALL ON FUNCTION public.quote_shop_order(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_shop_order(jsonb) TO authenticated, anon, service_role;