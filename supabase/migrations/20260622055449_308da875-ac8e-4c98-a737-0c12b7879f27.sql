-- Fix place_forwarding bug: waybills has no customer_code/route_code/destination_code columns.
-- The gen_waybill_row_no trigger derives those from the parent forwarding_orders row.
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
    user_id, forwarding_id, shipping_method, status, payment_status
  ) VALUES (
    uid, v_fo_id, v_route.shipping_method, 'pending', 'unpaid'
  );

  RETURN jsonb_build_object('ok', true, 'id', v_fo_id, 'request_no', v_req_no);
END $function$;

-- Add business_hours field to warehouses for display on the forwarding page
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS business_hours text;