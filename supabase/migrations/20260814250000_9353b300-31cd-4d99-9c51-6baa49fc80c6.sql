-- Admin "代客操作" support for the two actions the 客户视图 page was still
-- missing: paying a customer's storage fee, and filing a new forwarding
-- request on their behalf. Both existing functions were hardcoded to
-- auth.uid() (the caller's own account) — they now take an optional
-- _target_user_id: omitted (or equal to the caller), behavior is 100%
-- unchanged (self-service, no staff check). When set to someone else, the
-- caller must be staff (checked with public.is_staff), and the action is
-- logged to admin_action_logs the same way every other 客户视图 write is.

DROP FUNCTION IF EXISTS public.preview_storage_fees();
CREATE OR REPLACE FUNCTION public.preview_storage_fees(_target_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_uid uuid := auth.uid();
  uid uuid;
  result jsonb;
BEGIN
  IF caller_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_user_id IS NOT NULL AND _target_user_id <> caller_uid THEN
    IF NOT public.is_staff(caller_uid) THEN RAISE EXCEPTION 'Forbidden: staff only'; END IF;
    uid := _target_user_id;
  ELSE
    uid := caller_uid;
  END IF;

  WITH sf AS (
    SELECT
      f.id AS forwarding_id, f.request_no,
      COALESCE(f.storage_fee_from, f.intake_at, f.created_at) AS period_from,
      GREATEST(0, CEIL(EXTRACT(EPOCH FROM (now() - COALESCE(f.storage_fee_from, f.intake_at, f.created_at))) / 86400))::int AS billable_days,
      GREATEST(COALESCE((
        SELECT SUM((wb.length_cm*wb.width_cm*wb.height_cm)/1000000.0)
        FROM public.waybills wb WHERE wb.forwarding_id = f.id AND wb.status = 'storage'
      ), 0), 0) AS cbm_real,
      COALESCE(w.storage_fee_cad_per_cbm_day, 0) AS rate_cad_per_cbm_day
    FROM public.forwarding_orders f
    LEFT JOIN public.warehouses w ON w.code = f.warehouse
    WHERE f.user_id = uid
      AND EXISTS (SELECT 1 FROM public.waybills wb WHERE wb.forwarding_id = f.id AND wb.status = 'storage')
  ),
  sf2 AS (
    SELECT *, (CASE WHEN cbm_real > 0 THEN GREATEST(CEIL(cbm_real), 1) ELSE 0 END) AS cbm_charged
    FROM sf
  ),
  sf3 AS (
    SELECT *, ROUND(cbm_charged * billable_days * rate_cad_per_cbm_day, 2) AS fee_cad
    FROM sf2
  )
  SELECT jsonb_build_object(
    'total_cad', COALESCE(SUM(fee_cad), 0),
    'earliest_period_from', MIN(period_from),
    'items', COALESCE(jsonb_agg(jsonb_build_object(
      'forwarding_id', forwarding_id, 'request_no', request_no,
      'period_from', period_from, 'billable_days', billable_days,
      'cbm_charged', cbm_charged, 'fee_cad', fee_cad
    ) ORDER BY fee_cad DESC) FILTER (WHERE fee_cad > 0), '[]'::jsonb)
  ) INTO result
  FROM sf3;

  RETURN result;
END $$;
GRANT EXECUTE ON FUNCTION public.preview_storage_fees(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.pay_storage_fees();
CREATE OR REPLACE FUNCTION public.pay_storage_fees(_target_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  caller_uid uuid := auth.uid();
  uid uuid;
  is_admin_action boolean := false;
  operator_name text;
  rate numeric := public.current_fx_cny_to_cad();
  total_cad numeric := 0;
  total_cny numeric := 0;
  bal numeric := 0;
  v_inv_id uuid;
  v_inv_no text;
  v_points integer;
BEGIN
  IF caller_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_user_id IS NOT NULL AND _target_user_id <> caller_uid THEN
    IF NOT public.is_staff(caller_uid) THEN RAISE EXCEPTION 'Forbidden: staff only'; END IF;
    uid := _target_user_id;
    is_admin_action := true;
  ELSE
    uid := caller_uid;
  END IF;

  CREATE TEMP TABLE _sf ON COMMIT DROP AS
  SELECT
    f.id AS forwarding_id,
    f.request_no,
    COALESCE(f.storage_fee_from, f.intake_at, f.created_at) AS period_from,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (now() - COALESCE(f.storage_fee_from, f.intake_at, f.created_at))) / 86400))::int AS billable_days,
    GREATEST(COALESCE((
      SELECT SUM((wb.length_cm*wb.width_cm*wb.height_cm)/1000000.0)
      FROM public.waybills wb WHERE wb.forwarding_id = f.id AND wb.status = 'storage'
    ), 0), 0) AS cbm_real,
    COALESCE(w.storage_fee_cad_per_cbm_day, 0) AS rate_cad_per_cbm_day
  FROM public.forwarding_orders f
  LEFT JOIN public.warehouses w ON w.code = f.warehouse
  WHERE f.user_id = uid
    AND EXISTS (SELECT 1 FROM public.waybills wb WHERE wb.forwarding_id = f.id AND wb.status = 'storage');

  ALTER TABLE _sf ADD COLUMN cbm_charged numeric;
  UPDATE _sf SET cbm_charged = CASE WHEN cbm_real > 0 THEN GREATEST(CEIL(cbm_real), 1) ELSE 0 END;
  ALTER TABLE _sf ADD COLUMN fee_cad numeric;
  UPDATE _sf SET fee_cad = ROUND(cbm_charged * billable_days * rate_cad_per_cbm_day, 2);
  DELETE FROM _sf WHERE COALESCE(fee_cad, 0) <= 0;

  SELECT COALESCE(SUM(fee_cad), 0) INTO total_cad FROM _sf;
  IF total_cad <= 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'nothing_to_pay'); END IF;

  SELECT COALESCE(balance_cad, 0) INTO bal FROM public.wallets WHERE user_id = uid;
  IF bal < total_cad THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient', 'need_cad', total_cad, 'balance_cad', bal);
  END IF;

  total_cny := round(total_cad / rate, 2);

  INSERT INTO public.wallet_transactions(user_id, type, amount_cny, amount_cad, fx_rate_cny_to_cad, status, channel, note)
  VALUES (uid, 'spend', total_cny, total_cad, rate, 'completed', 'storage', CASE WHEN is_admin_action THEN '仓库扣费（员工代客户操作）' ELSE '仓库扣费' END);

  INSERT INTO public.invoices(user_id, type, status, subtotal_cny, total_cny, paid_cny, other_cny, fx_rate, currency, paid_at, paid_cad, note)
  VALUES (uid, 'manual', 'paid', total_cny, total_cny, total_cny, total_cny, rate, 'CNY', now(), total_cad, '仓储费结算')
  RETURNING id, invoice_no INTO v_inv_id, v_inv_no;

  INSERT INTO public.invoice_items(invoice_id, forwarding_id, description, amount_cny, other_cny, meta)
  SELECT
    v_inv_id, forwarding_id,
    '仓储费 · ' || COALESCE(request_no, forwarding_id::text) || '（' || billable_days || ' 天 · ' || cbm_charged || ' cbm）',
    round(fee_cad / rate, 2),
    round(fee_cad / rate, 2),
    jsonb_build_object(
      'fee_type', '仓储费',
      'period_from', period_from,
      'period_to', now(),
      'billable_days', billable_days,
      'cbm_charged', cbm_charged,
      'rate_cad_per_cbm_day', rate_cad_per_cbm_day,
      'amount_cad', fee_cad
    )
  FROM _sf;

  UPDATE public.forwarding_orders SET storage_fee_from = now()
  WHERE id IN (SELECT forwarding_id FROM _sf);

  v_points := public.award_points_for_spend(uid, total_cad);

  IF is_admin_action THEN
    SELECT COALESCE(full_name, email, caller_uid::text) INTO operator_name
      FROM public.profiles WHERE id = caller_uid;
    INSERT INTO public.admin_action_logs(entity_type, entity_id, action, after, operator_id, operator_name, note)
    VALUES (
      'customer_storage_fee', uid, 'admin_pay_storage_fee',
      jsonb_build_object('paid_cad', total_cad, 'paid_cny', total_cny, 'invoice_no', v_inv_no),
      caller_uid, operator_name, '代客户缴纳仓储费 ' || v_inv_no
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'paid_cad', total_cad, 'paid_cny', total_cny,
    'invoice_id', v_inv_id, 'invoice_no', v_inv_no, 'points_earned', v_points
  );
END $$;
GRANT EXECUTE ON FUNCTION public.pay_storage_fees(uuid) TO authenticated;

-- place_forwarding: same "acting for someone else requires staff" gate. The
-- rest of the function is untouched — every `uid` reference below already
-- resolves to whoever the order should belong to, self-service or admin.
DROP FUNCTION IF EXISTS public.place_forwarding(jsonb);
CREATE OR REPLACE FUNCTION public.place_forwarding(_payload jsonb, _target_user_id uuid DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  caller_uid uuid := auth.uid();
  uid uuid;
  is_admin_action boolean := false;
  operator_name text;
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
  v_insured boolean;
  v_per_box_summary jsonb;
  v_unit_cad numeric; v_unit_cny numeric;
  v_declared_cad numeric := 0;
  v_fx_cad_to_cny numeric := 5.26; -- 1 CAD = 5.26 CNY
BEGIN
  IF caller_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _target_user_id IS NOT NULL AND _target_user_id <> caller_uid THEN
    IF NOT public.is_staff(caller_uid) THEN RAISE EXCEPTION 'Forbidden: staff only'; END IF;
    uid := _target_user_id;
    is_admin_action := true;
  ELSE
    uid := caller_uid;
  END IF;

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
  v_insured := COALESCE((_payload->>'insured')::boolean, false);
  v_items := COALESCE(_payload->'items', '[]'::jsonb);

  FOR v_item IN SELECT jsonb_array_elements(v_items) LOOP
    IF (v_item->>'name') IS NULL OR trim(v_item->>'name') = '' THEN CONTINUE; END IF;
    v_extras := COALESCE(v_item->'extras', '{}'::jsonb);
    FOR v_field IN SELECT jsonb_object_keys(v_req) LOOP
      IF (v_req->>v_field)::boolean THEN
        v_val := CASE v_field
          WHEN 'name' THEN v_item->>'name'
          WHEN 'quantity' THEN v_item->>'quantity'
          WHEN 'unit_price' THEN COALESCE(v_item->>'unit_price_cad', v_item->>'unit_price_cny')
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
    status, payment_status, note, items_desc, insured
  ) VALUES (
    uid, v_warehouse_code, v_route.shipping_method, v_route.code, v_route.destination_code,
    v_route.id, v_addr_id, v_cust, v_domestic,
    'pending', 'unpaid', v_note,
    (SELECT string_agg(COALESCE(x->>'name','') || '×' || COALESCE(x->>'quantity','1'), ', ')
       FROM jsonb_array_elements(v_items) x WHERE x->>'name' IS NOT NULL AND trim(x->>'name') <> ''),
    v_insured
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
      v_unit_cad := COALESCE(NULLIF(v_item->>'unit_price_cad','')::numeric, 0);
      v_unit_cny := COALESCE(NULLIF(v_item->>'unit_price_cny','')::numeric, 0);
      IF v_unit_cad = 0 AND v_unit_cny > 0 THEN
        v_unit_cad := ROUND(v_unit_cny * 0.19, 2);
      ELSIF v_unit_cny = 0 AND v_unit_cad > 0 THEN
        v_unit_cny := ROUND(v_unit_cad * v_fx_cad_to_cny, 2);
      END IF;
      INSERT INTO public.forwarding_items(forwarding_id, name, quantity, unit_price_cad, unit_price_cny, extras)
        VALUES (v_fo_id, v_item->>'name', v_qty, v_unit_cad, v_unit_cny, v_extras);
      v_total_boxes := v_total_boxes + v_box_count;
      v_declared_cad := v_declared_cad + (v_qty * v_unit_cad);
    END IF;
  END LOOP;

  UPDATE public.forwarding_orders
     SET declared_value_cad = ROUND(v_declared_cad, 2)
   WHERE id = v_fo_id;

  IF v_total_boxes > 0 THEN
    FOR v_item IN SELECT jsonb_array_elements(v_items) LOOP
      IF (v_item->>'name') IS NULL OR trim(v_item->>'name') = '' THEN CONTINUE; END IF;
      v_extras := COALESCE(v_item->'extras', '{}'::jsonb);
      v_box_count := COALESCE(NULLIF(v_extras->>'box_count','')::int, 0);
      v_inner_qty := COALESCE(NULLIF(v_extras->>'inner_qty','')::int, 0);
      IF v_box_count <= 0 THEN CONTINUE; END IF;
      v_item_note := (v_item->>'name') ||
        CASE WHEN v_inner_qty > 0 THEN ' × ' || v_inner_qty::text ELSE '' END;
      v_per_box_summary := jsonb_build_array(jsonb_build_object(
        'name', v_item->>'name',
        'quantity', CASE WHEN v_inner_qty > 0 THEN v_inner_qty ELSE 1 END
      ));
      FOR v_i IN 1..v_box_count LOOP
        v_box_seq := v_box_seq + 1;
        INSERT INTO public.waybills(
          user_id, forwarding_id, shipping_method, status, payment_status, box_no, note, items_summary
        ) VALUES (
          uid, v_fo_id, v_route.shipping_method, 'pending', 'unpaid',
          lpad(v_box_seq::text, 3, '0'), v_item_note, v_per_box_summary
        );
      END LOOP;
    END LOOP;
  END IF;

  IF is_admin_action THEN
    SELECT COALESCE(full_name, email, caller_uid::text) INTO operator_name
      FROM public.profiles WHERE id = caller_uid;
    INSERT INTO public.admin_action_logs(entity_type, entity_id, action, after, operator_id, operator_name, note)
    VALUES (
      'customer_forwarding', v_fo_id, 'admin_create_forwarding',
      jsonb_build_object('request_no', v_req_no, 'waybills', v_total_boxes),
      caller_uid, operator_name, '代客户发起集运 ' || v_req_no
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_fo_id, 'request_no', v_req_no, 'waybills', v_total_boxes);
END $function$;
GRANT EXECUTE ON FUNCTION public.place_forwarding(jsonb, uuid) TO authenticated;
