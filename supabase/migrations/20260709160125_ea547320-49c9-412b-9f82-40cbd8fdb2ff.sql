-- Three wallet/checkout RPCs hardcoded the CNY->CAD rate as a 0.19 literal, completely
-- disconnected from the admin-configured rate at /admin/system → 汇率设置
-- (app_settings.fx_rate.cny_per_cad). This is the same bug already fixed on the frontend
-- (see cnyToCad()/cadToCny() in src/lib/i18n.tsx) — sweeping it server-side now.
--
-- current_fx_cny_to_cad() returns CAD per 1 CNY (i.e. multiply a CNY amount by this to get
-- CAD), matching the semantics of the `rate`/`v_fx` variables it replaces below.
CREATE OR REPLACE FUNCTION public.current_fx_cny_to_cad()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT 1 / COALESCE(NULLIF((SELECT (value->>'cny_per_cad')::numeric FROM public.app_settings WHERE key = 'fx_rate'), 0), 5.26)
$$;
GRANT EXECUTE ON FUNCTION public.current_fx_cny_to_cad() TO authenticated, anon;

-- pay_batch: wallet payment for a batch of orders/forwarding requests
CREATE OR REPLACE FUNCTION public.pay_batch(_batch_no text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  rate numeric := public.current_fx_cny_to_cad();
  total_cny numeric := 0;
  total_cad numeric := 0;
  bal numeric := 0;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _batch_no IS NULL OR _batch_no = '' THEN RAISE EXCEPTION 'batch_no required'; END IF;

  SELECT COALESCE(SUM(total_cny),0) INTO total_cny
  FROM public.orders WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid';

  SELECT total_cny + COALESCE((SELECT SUM(COALESCE(fee_cny,0)) FROM public.forwarding_orders
     WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid'),0)
  INTO total_cny;

  IF total_cny <= 0 THEN RETURN jsonb_build_object('ok', false, 'reason','nothing_to_pay'); END IF;

  total_cad := round(total_cny * rate, 2);

  SELECT COALESCE(balance_cad,0) INTO bal FROM public.wallets WHERE user_id = uid;
  IF bal < total_cad THEN
    RETURN jsonb_build_object('ok', false, 'reason','insufficient', 'need_cad', total_cad, 'balance_cad', bal);
  END IF;

  INSERT INTO public.wallet_transactions (user_id, type, amount_cny, amount_cad, fx_rate_cny_to_cad, status, channel, note)
  VALUES (uid, 'spend', total_cny, total_cad, rate, 'completed', 'wallet', 'Batch payment: ' || _batch_no);

  UPDATE public.orders SET payment_status = 'paid', status = CASE WHEN status='pending' THEN 'paid'::order_status ELSE status END
   WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid';
  UPDATE public.forwarding_orders SET payment_status = 'paid'
   WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid';

  RETURN jsonb_build_object('ok', true, 'paid_cad', total_cad, 'paid_cny', total_cny);
END;
$$;

-- pay_order_items: wallet payment for individual shop order line items
CREATE OR REPLACE FUNCTION public.pay_order_items(_item_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); rate numeric := public.current_fx_cny_to_cad();
  total_cny numeric := 0; total_cad numeric; bal numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT COALESCE(SUM(oi.unit_price_cny * oi.quantity), 0) INTO total_cny
    FROM public.order_items oi JOIN public.orders o ON o.id = oi.order_id
    WHERE oi.id = ANY(_item_ids) AND o.user_id = uid AND oi.paid = false;
  IF total_cny <= 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'nothing_to_pay'); END IF;
  total_cad := round(total_cny * rate, 2);
  SELECT COALESCE(balance_cad, 0) INTO bal FROM public.wallets WHERE user_id = uid;
  IF COALESCE(bal, 0) < total_cad THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient',
                              'need_cad', total_cad, 'balance_cad', COALESCE(bal, 0));
  END IF;
  INSERT INTO public.wallet_transactions(user_id, type, amount_cny, amount_cad,
                                         fx_rate_cny_to_cad, status, channel, note)
    VALUES (uid, 'spend', total_cny, total_cad, rate, 'completed', 'wallet', 'Pay items');
  UPDATE public.order_items SET paid = true
    WHERE id = ANY(_item_ids)
      AND order_id IN (SELECT id FROM public.orders WHERE user_id = uid);
  RETURN jsonb_build_object('ok', true, 'paid_cad', total_cad, 'paid_cny', total_cny);
END $$;

-- place_shop_order: wallet-paid shop checkout (current live definition, per 20260622045505)
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
                   'quantity', v_qty);
    v_total_subtotal := v_total_subtotal + (v_line->>'subtotal_cny')::numeric;
    v_total_freight  := v_total_freight  + (v_line->>'freight_cny')::numeric;
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

  v_grand_total := GREATEST(v_total_subtotal + v_total_freight + v_total_customs + v_total_ins - v_disc, 0);
  v_need_cad := round(v_grand_total * v_fx, 2);
  SELECT COALESCE(balance_cad,0) INTO v_bal FROM public.wallets WHERE user_id = uid;
  IF COALESCE(v_bal,0) < v_need_cad THEN
    RETURN jsonb_build_object('ok', false, 'reason','insufficient',
      'need_cad', v_need_cad, 'balance_cad', COALESCE(v_bal,0));
  END IF;

  SELECT array_agg(k) INTO v_route_keys FROM jsonb_object_keys(v_groups) k;
  FOREACH v_group_key IN ARRAY COALESCE(v_route_keys, ARRAY[]::text[]) LOOP
    v_group := v_groups->v_group_key;
    v_g_sub:=0; v_g_freight:=0; v_g_customs:=0; v_g_ins:=0; v_units:=0;
    FOR v_line IN SELECT jsonb_array_elements(v_group->'lines') LOOP
      v_g_sub     := v_g_sub     + (v_line->>'subtotal_cny')::numeric;
      v_g_freight := v_g_freight + (v_line->>'freight_cny')::numeric;
      v_g_customs := v_g_customs + (v_line->>'customs_cny')::numeric;
      v_g_ins     := v_g_ins     + (v_line->>'insurance_cny')::numeric;
      v_units     := v_units     + COALESCE((v_line->>'units')::int, 0);
    END LOOP;
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
  END LOOP;

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

GRANT EXECUTE ON FUNCTION public.pay_batch(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pay_order_items(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_shop_order(jsonb) TO authenticated;
