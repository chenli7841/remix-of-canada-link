
-- A) waybill_status_rank: include procurement / storage / arrived
CREATE OR REPLACE FUNCTION public.waybill_status_rank(_s waybill_status)
RETURNS integer LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _s
    WHEN 'cancelled'    THEN 0
    WHEN 'procurement'  THEN 1
    WHEN 'pending'      THEN 2
    WHEN 'received'     THEN 3
    WHEN 'storage'      THEN 3
    WHEN 'packed'       THEN 4
    WHEN 'shipped'      THEN 5
    WHEN 'arrived'      THEN 6
    WHEN 'in_transit'   THEN 7
    WHEN 'ready_pickup' THEN 8
    WHEN 'delivered'    THEN 9
  END
$$;

-- B) recompute_parent_from_waybills: map procurement / storage / arrived → order_status
CREATE OR REPLACE FUNCTION public.recompute_parent_from_waybills()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  oid uuid; fid uuid;
  latest public.waybill_status;
  all_cancelled boolean;
BEGIN
  oid := COALESCE(NEW.order_id, OLD.order_id);
  fid := COALESCE(NEW.forwarding_id, OLD.forwarding_id);

  IF oid IS NOT NULL THEN
    SELECT bool_and(status = 'cancelled') INTO all_cancelled
      FROM public.waybills WHERE order_id = oid;
    IF all_cancelled THEN
      UPDATE public.orders SET status = 'cancelled' WHERE id = oid;
    ELSE
      SELECT status INTO latest FROM public.waybills
        WHERE order_id = oid AND status <> 'cancelled'
        ORDER BY public.waybill_status_rank(status) DESC NULLS LAST, updated_at DESC
        LIMIT 1;
      IF latest IS NOT NULL THEN
        UPDATE public.orders SET status =
          CASE latest
            WHEN 'procurement'  THEN 'procurement'::order_status
            WHEN 'pending'      THEN 'pending'::order_status
            WHEN 'received'     THEN 'received'::order_status
            WHEN 'storage'      THEN 'storage'::order_status
            WHEN 'packed'       THEN 'packed'::order_status
            WHEN 'shipped'      THEN 'shipped'::order_status
            WHEN 'arrived'      THEN 'arrived'::order_status
            WHEN 'in_transit'   THEN 'in_transit'::order_status
            WHEN 'ready_pickup' THEN 'ready_pickup'::order_status
            WHEN 'delivered'    THEN 'delivered'::order_status
          END
        WHERE id = oid;
      END IF;
    END IF;
  END IF;

  IF fid IS NOT NULL THEN
    SELECT bool_and(status = 'cancelled') INTO all_cancelled
      FROM public.waybills WHERE forwarding_id = fid;
    IF all_cancelled THEN
      UPDATE public.forwarding_orders SET status = 'cancelled' WHERE id = fid;
    ELSE
      SELECT status INTO latest FROM public.waybills
        WHERE forwarding_id = fid AND status <> 'cancelled'
        ORDER BY public.waybill_status_rank(status) DESC NULLS LAST, updated_at DESC
        LIMIT 1;
      IF latest IS NOT NULL THEN
        UPDATE public.forwarding_orders SET status = latest::text
          WHERE id = fid;
      END IF;
    END IF;
  END IF;

  RETURN NULL;
END $$;

-- C) Auto-mark waybill as 'packed' when assigned to carton/pallet/batch
CREATE OR REPLACE FUNCTION public.waybill_auto_packed()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF (NEW.carton_id IS NOT NULL OR NEW.pallet_id IS NOT NULL OR NEW.assigned_batch_id IS NOT NULL)
     AND NEW.status IN ('pending','procurement','received','storage')
  THEN
    NEW.status := 'packed'::waybill_status;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_waybill_auto_packed ON public.waybills;
CREATE TRIGGER trg_waybill_auto_packed
BEFORE INSERT OR UPDATE OF carton_id, pallet_id, assigned_batch_id
ON public.waybills FOR EACH ROW EXECUTE FUNCTION public.waybill_auto_packed();

-- D) Rewrite place_shop_order: order status 'procurement', waybill status 'procurement'
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
  v_fx numeric := 0.19; v_need_cad numeric; v_bal numeric;
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

-- E) admin_ship_shop_order: staff flips procurement → pending
CREATE OR REPLACE FUNCTION public.admin_ship_shop_order(_order_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE uid uuid := auth.uid(); v_n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF NOT public.is_staff(uid) THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE public.waybills SET status = 'pending'::waybill_status
   WHERE order_id = _order_id AND status = 'procurement';
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.orders SET status = 'pending'::order_status
   WHERE id = _order_id AND status = 'procurement';

  RETURN jsonb_build_object('ok', true, 'waybills_updated', v_n);
END $$;
REVOKE ALL ON FUNCTION public.admin_ship_shop_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_ship_shop_order(uuid) TO authenticated, service_role;
