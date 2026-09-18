
-- 1. Clear runtime data (keep products/routes/warehouses/users)
TRUNCATE public.waybills, public.forwarding_items, public.forwarding_orders, public.order_items, public.orders RESTART IDENTITY CASCADE;

-- 2. Products: per-product route allowlist
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS available_route_codes text[] NOT NULL DEFAULT '{}';

-- 3. order_items: paid flag + linked first waybill
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS paid boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS waybill_id uuid REFERENCES public.waybills(id) ON DELETE SET NULL;

-- 4. Authenticated users can read active warehouses/routes (frontend dropdowns)
DROP POLICY IF EXISTS "warehouses_auth_read_active" ON public.warehouses;
CREATE POLICY "warehouses_auth_read_active" ON public.warehouses
  FOR SELECT TO authenticated USING (is_active = true);

DROP POLICY IF EXISTS "routes_auth_read_active" ON public.shipping_routes;
CREATE POLICY "routes_auth_read_active" ON public.shipping_routes
  FOR SELECT TO authenticated USING (is_active = true);

-- 5. Relax forwarding_orders hardcoded checks
ALTER TABLE public.forwarding_orders DROP CONSTRAINT IF EXISTS forwarding_orders_warehouse_check;
ALTER TABLE public.forwarding_orders DROP CONSTRAINT IF EXISTS forwarding_orders_shipping_method_check;
ALTER TABLE public.forwarding_orders ADD CONSTRAINT forwarding_orders_shipping_method_check
  CHECK (shipping_method = ANY (ARRAY['air','sea','express','truck']));

-- 6. Recompute order payment status from items
CREATE OR REPLACE FUNCTION public.recompute_order_payment_from_items()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  oid uuid; total int; paid_n int; new_status text;
BEGIN
  oid := COALESCE(NEW.order_id, OLD.order_id);
  IF oid IS NULL THEN RETURN NULL; END IF;
  SELECT count(*), count(*) FILTER (WHERE paid) INTO total, paid_n
    FROM public.order_items WHERE order_id = oid;
  new_status := CASE WHEN total = 0 THEN 'unpaid'
                     WHEN paid_n = total THEN 'paid'
                     WHEN paid_n > 0 THEN 'partial'
                     ELSE 'unpaid' END;
  UPDATE public.orders SET
    payment_status = new_status,
    paid_at = CASE WHEN new_status = 'paid' AND paid_at IS NULL THEN now() ELSE paid_at END,
    status = CASE WHEN new_status = 'paid' AND status = 'pending' THEN 'paid'::order_status ELSE status END
   WHERE id = oid;
  UPDATE public.waybills w SET payment_status = CASE WHEN oi.paid THEN 'paid' ELSE 'unpaid' END
    FROM public.order_items oi WHERE oi.waybill_id = w.id AND oi.order_id = oid;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_recompute_order_payment ON public.order_items;
CREATE TRIGGER trg_recompute_order_payment
  AFTER INSERT OR UPDATE OF paid OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.recompute_order_payment_from_items();

-- 7. pay_order_items RPC (per-item wallet payment)
CREATE OR REPLACE FUNCTION public.pay_order_items(_item_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid(); rate numeric := 0.19;
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

GRANT EXECUTE ON FUNCTION public.pay_order_items(uuid[]) TO authenticated;

-- 8. place_shop_order RPC
CREATE OR REPLACE FUNCTION public.place_shop_order(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_cust text; v_route_code text; v_method text; v_dest text; v_batch text;
  v_subtotal numeric := 0; v_shipping numeric := 0; v_total numeric := 0;
  v_addr jsonb; v_route record; v_order_id uuid; v_order_no text;
  it jsonb; v_product record; v_qty int; v_oi_id uuid; v_n int; v_first_wb uuid; v_wb_id uuid;
  v_items jsonb; i int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_route_code := _payload->>'route_code';
  IF v_route_code IS NULL OR v_route_code = '' THEN RAISE EXCEPTION '请选择线路'; END IF;
  SELECT * INTO v_route FROM public.shipping_routes WHERE code = v_route_code AND is_active = true;
  IF v_route IS NULL THEN RAISE EXCEPTION '线路不可用: %', v_route_code; END IF;
  v_method := v_route.shipping_method;
  v_dest := v_route.destination_code;
  v_addr := _payload->'address_snapshot';
  v_items := _payload->'items';
  SELECT customer_code INTO v_cust FROM public.profiles WHERE id = uid;

  -- Validate + sum
  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE slug = it->>'slug' AND status = 'active';
    IF v_product IS NULL THEN RAISE EXCEPTION '商品不存在: %', it->>'slug'; END IF;
    IF array_length(v_product.available_route_codes, 1) > 0
       AND NOT (v_route_code = ANY(v_product.available_route_codes)) THEN
      RAISE EXCEPTION '商品 % 不支持线路 %', v_product.name, v_route_code;
    END IF;
    v_qty := (it->>'quantity')::int;
    v_subtotal := v_subtotal + v_product.price_cny * v_qty;
    v_shipping := v_shipping + COALESCE(v_product.freight_cny, 0)
                  * ceil(v_qty::numeric / GREATEST(COALESCE(v_product.pack_qty, 1), 1));
  END LOOP;
  v_total := v_subtotal + v_shipping;

  -- Auto-bind to a pending batch on this route+method (newest planned date wins)
  SELECT batch_no INTO v_batch FROM public.batches
    WHERE shipping_method = v_method
      AND COALESCE(destination_code, '') = COALESCE(v_dest, '')
      AND status IN ('draft', 'locked')
    ORDER BY planned_ship_date NULLS LAST LIMIT 1;

  INSERT INTO public.orders(
    user_id, source, status, subtotal_cny, shipping_cny, total_cny,
    shipping_method, route_code, destination_code, route_id, customer_code, batch_no,
    address_snapshot, payment_status
  ) VALUES (
    uid, 'shop', 'pending', v_subtotal, v_shipping, v_total,
    v_method, v_route_code, v_dest, v_route.id, v_cust, v_batch,
    v_addr, 'unpaid'
  ) RETURNING id, order_no INTO v_order_id, v_order_no;

  FOR it IN SELECT jsonb_array_elements(v_items) LOOP
    SELECT * INTO v_product FROM public.products WHERE slug = it->>'slug';
    v_qty := (it->>'quantity')::int;
    INSERT INTO public.order_items(
      order_id, product_id, product_slug, name_zh, name_en, image_url,
      unit_price_cny, quantity, subtotal_cny, purchase_type
    ) VALUES (
      v_order_id, v_product.id, v_product.slug, v_product.name, v_product.name,
      v_product.cover_url, v_product.price_cny, v_qty,
      v_product.price_cny * v_qty, v_product.purchase_type::text
    ) RETURNING id INTO v_oi_id;

    v_n := GREATEST(1, ceil(v_qty::numeric / GREATEST(COALESCE(v_product.pack_qty, 1), 1))::int);
    v_first_wb := NULL;
    FOR i IN 1..v_n LOOP
      INSERT INTO public.waybills(
        user_id, order_id, customer_code, route_code, destination_code,
        shipping_method, batch_no, status, payment_status,
        length_cm, width_cm, height_cm, weight_kg
      ) VALUES (
        uid, v_order_id, v_cust, v_route_code, v_dest,
        v_method, v_batch, 'pending', 'unpaid',
        v_product.pack_length_cm, v_product.pack_width_cm,
        v_product.pack_height_cm, v_product.pack_weight_kg
      ) RETURNING id INTO v_wb_id;
      IF i = 1 THEN v_first_wb := v_wb_id; END IF;
    END LOOP;
    UPDATE public.order_items SET waybill_id = v_first_wb WHERE id = v_oi_id;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'order_id', v_order_id, 'order_no', v_order_no);
END $$;

GRANT EXECUTE ON FUNCTION public.place_shop_order(jsonb) TO authenticated;

-- 9. place_forwarding RPC
CREATE OR REPLACE FUNCTION public.place_forwarding(_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  v_cust text; v_route record; v_fo_id uuid; v_req_no text;
  v_addr_id uuid; v_items jsonb; v_item jsonb;
  v_warehouse_code text; v_domestic text; v_cargo text; v_note text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_warehouse_code := _payload->>'warehouse';
  IF v_warehouse_code IS NULL OR v_warehouse_code = '' THEN RAISE EXCEPTION '请选择仓库'; END IF;
  SELECT * INTO v_route FROM public.shipping_routes WHERE code = _payload->>'route_code' AND is_active = true;
  IF v_route IS NULL THEN RAISE EXCEPTION '线路不可用'; END IF;
  SELECT customer_code INTO v_cust FROM public.profiles WHERE id = uid;
  v_addr_id := NULLIF(_payload->>'address_id', '')::uuid;
  v_domestic := _payload->>'domestic_tracking_no';
  v_cargo := _payload->>'cargo_type';
  v_note := _payload->>'note';
  v_items := COALESCE(_payload->'items', '[]'::jsonb);

  INSERT INTO public.forwarding_orders(
    user_id, warehouse, shipping_method, route_code, destination_code,
    route_id, address_id, customer_code, domestic_tracking_no,
    status, payment_status, note, items_desc
  ) VALUES (
    uid, v_warehouse_code, v_route.shipping_method, v_route.code, v_route.destination_code,
    v_route.id, v_addr_id, v_cust, v_domestic,
    'pending', 'unpaid', v_note,
    (SELECT string_agg((x->>'name') || '×' || (x->>'quantity'), ', ')
       FROM jsonb_array_elements(v_items) x WHERE x->>'name' IS NOT NULL AND trim(x->>'name') <> '')
  ) RETURNING id, request_no INTO v_fo_id, v_req_no;

  FOR v_item IN SELECT jsonb_array_elements(v_items) LOOP
    IF (v_item->>'name') IS NOT NULL AND trim(v_item->>'name') <> '' THEN
      INSERT INTO public.forwarding_items(forwarding_id, name, quantity, unit_price_cny)
        VALUES (v_fo_id, v_item->>'name', (v_item->>'quantity')::int,
                COALESCE((v_item->>'unit_price_cny')::numeric, 0));
    END IF;
  END LOOP;

  INSERT INTO public.waybills(
    user_id, forwarding_id, customer_code, route_code, destination_code,
    shipping_method, status, payment_status
  ) VALUES (
    uid, v_fo_id, v_cust, v_route.code, v_route.destination_code,
    v_route.shipping_method, 'pending', 'unpaid'
  );

  RETURN jsonb_build_object('ok', true, 'id', v_fo_id, 'request_no', v_req_no);
END $$;

GRANT EXECUTE ON FUNCTION public.place_forwarding(jsonb) TO authenticated;
