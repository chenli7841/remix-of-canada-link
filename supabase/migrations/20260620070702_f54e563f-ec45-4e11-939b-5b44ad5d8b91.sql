
-- 1) validate_coupon: returns jsonb { ok, discount_cny, coupon_id, name, reason }
CREATE OR REPLACE FUNCTION public.validate_coupon(_code text, _subtotal_cny numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c public.coupons; disc numeric := 0;
BEGIN
  IF _code IS NULL OR trim(_code) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty');
  END IF;
  SELECT * INTO c FROM public.coupons WHERE upper(code) = upper(trim(_code)) LIMIT 1;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF NOT c.is_active THEN RETURN jsonb_build_object('ok', false, 'reason', 'inactive'); END IF;
  IF c.starts_at IS NOT NULL AND now() < c.starts_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_started'); END IF;
  IF c.ends_at IS NOT NULL AND now() > c.ends_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'expired'); END IF;
  IF c.usage_limit IS NOT NULL AND c.used_count >= c.usage_limit THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'limit_reached'); END IF;
  IF COALESCE(c.min_order_cny,0) > 0 AND _subtotal_cny < c.min_order_cny THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'min_order',
      'min_order_cny', c.min_order_cny); END IF;
  IF c.type::text = 'fixed' THEN
    disc := LEAST(c.value, _subtotal_cny);
  ELSE
    disc := round(_subtotal_cny * c.value / 100.0, 2);
  END IF;
  RETURN jsonb_build_object('ok', true, 'coupon_id', c.id, 'name', COALESCE(c.name, c.code),
    'code', c.code, 'type', c.type, 'value', c.value, 'discount_cny', disc);
END $$;

GRANT EXECUTE ON FUNCTION public.validate_coupon(text, numeric) TO authenticated, anon;

-- 2) quote_shop_order: add coupon support
CREATE OR REPLACE FUNCTION public.quote_shop_order(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_route shipping_routes; v_rule freight_rules; v_customs customs_rules;
  it jsonb; v_product products; v_qty int;
  v_lines jsonb := '[]'::jsonb; v_line jsonb;
  s_sub numeric := 0; s_freight numeric := 0; s_ins numeric := 0; s_customs numeric := 0;
  v_coupon jsonb; v_disc numeric := 0;
BEGIN
  SELECT * INTO v_route FROM public.shipping_routes
    WHERE code = _payload->>'route_code' AND is_active = true;
  IF v_route IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'route_unavailable');
  END IF;
  SELECT * INTO v_rule FROM public.freight_rules
    WHERE route_id = v_route.id AND is_active = true
    ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_customs FROM public.customs_rules
    WHERE route_id = v_route.id LIMIT 1;

  FOR it IN SELECT jsonb_array_elements(_payload->'items') LOOP
    SELECT * INTO v_product FROM public.products
      WHERE slug = it->>'slug' AND status = 'active';
    IF v_product IS NULL THEN CONTINUE; END IF;
    IF array_length(v_product.available_route_codes,1) > 0
       AND NOT (v_route.code = ANY(v_product.available_route_codes)) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'route_not_for_product', 'slug', v_product.slug);
    END IF;
    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_line := public._compute_line_quote(v_product, v_route, v_rule, v_customs, v_qty);
    v_lines := v_lines || v_line;
    s_sub     := s_sub     + (v_line->>'subtotal_cny')::numeric;
    s_freight := s_freight + (v_line->>'freight_cny')::numeric;
    s_ins     := s_ins     + (v_line->>'insurance_cny')::numeric;
    s_customs := s_customs + (v_line->>'customs_cny')::numeric;
  END LOOP;

  IF _payload ? 'coupon_code' AND COALESCE(_payload->>'coupon_code','') <> '' THEN
    v_coupon := public.validate_coupon(_payload->>'coupon_code', s_sub);
    IF (v_coupon->>'ok')::boolean THEN
      v_disc := (v_coupon->>'discount_cny')::numeric;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'route_code', v_route.code,
    'subtotal_cny', s_sub,
    'freight_cny', s_freight,
    'insurance_cny', s_ins,
    'customs_cny', s_customs,
    'discount_cny', v_disc,
    'coupon', v_coupon,
    'shipping_total_cny', s_freight + s_ins + s_customs,
    'total_cny', GREATEST(s_sub + s_freight + s_ins + s_customs - v_disc, 0),
    'lines', v_lines,
    'has_freight_rule', v_rule.id IS NOT NULL
  );
END $$;

-- 3) place_shop_order: add coupon support
CREATE OR REPLACE FUNCTION public.place_shop_order(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_cust text; v_route shipping_routes; v_rule freight_rules; v_customs customs_rules;
  v_method text; v_dest text; v_batch text;
  v_subtotal numeric := 0; v_shipping numeric := 0;
  v_ins numeric := 0; v_cus numeric := 0; v_total numeric := 0; v_disc numeric := 0;
  v_addr jsonb; v_order_id uuid; v_order_no text;
  it jsonb; v_product products; v_qty int; v_line jsonb;
  v_oi_id uuid; v_n int; v_first_wb uuid; v_wb_id uuid;
  v_items jsonb; i int;
  v_coupon jsonb; v_coupon_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_route FROM public.shipping_routes
    WHERE code = _payload->>'route_code' AND is_active = true;
  IF v_route IS NULL THEN RAISE EXCEPTION '线路不可用: %', _payload->>'route_code'; END IF;
  SELECT * INTO v_rule FROM public.freight_rules
    WHERE route_id = v_route.id AND is_active = true
    ORDER BY created_at DESC LIMIT 1;
  SELECT * INTO v_customs FROM public.customs_rules WHERE route_id = v_route.id LIMIT 1;

  v_method := v_route.shipping_method;
  v_dest := v_route.destination_code;
  v_addr := _payload->'address_snapshot';
  v_items := _payload->'items';
  SELECT customer_code INTO v_cust FROM public.profiles WHERE id = uid;

  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE slug = it->>'slug' AND status = 'active';
    IF v_product IS NULL THEN RAISE EXCEPTION '商品不存在: %', it->>'slug'; END IF;
    IF array_length(v_product.available_route_codes,1) > 0
       AND NOT (v_route.code = ANY(v_product.available_route_codes)) THEN
      RAISE EXCEPTION '商品 % 不支持线路 %', v_product.name, v_route.code;
    END IF;
    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_line := public._compute_line_quote(v_product, v_route, v_rule, v_customs, v_qty);
    v_subtotal := v_subtotal + (v_line->>'subtotal_cny')::numeric;
    v_shipping := v_shipping + (v_line->>'freight_cny')::numeric;
    v_ins      := v_ins      + (v_line->>'insurance_cny')::numeric;
    v_cus      := v_cus      + (v_line->>'customs_cny')::numeric;
  END LOOP;

  IF _payload ? 'coupon_code' AND COALESCE(_payload->>'coupon_code','') <> '' THEN
    v_coupon := public.validate_coupon(_payload->>'coupon_code', v_subtotal);
    IF NOT (v_coupon->>'ok')::boolean THEN
      RAISE EXCEPTION '优惠券无效: %', v_coupon->>'reason';
    END IF;
    v_disc := (v_coupon->>'discount_cny')::numeric;
    v_coupon_id := (v_coupon->>'coupon_id')::uuid;
  END IF;

  v_total := GREATEST(v_subtotal + v_shipping + v_ins + v_cus - v_disc, 0);

  SELECT batch_no INTO v_batch FROM public.batches
    WHERE shipping_method = v_method
      AND COALESCE(destination_code,'') = COALESCE(v_dest,'')
      AND status IN ('draft','locked')
    ORDER BY planned_ship_date NULLS LAST LIMIT 1;

  INSERT INTO public.orders(
    user_id, source, status, subtotal_cny, shipping_cny, insurance_cny, customs_cny,
    total_cny, discount_cny, coupon_id,
    shipping_method, route_code, destination_code, route_id, customer_code, batch_no,
    address_snapshot, payment_status
  ) VALUES (
    uid, 'shop', 'pending', v_subtotal, v_shipping, v_ins, v_cus,
    v_total, v_disc, v_coupon_id,
    v_method, v_route.code, v_dest, v_route.id, v_cust, v_batch,
    v_addr, 'unpaid'
  ) RETURNING id, order_no INTO v_order_id, v_order_no;

  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE slug = it->>'slug';
    v_qty := GREATEST((it->>'quantity')::int, 1);
    INSERT INTO public.order_items(
      order_id, product_id, product_slug, name_zh, name_en, image_url,
      unit_price_cny, quantity, subtotal_cny, purchase_type
    ) VALUES (
      v_order_id, v_product.id, v_product.slug, v_product.name, v_product.name,
      v_product.cover_url, v_product.price_cny, v_qty,
      v_product.price_cny * v_qty, v_product.purchase_type::text
    ) RETURNING id INTO v_oi_id;

    v_n := GREATEST(1, ceil(v_qty::numeric / GREATEST(COALESCE(v_product.pack_qty,1),1))::int);
    v_first_wb := NULL;
    FOR i IN 1..v_n LOOP
      INSERT INTO public.waybills(
        user_id, order_id, customer_code, route_code, destination_code,
        shipping_method, batch_no, status, payment_status,
        length_cm, width_cm, height_cm, weight_kg
      ) VALUES (
        uid, v_order_id, v_cust, v_route.code, v_dest,
        v_method, v_batch, 'pending', 'unpaid',
        v_product.pack_length_cm, v_product.pack_width_cm,
        v_product.pack_height_cm, v_product.pack_weight_kg
      ) RETURNING id INTO v_wb_id;
      IF i = 1 THEN v_first_wb := v_wb_id; END IF;
    END LOOP;
    UPDATE public.order_items SET waybill_id = v_first_wb WHERE id = v_oi_id;
  END LOOP;

  IF v_coupon_id IS NOT NULL THEN
    INSERT INTO public.coupon_redemptions(coupon_id, user_id, order_id)
      VALUES (v_coupon_id, uid, v_order_id);
    UPDATE public.coupons SET used_count = used_count + 1 WHERE id = v_coupon_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'order_no', v_order_no);
END $$;
