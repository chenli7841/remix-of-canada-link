
CREATE OR REPLACE FUNCTION public._compute_line_quote(_product products, _route shipping_routes, _rule freight_rules, _customs customs_rules, _qty integer, _mode text DEFAULT 'personal'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  ov jsonb;
  weight_mode text; divisor numeric; unit_price numeric;
  min_charge numeric; extra_fee numeric; ins_pct numeric;
  L numeric; W numeric; H numeric; kg numeric; units numeric;
  aw numeric; vw numeric; cw numeric;
  subtotal numeric; line_freight numeric; line_ins numeric; line_customs numeric;
  fx_cad_cny numeric;
  last_mile_cny numeric;
  is_business boolean;
  per_unit_cny numeric;
  pack_qty int;
BEGIN
  is_business := (_mode = 'business');

  IF is_business THEN
    ov := COALESCE(_product.business_freight_override, '{}'::jsonb);
  ELSE
    ov := COALESCE(_product.personal_freight_override, '{}'::jsonb);
  END IF;

  weight_mode := COALESCE(NULLIF(ov->>'weight_mode',''), _rule.weight_mode, 'max');
  divisor     := COALESCE(NULLIF(ov->>'volumetric_divisor','')::numeric, _rule.volumetric_divisor, 6000);
  unit_price  := COALESCE(NULLIF(ov->>'unit_price_cny','')::numeric, _rule.unit_price_cny, 0);
  min_charge  := COALESCE(NULLIF(ov->>'min_charge_cny','')::numeric, _rule.min_charge_cny, 0);
  extra_fee   := COALESCE(NULLIF(ov->>'extra_fee_cny','')::numeric, _rule.extra_fee_cny, 0);
  ins_pct     := COALESCE(NULLIF(ov->>'insurance_rate_pct','')::numeric, _rule.insurance_rate_pct, 0);

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

  IF is_business THEN
    line_freight := GREATEST(round(cw * unit_price, 2), min_charge) + extra_fee;
    SELECT COALESCE((value->>'rate')::numeric, 5.26) INTO fx_cad_cny
      FROM public.app_settings WHERE key = 'fx_cad_to_cny';
    last_mile_cny := round(COALESCE(_product.last_mile_fee_cad,0) * COALESCE(fx_cad_cny,5.26), 2);
    line_freight := line_freight + last_mile_cny;

    IF _product.customs_rate > 0 THEN
      line_customs := round(subtotal * _product.customs_rate, 2);
    ELSIF _customs.enabled THEN
      line_customs := round(subtotal * _customs.rate_pct / 100.0, 2);
    ELSE
      line_customs := 0;
    END IF;
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
      line_freight := GREATEST(round(cw * unit_price, 2), min_charge) + extra_fee;
    END IF;
    last_mile_cny := 0;
    line_customs := 0;
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
    INSERT INTO public.order_items(order_id, product_id, sku, name, qty, unit_price_cny, line_total_cny)
    VALUES (v_order_id, v_product.id, v_product.sku, v_product.name, v_qty, v_product.price_cny, v_product.price_cny * v_qty);
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'order_no', v_order_no,
    'total_cny', v_total
  );
END $function$;
