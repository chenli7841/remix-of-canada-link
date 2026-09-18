
CREATE OR REPLACE FUNCTION public.place_forwarding(_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  uid uuid := auth.uid();
  v_cust text; v_route record; v_fo_id uuid; v_req_no text;
  v_addr_id uuid; v_items jsonb; v_item jsonb;
  v_warehouse_code text; v_domestic text; v_cargo text; v_note text;
  v_extras jsonb;
  v_box_count int; v_inner_qty int; v_qty int;
  v_total_boxes int := 0;
  v_box_seq int := 0;
  v_i int;
  v_item_note text;
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
    (SELECT string_agg(COALESCE(x->>'name','') || '×' || COALESCE(x->>'quantity','1'), ', ')
       FROM jsonb_array_elements(v_items) x WHERE x->>'name' IS NOT NULL AND trim(x->>'name') <> '')
  ) RETURNING id, request_no INTO v_fo_id, v_req_no;

  FOR v_item IN SELECT jsonb_array_elements(v_items) LOOP
    IF (v_item->>'name') IS NOT NULL AND trim(v_item->>'name') <> '' THEN
      v_extras := COALESCE(v_item->'extras', '{}'::jsonb);
      v_box_count := COALESCE(NULLIF(v_extras->>'box_count','')::int, 0);
      v_inner_qty := COALESCE(NULLIF(v_extras->>'inner_qty','')::int, 0);
      -- Auto-compute quantity if box_count present
      IF v_box_count > 0 THEN
        v_qty := v_box_count * GREATEST(v_inner_qty, 1);
      ELSE
        v_qty := COALESCE((v_item->>'quantity')::int, 1);
      END IF;
      INSERT INTO public.forwarding_items(forwarding_id, name, quantity, unit_price_cny, extras)
        VALUES (v_fo_id, v_item->>'name', v_qty,
                COALESCE((v_item->>'unit_price_cny')::numeric, 0),
                v_extras);
      v_total_boxes := v_total_boxes + v_box_count;
    END IF;
  END LOOP;

  -- Generate one waybill per box/pallet across all items. Skip waybill creation if no box_count.
  IF v_total_boxes > 0 THEN
    FOR v_item IN SELECT jsonb_array_elements(v_items) LOOP
      IF (v_item->>'name') IS NULL OR trim(v_item->>'name') = '' THEN CONTINUE; END IF;
      v_extras := COALESCE(v_item->'extras', '{}'::jsonb);
      v_box_count := COALESCE(NULLIF(v_extras->>'box_count','')::int, 0);
      v_inner_qty := COALESCE(NULLIF(v_extras->>'inner_qty','')::int, 0);
      IF v_box_count <= 0 THEN CONTINUE; END IF;
      v_item_note := (v_item->>'name') ||
        CASE WHEN v_inner_qty > 0 THEN ' × ' || v_inner_qty::text END;
      FOR v_i IN 1..v_box_count LOOP
        v_box_seq := v_box_seq + 1;
        INSERT INTO public.waybills(
          user_id, forwarding_id, shipping_method, status, payment_status, box_no, note
        ) VALUES (
          uid, v_fo_id, v_route.shipping_method, 'pending', 'unpaid',
          lpad(v_box_seq::text, 3, '0'), v_item_note
        );
      END LOOP;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_fo_id, 'request_no', v_req_no, 'waybills', v_total_boxes);
END $function$;
