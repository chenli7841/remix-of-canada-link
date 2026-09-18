-- ChatGPT mapping of the existing admin updateForwardingBasicInfo operation.
CREATE OR REPLACE FUNCTION public.chatgpt_owner_update_forwarding_basic_info(
  _request_no text, _expected_updated_at timestamptz, _patch jsonb,
  _reason text, _confirmation text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order public.forwarding_orders; v_before jsonb; v_after jsonb;
  v_operator_name text; v_key text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'owner'::public.app_role) THEN RAISE EXCEPTION 'owner access required'; END IF;
  IF _confirmation <> 'CONFIRM_UPDATE_FORWARDING' THEN RAISE EXCEPTION 'explicit confirmation required'; END IF;
  IF length(trim(COALESCE(_reason, ''))) < 2 OR length(_reason) > 500 THEN RAISE EXCEPTION 'reason is required'; END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' OR _patch = '{}'::jsonb THEN RAISE EXCEPTION 'patch required'; END IF;
  FOR v_key IN SELECT jsonb_object_keys(_patch) LOOP
    IF v_key NOT IN ('warehouse','shipping_method','destination_code','domestic_tracking_no','intl_tracking_no') THEN
      RAISE EXCEPTION 'field is not editable in admin: %', v_key;
    END IF;
  END LOOP;
  SELECT * INTO v_order FROM public.forwarding_orders WHERE request_no = _request_no FOR UPDATE;
  IF v_order IS NULL THEN RAISE EXCEPTION 'forwarding order not found'; END IF;
  IF v_order.updated_at <> _expected_updated_at THEN RAISE EXCEPTION 'order changed; review again'; END IF;
  v_before := jsonb_build_object('warehouse',v_order.warehouse,'shipping_method',v_order.shipping_method,
    'destination_code',v_order.destination_code,'domestic_tracking_no',v_order.domestic_tracking_no,'intl_tracking_no',v_order.intl_tracking_no);
  UPDATE public.forwarding_orders SET
    warehouse=CASE WHEN _patch?'warehouse' THEN NULLIF(trim(_patch->>'warehouse'),'') ELSE warehouse END,
    shipping_method=CASE WHEN _patch?'shipping_method' THEN NULLIF(trim(_patch->>'shipping_method'),'') ELSE shipping_method END,
    destination_code=CASE WHEN _patch?'destination_code' THEN NULLIF(trim(_patch->>'destination_code'),'') ELSE destination_code END,
    domestic_tracking_no=CASE WHEN _patch?'domestic_tracking_no' THEN NULLIF(trim(_patch->>'domestic_tracking_no'),'') ELSE domestic_tracking_no END,
    intl_tracking_no=CASE WHEN _patch?'intl_tracking_no' THEN NULLIF(trim(_patch->>'intl_tracking_no'),'') ELSE intl_tracking_no END
  WHERE id=v_order.id RETURNING jsonb_build_object('warehouse',warehouse,'shipping_method',shipping_method,
    'destination_code',destination_code,'domestic_tracking_no',domestic_tracking_no,'intl_tracking_no',intl_tracking_no,'updated_at',updated_at) INTO v_after;
  SELECT COALESCE(full_name,email,auth.uid()::text) INTO v_operator_name FROM public.profiles WHERE id=auth.uid();
  INSERT INTO public.admin_action_logs(entity_type,entity_id,action,before,after,operator_id,operator_name,note)
  VALUES ('forwarding',v_order.id::text,'update_basic_info',v_before,v_after,auth.uid(),v_operator_name,'[ChatGPT Owner] '||trim(_reason));
  RETURN jsonb_build_object('ok',true,'request_no',v_order.request_no,'before',v_before,'after',v_after,'audit_recorded',true);
END; $$;
REVOKE ALL ON FUNCTION public.chatgpt_owner_update_forwarding_basic_info(text,timestamptz,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_owner_update_forwarding_basic_info(text,timestamptz,jsonb,text,text) TO authenticated;
