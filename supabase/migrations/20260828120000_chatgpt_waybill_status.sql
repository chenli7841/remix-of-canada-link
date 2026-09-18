-- ChatGPT mappings of existing getWaybillDetail and setWaybillStatus admin operations.
CREATE OR REPLACE FUNCTION public.chatgpt_admin_get_waybill(_waybill_no text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'staff access required'; END IF;
  SELECT jsonb_build_object('id',w.id,'waybill_no',w.waybill_no,'intl_tracking_no',w.intl_tracking_no,
    'status',w.status,'payment_status',w.payment_status,'shipping_method',w.shipping_method,
    'weight_kg',w.weight_kg,'length_cm',w.length_cm,'width_cm',w.width_cm,'height_cm',w.height_cm,
    'freight_cad',w.freight_cad,'clearance_cad',w.clearance_cad,'duty_cad',w.duty_cad,
    'insurance_cad',w.insurance_cad,'surcharge_cad',w.surcharge_cad,'note',w.note,
    'customer_code',p.customer_code,'customer_name',p.full_name,'updated_at',w.updated_at)
  INTO v FROM public.waybills w LEFT JOIN public.profiles p ON p.id=w.user_id WHERE w.waybill_no=_waybill_no;
  IF v IS NULL THEN RAISE EXCEPTION 'waybill not found'; END IF;
  RETURN jsonb_build_object('currency','CAD','waybill',v);
END; $$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_get_waybill(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_get_waybill(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_manager_set_waybill_status(
  _waybill_no text,_expected_updated_at timestamptz,_status public.waybill_status,
  _reason text,_confirmation text,_public_event jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.waybills; operator_name text; ship_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(),'owner'::public.app_role) OR public.has_role(auth.uid(),'manager'::public.app_role))
    THEN RAISE EXCEPTION 'manager access required'; END IF;
  IF _confirmation <> 'CONFIRM_WAYBILL_STATUS' THEN RAISE EXCEPTION 'explicit confirmation required'; END IF;
  IF length(trim(COALESCE(_reason,'')))<2 OR length(_reason)>500 THEN RAISE EXCEPTION 'reason is required'; END IF;
  SELECT * INTO w FROM public.waybills WHERE waybill_no=_waybill_no FOR UPDATE;
  IF w IS NULL THEN RAISE EXCEPTION 'waybill not found'; END IF;
  IF w.updated_at<>_expected_updated_at THEN RAISE EXCEPTION 'waybill changed; review again'; END IF;
  IF w.status=_status THEN RETURN jsonb_build_object('ok',true,'unchanged',true,'waybill_no',w.waybill_no,'status',w.status); END IF;
  UPDATE public.waybills SET status=_status WHERE id=w.id;
  SELECT COALESCE(full_name,email,auth.uid()::text) INTO operator_name FROM public.profiles WHERE id=auth.uid();
  INSERT INTO public.admin_action_logs(entity_type,entity_id,action,before,after,operator_id,operator_name,note)
  VALUES('waybill',w.id::text,'set_status',jsonb_build_object('status',w.status),jsonb_build_object('status',_status),
    auth.uid(),operator_name,'[ChatGPT] '||trim(_reason));
  IF _public_event IS NOT NULL THEN
    IF length(trim(COALESCE(_public_event->>'status_zh','')))<1 THEN RAISE EXCEPTION 'public event status required'; END IF;
    SELECT id INTO ship_id FROM public.shipments WHERE tracking_no=w.waybill_no LIMIT 1;
    IF ship_id IS NULL THEN INSERT INTO public.shipments(tracking_no,status) VALUES(w.waybill_no,'created') RETURNING id INTO ship_id; END IF;
    INSERT INTO public.tracking_events(shipment_id,status_zh,status_en,location_zh,location_en,source)
    VALUES(ship_id,_public_event->>'status_zh',COALESCE(_public_event->>'status_en',_public_event->>'status_zh'),
      NULLIF(_public_event->>'location_zh',''),NULLIF(_public_event->>'location_en',''),'admin_action');
  END IF;
  RETURN jsonb_build_object('ok',true,'unchanged',false,'waybill_no',w.waybill_no,'before_status',w.status,'status',_status,'audit_recorded',true);
END; $$;
REVOKE ALL ON FUNCTION public.chatgpt_manager_set_waybill_status(text,timestamptz,public.waybill_status,text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_manager_set_waybill_status(text,timestamptz,public.waybill_status,text,text,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_admin_search_waybills(
  _query text DEFAULT '',
  _status text DEFAULT NULL,
  _limit integer DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'staff access required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_result FROM (
    SELECT w.id, w.waybill_no, w.intl_tracking_no,
      p.customer_code, p.full_name AS customer_name,
      o.order_no, f.request_no AS forwarding_request_no,
      w.status, w.payment_status, w.shipping_method,
      w.weight_kg, w.length_cm, w.width_cm, w.height_cm,
      w.freight_cad, w.clearance_cad, w.duty_cad,
      w.insurance_cad, w.surcharge_cad, w.created_at, w.updated_at
    FROM public.waybills w
    LEFT JOIN public.profiles p ON p.id = w.user_id
    LEFT JOIN public.orders o ON o.id = w.order_id
    LEFT JOIN public.forwarding_orders f ON f.id = w.forwarding_id
    WHERE (COALESCE(_query, '') = '' OR w.waybill_no ILIKE '%' || _query || '%'
      OR w.intl_tracking_no ILIKE '%' || _query || '%'
      OR o.domestic_tracking_no ILIKE '%' || _query || '%'
      OR f.domestic_tracking_no ILIKE '%' || _query || '%'
      OR p.customer_code ILIKE '%' || _query || '%' OR p.full_name ILIKE '%' || _query || '%'
      OR o.order_no ILIKE '%' || _query || '%' OR f.request_no ILIKE '%' || _query || '%')
      AND (COALESCE(_status, '') = '' OR w.status::text = _status)
    ORDER BY w.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50)
  ) x;

  RETURN jsonb_build_object(
    'currency', 'CAD', 'waybills', v_result,
    'count', jsonb_array_length(v_result), 'payment_available_here', false
  );
END; $$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_search_waybills(text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_search_waybills(text,text,integer) TO authenticated;
