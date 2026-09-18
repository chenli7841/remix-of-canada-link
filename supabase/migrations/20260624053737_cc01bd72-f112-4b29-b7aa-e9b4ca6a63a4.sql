
-- 1. shipping_routes
ALTER TABLE public.shipping_routes
  ADD COLUMN IF NOT EXISTS last_mile_fee_cad numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_mile_threshold_kg numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS item_field_required jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. warehouses
ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS storage_fee_cad_per_cbm_day numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inout_fee_cad_per_cbm numeric NOT NULL DEFAULT 0;

-- 3. freight_rules (CAD columns; keep CNY for rollback)
ALTER TABLE public.freight_rules
  ADD COLUMN IF NOT EXISTS unit_price_cad numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_charge_cad numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clearance_fee_cad numeric NOT NULL DEFAULT 0;

-- Backfill CAD = CNY * 0.19 for existing rows where CAD is zero
UPDATE public.freight_rules
SET unit_price_cad   = ROUND(COALESCE(unit_price_cny,0)   * 0.19, 4),
    min_charge_cad   = ROUND(COALESCE(min_charge_cny,0)   * 0.19, 2),
    clearance_fee_cad= ROUND(COALESCE(extra_fee_cny,0)    * 0.19, 2)
WHERE unit_price_cad = 0 AND min_charge_cad = 0 AND clearance_fee_cad = 0;

-- 4. waybills snapshot fees in CAD
ALTER TABLE public.waybills
  ADD COLUMN IF NOT EXISTS freight_cad numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duty_cad numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS insurance_cad numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clearance_cad numeric NOT NULL DEFAULT 0;

-- 5. place_forwarding: enforce required fields per route
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
  v_req jsonb;
  v_field text;
  v_val text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  v_warehouse_code := _payload->>'warehouse';
  IF v_warehouse_code IS NULL OR v_warehouse_code = '' THEN RAISE EXCEPTION '请选择仓库'; END IF;
  SELECT * INTO v_route FROM public.shipping_routes WHERE code = _payload->>'route_code' AND is_active = true;
  IF v_route IS NULL THEN RAISE EXCEPTION '线路不可用'; END IF;
  v_req := COALESCE(v_route.item_field_required, '{}'::jsonb);
  SELECT customer_code INTO v_cust FROM public.profiles WHERE id = uid;
  v_addr_id := NULLIF(_payload->>'address_id', '')::uuid;
  v_domestic := _payload->>'domestic_tracking_no';
  v_cargo := _payload->>'cargo_type';
  v_note := _payload->>'note';
  v_items := COALESCE(_payload->'items', '[]'::jsonb);

  -- enforce required fields per item
  FOR v_item IN SELECT jsonb_array_elements(v_items) LOOP
    IF (v_item->>'name') IS NULL OR trim(v_item->>'name') = '' THEN CONTINUE; END IF;
    v_extras := COALESCE(v_item->'extras', '{}'::jsonb);
    FOR v_field IN SELECT jsonb_object_keys(v_req) LOOP
      IF (v_req->>v_field)::boolean THEN
        v_val := CASE v_field
          WHEN 'name' THEN v_item->>'name'
          WHEN 'quantity' THEN v_item->>'quantity'
          WHEN 'unit_price' THEN v_item->>'unit_price_cny'
          ELSE v_extras->>v_field
        END;
        IF v_val IS NULL OR trim(v_val) = '' THEN
          RAISE EXCEPTION '物品「%」缺少必填项: %', (v_item->>'name'), v_field;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

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
