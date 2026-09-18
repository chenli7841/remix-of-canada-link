-- "运费合计" was the SUM of each line's independently-computed freight (each line hitting
-- its own min_charge). Change it to a pooled calculation: within each shipping-route group,
-- add up every line's actual/volumetric weight (personal uses per-unit weight/dims, business
-- uses package weight/dims × box count — both already correct per the previous migration),
-- apply that route's weight_mode/divisor ONCE to get one chargeable weight for the group, and
-- bill it against that route's rate ONCE (one min_charge, one extra_fee per group instead of
-- per line). Lines on a flat per-unit rate (personal_freight_mode = 'per_unit') don't have a
-- meaningful "chargeable weight" and are still billed individually, same as before.
--
-- Customs and insurance are untouched — still summed per line, unaffected by this change.
-- Both quote_shop_order (preview) and place_shop_order (actual charge) are updated together
-- so the amount shown at checkout matches what's actually deducted.

CREATE OR REPLACE FUNCTION public.quote_shop_order(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_route shipping_routes; v_rule freight_rules; v_customs customs_rules;
  it jsonb; v_product products; v_qty int; v_mode text; v_default_mode text;
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
BEGIN
  v_default_mode := COALESCE(_payload->>'mode', 'personal');
  v_method := _payload->>'shipping_method';

  FOR it IN SELECT jsonb_array_elements(_payload->'items') LOOP
    SELECT * INTO v_product FROM public.products
      WHERE slug = it->>'slug' AND status = 'active';
    IF v_product IS NULL THEN CONTINUE; END IF;

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

    v_line := public._compute_line_quote(v_product, v_route, v_rule, v_customs, v_qty, v_mode)
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
    s_freight := s_freight
      + GREATEST(round(g_cw * COALESCE(g_rule.unit_price_cny,0), 2), COALESCE(g_rule.min_charge_cny,0))
      + COALESCE(g_rule.extra_fee_cny, 0) + g_flat + g_last_mile;
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

-- place_shop_order: same pooled-freight change, applied per route group (this function
-- already groups lines by route_code for order creation).
CREATE OR REPLACE FUNCTION public.place_shop_order(_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  uid uuid := auth.uid();
  v_cust text;
  v_addr jsonb;
  v_default_mode text; v_ship_method text;
  v_items jsonb; it jsonb;
  v_product products; v_qty int; v_mode text;
  v_route shipping_routes; v_rule freight_rules; v_customs customs_rules;
  v_route_code text; v_line jsonb;
  v_groups jsonb := '{}'::jsonb;
  v_group_key text; v_group jsonb;
  v_route_keys text[];
  v_order_id uuid; v_order_no text;
  v_order_ids uuid[] := ARRAY[]::uuid[];
  v_total_subtotal numeric := 0;
  v_total_freight  numeric := 0;
  v_total_customs  numeric := 0;
  v_total_ins      numeric := 0;
  v_disc numeric := 0; v_coupon jsonb; v_coupon_id uuid;
  v_grand_total numeric := 0;
  v_inv_id uuid; v_inv_no text;
  v_fx numeric := public.current_fx_cny_to_cad(); v_need_cad numeric; v_bal numeric;
  v_units int; v_i int;
  v_first_disc_applied boolean := false;
  v_g_sub numeric; v_g_freight numeric; v_g_customs numeric; v_g_ins numeric; v_g_total numeric;
  v_g_disc numeric;
  g_rule freight_rules; g_route shipping_routes;
  g_aw numeric; g_vw numeric; g_cw numeric; g_flat numeric; g_last_mile numeric;
  g_mode text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_default_mode := COALESCE(_payload->>'mode', 'personal');
  v_ship_method := _payload->>'shipping_method';
  v_items := _payload->'items';
  v_addr := _payload->'address_snapshot';

  SELECT customer_code INTO v_cust FROM public.profiles WHERE id = uid;
  IF v_cust IS NULL THEN v_cust := 'C' || lpad(floor(random()*1000000)::text,6,'0'); END IF;

  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE slug = it->>'slug' AND status='active';
    IF v_product IS NULL THEN CONTINUE; END IF;
    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_mode := COALESCE(it->>'mode', v_default_mode);
    IF v_mode='business' AND NOT v_product.allow_business THEN v_mode:='personal'; END IF;
    IF v_mode='personal' AND NOT v_product.allow_personal THEN v_mode:='business'; END IF;
    IF v_mode='business' AND v_qty < COALESCE(v_product.moq,1) THEN
      RAISE EXCEPTION '商品 % 未达起订量 %', v_product.name, v_product.moq;
    END IF;
    IF COALESCE(_payload->>'route_code','') <> '' THEN
      v_route_code := _payload->>'route_code';
    ELSE
      v_route_code := public._product_route_code(v_product, v_mode, v_ship_method);
    END IF;
    IF v_route_code IS NULL OR v_route_code='' THEN
      RAISE EXCEPTION '商品 % 没有配置 %/% 线路', v_product.name, v_mode, v_ship_method;
    END IF;
    SELECT * INTO v_route FROM public.shipping_routes WHERE code=v_route_code AND is_active=true;
    IF v_route IS NULL THEN RAISE EXCEPTION '线路不可用: %', v_route_code; END IF;
    SELECT * INTO v_rule FROM public.freight_rules WHERE route_id=v_route.id AND is_active=true ORDER BY created_at DESC LIMIT 1;
    SELECT * INTO v_customs FROM public.customs_rules WHERE route_id=v_route.id LIMIT 1;
    v_line := public._compute_line_quote(v_product, v_route, v_rule, v_customs, v_qty, v_mode)
              || jsonb_build_object(
                   'route_code', v_route.code, 'destination_code', v_route.destination_code,
                   'shipping_method', v_route.shipping_method, 'mode', v_mode,
                   'product_id', v_product.id, 'product_slug', v_product.slug,
                   'sku', v_product.sku, 'name', v_product.name,
                   'cover_url', v_product.cover_url, 'price_cny', v_product.price_cny,
                   'quantity', v_qty, 'personal_freight_mode', v_product.personal_freight_mode);
    v_total_subtotal := v_total_subtotal + (v_line->>'subtotal_cny')::numeric;
    v_total_customs  := v_total_customs  + (v_line->>'customs_cny')::numeric;
    v_total_ins      := v_total_ins      + (v_line->>'insurance_cny')::numeric;
    v_group_key := v_route.code;
    v_group := COALESCE(v_groups->v_group_key, jsonb_build_object(
      'route_code', v_route.code, 'destination_code', v_route.destination_code,
      'shipping_method', v_route.shipping_method, 'lines', '[]'::jsonb));
    v_group := jsonb_set(v_group, '{lines}', (v_group->'lines') || v_line);
    v_groups := jsonb_set(v_groups, ARRAY[v_group_key], v_group, true);
  END LOOP;

  IF _payload ? 'coupon_code' AND COALESCE(_payload->>'coupon_code','') <> '' THEN
    v_coupon := public.validate_coupon(_payload->>'coupon_code', v_total_subtotal);
    IF (v_coupon->>'ok')::boolean THEN
      v_disc := (v_coupon->>'discount_cny')::numeric;
      SELECT id INTO v_coupon_id FROM public.coupons WHERE code = _payload->>'coupon_code';
    END IF;
  END IF;

  SELECT array_agg(k) INTO v_route_keys FROM jsonb_object_keys(v_groups) k;
  FOREACH v_group_key IN ARRAY COALESCE(v_route_keys, ARRAY[]::text[]) LOOP
    v_group := v_groups->v_group_key;
    v_g_sub:=0; v_g_customs:=0; v_g_ins:=0; v_units:=0;
    SELECT * INTO g_route FROM public.shipping_routes WHERE code = v_group_key AND is_active = true;
    SELECT * INTO g_rule FROM public.freight_rules
      WHERE route_id = g_route.id AND is_active = true ORDER BY created_at DESC LIMIT 1;
    g_aw := 0; g_vw := 0; g_flat := 0; g_last_mile := 0;
    FOR v_line IN SELECT jsonb_array_elements(v_group->'lines') LOOP
      v_g_sub     := v_g_sub     + (v_line->>'subtotal_cny')::numeric;
      v_g_customs := v_g_customs + (v_line->>'customs_cny')::numeric;
      v_g_ins     := v_g_ins     + (v_line->>'insurance_cny')::numeric;
      v_units     := v_units     + COALESCE((v_line->>'units')::int, 0);
      g_last_mile := g_last_mile + COALESCE((v_line->>'last_mile_cny')::numeric, 0);
      g_mode := v_line->>'mode';
      IF g_mode = 'personal' AND (v_line->>'personal_freight_mode') = 'per_unit' THEN
        g_flat := g_flat + (v_line->>'freight_cny')::numeric - COALESCE((v_line->>'last_mile_cny')::numeric, 0);
      ELSE
        g_aw := g_aw + COALESCE((v_line->>'actual_kg')::numeric, 0);
        g_vw := g_vw + COALESCE((v_line->>'volumetric_kg')::numeric, 0);
      END IF;
    END LOOP;
    g_cw := CASE COALESCE(g_rule.weight_mode,'max')
              WHEN 'actual' THEN g_aw WHEN 'volumetric' THEN g_vw ELSE GREATEST(g_aw, g_vw) END;
    v_g_freight := GREATEST(round(g_cw * COALESCE(g_rule.unit_price_cny,0), 2), COALESCE(g_rule.min_charge_cny,0))
      + COALESCE(g_rule.extra_fee_cny, 0) + g_flat + g_last_mile;

    v_g_disc := 0;
    IF NOT v_first_disc_applied AND v_disc > 0 THEN
      v_g_disc := v_disc; v_first_disc_applied := true;
    END IF;
    v_g_total := GREATEST(v_g_sub + v_g_freight + v_g_customs + v_g_ins - v_g_disc, 0);
    v_order_no := 'SO' || to_char(now(),'YYMMDDHH24MISS') || lpad(floor(random()*1000)::text,3,'0');

    INSERT INTO public.orders(
      user_id, source, order_no, status, payment_status, paid_at,
      customer_code, subtotal_cny, shipping_cny, customs_cny, insurance_cny,
      total_cny, discount_cny, coupon_id, shipping_method, destination_code,
      route_code, box_count, address_snapshot, note, payment_method
    ) VALUES (
      uid, 'shop', v_order_no, 'procurement', 'paid', now(),
      v_cust, v_g_sub, v_g_freight, v_g_customs, v_g_ins,
      v_g_total, v_g_disc, v_coupon_id,
      COALESCE(v_ship_method, v_group->>'shipping_method','air'),
      v_group->>'destination_code',
      v_group->>'route_code', v_units, v_addr, _payload->>'note', 'wallet'
    ) RETURNING id INTO v_order_id;
    v_order_ids := v_order_ids || v_order_id;

    FOR v_line IN SELECT jsonb_array_elements(v_group->'lines') LOOP
      INSERT INTO public.order_items(
        order_id, product_id, product_slug, sku, name_zh, name_en, image_url,
        unit_price_cny, quantity, subtotal_cny, purchase_type, paid
      ) VALUES (
        v_order_id, NULLIF(v_line->>'product_id','')::uuid, v_line->>'product_slug',
        v_line->>'sku', v_line->>'name', NULL, v_line->>'cover_url',
        (v_line->>'price_cny')::numeric, (v_line->>'quantity')::int,
        (v_line->>'subtotal_cny')::numeric, v_line->>'mode', true);
    END LOOP;

    IF v_units > 0 THEN
      FOR v_i IN 1..v_units LOOP
        INSERT INTO public.waybills(
          user_id, order_id, shipping_method, status, payment_status, box_no
        ) VALUES (
          uid, v_order_id,
          COALESCE(v_ship_method, v_group->>'shipping_method','air'),
          'procurement', 'paid', lpad(v_i::text, 3, '0'));
      END LOOP;
    END IF;

    v_total_freight := v_total_freight + v_g_freight;
  END LOOP;

  v_grand_total := GREATEST(v_total_subtotal + v_total_freight + v_total_customs + v_total_ins - v_disc, 0);
  v_need_cad := round(v_grand_total * v_fx, 2);
  SELECT COALESCE(balance_cad,0) INTO v_bal FROM public.wallets WHERE user_id = uid;
  IF COALESCE(v_bal,0) < v_need_cad THEN
    RETURN jsonb_build_object('ok', false, 'reason','insufficient',
      'need_cad', v_need_cad, 'balance_cad', COALESCE(v_bal,0));
  END IF;

  INSERT INTO public.invoices(
    user_id, type, status, subtotal_cny, freight_cny, customs_cny, insurance_cny,
    total_cny, paid_cny, fx_rate, currency, paid_at, paid_cad, note
  ) VALUES (
    uid, 'shop', 'paid', v_total_subtotal, v_total_freight, v_total_customs, v_total_ins,
    v_grand_total, v_grand_total, v_fx, 'CNY', now(), v_need_cad,
    'Shop order: ' || array_to_string(v_order_ids::text[], ',')
  ) RETURNING id, invoice_no INTO v_inv_id, v_inv_no;

  FOREACH v_order_id IN ARRAY v_order_ids LOOP
    INSERT INTO public.invoice_items(
      invoice_id, order_id, description, freight_cny, customs_cny, insurance_cny, amount_cny
    ) SELECT v_inv_id, o.id, 'Order ' || o.order_no,
           o.shipping_cny, o.customs_cny, o.insurance_cny, o.total_cny
      FROM public.orders o WHERE o.id = v_order_id;
  END LOOP;

  INSERT INTO public.wallet_transactions(
    user_id, type, amount_cny, amount_cad, fx_rate_cny_to_cad, status, channel, note
  ) VALUES (
    uid, 'spend', v_grand_total, v_need_cad, v_fx, 'completed', 'wallet',
    'Shop invoice ' || v_inv_no);

  RETURN jsonb_build_object(
    'ok', true, 'invoice_id', v_inv_id, 'invoice_no', v_inv_no,
    'order_ids', to_jsonb(v_order_ids),
    'orders_count', array_length(v_order_ids, 1),
    'total_cny', v_grand_total, 'paid_cad', v_need_cad);
END $function$;

GRANT EXECUTE ON FUNCTION public.quote_shop_order(jsonb) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.place_shop_order(jsonb) TO authenticated;
