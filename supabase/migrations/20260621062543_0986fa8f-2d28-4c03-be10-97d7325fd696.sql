
CREATE OR REPLACE FUNCTION public.place_shop_order(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_cust text; v_route shipping_routes; v_rule freight_rules; v_customs customs_rules;
  v_subtotal numeric := 0; v_shipping numeric := 0;
  v_ins numeric := 0; v_cus numeric := 0; v_total numeric := 0; v_disc numeric := 0;
  v_addr jsonb; v_order_id uuid; v_order_no text;
  it jsonb; v_product products; v_qty int; v_line jsonb;
  v_items jsonb;
  v_coupon jsonb; v_coupon_id uuid;
  v_mode text; v_default_mode text;
  v_ship_method text; v_route_code text; v_header_route_code text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_default_mode := COALESCE(_payload->>'mode', 'personal');
  v_ship_method := _payload->>'shipping_method';
  v_items := _payload->'items';
  v_addr := _payload->'address_snapshot';

  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products
      WHERE slug = it->>'slug' AND status = 'active';
    IF v_product IS NULL THEN CONTINUE; END IF;
    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_mode := COALESCE(it->>'mode', v_default_mode);
    IF v_mode = 'business' AND NOT v_product.allow_business THEN v_mode := 'personal'; END IF;
    IF v_mode = 'personal' AND NOT v_product.allow_personal THEN v_mode := 'business'; END IF;
    IF v_mode = 'business' AND v_qty < COALESCE(v_product.moq,1) THEN
      RAISE EXCEPTION '商品 % 未达起订量 %', v_product.name, v_product.moq;
    END IF;

    IF COALESCE(_payload->>'route_code','') <> '' THEN
      v_route_code := _payload->>'route_code';
    ELSIF v_ship_method IS NOT NULL THEN
      v_route_code := public._product_route_code(v_product, v_mode, v_ship_method);
    ELSE
      v_route_code := NULL;
    END IF;

    IF v_route_code IS NULL OR v_route_code = '' THEN
      RAISE EXCEPTION '商品 % 没有配置 %/% 线路', v_product.name, v_mode, v_ship_method;
    END IF;

    SELECT * INTO v_route FROM public.shipping_routes
      WHERE code = v_route_code AND is_active = true;
    IF v_route IS NULL THEN RAISE EXCEPTION '线路不可用: %', v_route_code; END IF;
    SELECT * INTO v_rule FROM public.freight_rules
      WHERE route_id = v_route.id AND is_active = true
      ORDER BY created_at DESC LIMIT 1;
    SELECT * INTO v_customs FROM public.customs_rules WHERE route_id = v_route.id LIMIT 1;

    v_line := public._compute_line_quote(v_product, v_route, v_rule, v_customs, v_qty, v_mode);
    v_subtotal := v_subtotal + (v_line->>'subtotal_cny')::numeric;
    v_shipping := v_shipping + (v_line->>'freight_cny')::numeric;
    v_ins      := v_ins      + (v_line->>'insurance_cny')::numeric;
    v_cus      := v_cus      + (v_line->>'customs_cny')::numeric;

    IF v_header_route_code IS NULL THEN v_header_route_code := v_route.code; END IF;
  END LOOP;

  IF _payload ? 'coupon_code' AND COALESCE(_payload->>'coupon_code','') <> '' THEN
    v_coupon := public.validate_coupon(_payload->>'coupon_code', v_subtotal);
    IF (v_coupon->>'ok')::boolean THEN
      v_disc := (v_coupon->>'discount_cny')::numeric;
      SELECT id INTO v_coupon_id FROM public.coupons WHERE code = _payload->>'coupon_code';
    END IF;
  END IF;

  v_total := GREATEST(v_subtotal + v_shipping + v_ins + v_cus - v_disc, 0);

  SELECT customer_code INTO v_cust FROM public.profiles WHERE id = uid;
  IF v_cust IS NULL THEN v_cust := 'C' || lpad(floor(random()*1000000)::text,6,'0'); END IF;

  v_order_no := 'SO' || to_char(now(),'YYMMDDHH24MISS') || lpad(floor(random()*1000)::text,3,'0');

  INSERT INTO public.orders(
    user_id, source, order_no, status, customer_code,
    subtotal_cny, shipping_cny, customs_cny, total_cny, discount_cny,
    coupon_id, shipping_method, destination_code,
    route_code, address_snapshot, note
  ) VALUES (
    uid, 'shop', v_order_no, 'pending', v_cust,
    v_subtotal, v_shipping, v_cus, v_total, v_disc,
    v_coupon_id, COALESCE(v_ship_method, 'air'),
    NULL, v_header_route_code, v_addr, _payload->>'note'
  ) RETURNING id INTO v_order_id;

  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE slug = it->>'slug';
    IF v_product IS NULL THEN CONTINUE; END IF;
    v_qty := GREATEST((it->>'quantity')::int, 1);
    v_mode := COALESCE(it->>'mode', v_default_mode);
    INSERT INTO public.order_items(
      order_id, product_id, product_slug, sku,
      name_zh, name_en, image_url,
      unit_price_cny, quantity, subtotal_cny, purchase_type
    ) VALUES (
      v_order_id, v_product.id, v_product.slug, v_product.sku,
      v_product.name, v_product.name_en, v_product.cover_url,
      v_product.price_cny, v_qty, v_product.price_cny * v_qty, v_mode
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_no', v_order_no,
    'total_cny', v_total
  );
END $function$;
