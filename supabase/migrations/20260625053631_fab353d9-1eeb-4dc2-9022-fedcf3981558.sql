CREATE OR REPLACE FUNCTION public.admin_change_route(
  _entity_type text,
  _entity_id   uuid,
  _new_route_code text,
  _operator_id uuid DEFAULT NULL,
  _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_route public.shipping_routes;
  v_old_no text; v_new_no text;
  v_cust text;
  v_wb record;
  v_changed int := 0;
  v_old_route text; v_old_dest text;
  v_op_name text;
BEGIN
  IF _operator_id IS NULL THEN _operator_id := auth.uid(); END IF;
  IF _operator_id IS NULL OR NOT public.is_staff(_operator_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_route FROM public.shipping_routes WHERE code = _new_route_code AND is_active = true;
  IF v_route IS NULL THEN RAISE EXCEPTION '线路 % 不可用', _new_route_code; END IF;

  IF _entity_type = 'order' THEN
    SELECT order_no, customer_code, route_code, destination_code
      INTO v_old_no, v_cust, v_old_route, v_old_dest
      FROM public.orders WHERE id = _entity_id;
    IF v_old_no IS NULL THEN RAISE EXCEPTION 'order not found'; END IF;
    IF v_old_route = v_route.code AND COALESCE(v_old_dest,'') = COALESCE(v_route.destination_code,'') THEN
      RETURN jsonb_build_object('ok', true, 'changed', 0, 'unchanged', true);
    END IF;
    UPDATE public.orders SET
      route_code = v_route.code, destination_code = v_route.destination_code,
      route_id = v_route.id, shipping_method = v_route.shipping_method,
      aliases = (CASE WHEN v_old_no = ANY(aliases) THEN aliases ELSE aliases || v_old_no END),
      order_no = 'SC' || lpad(COALESCE(v_cust,''),5,'0') || upper(v_route.code)
                 || to_char(now(),'YYMMDD') || upper(COALESCE(v_route.destination_code,'XXX'))
                 || lpad((floor(random()*100000))::text,5,'0')
    WHERE id = _entity_id RETURNING order_no INTO v_new_no;
  ELSIF _entity_type = 'forwarding' THEN
    SELECT request_no, customer_code, route_code, destination_code
      INTO v_old_no, v_cust, v_old_route, v_old_dest
      FROM public.forwarding_orders WHERE id = _entity_id;
    IF v_old_no IS NULL THEN RAISE EXCEPTION 'forwarding not found'; END IF;
    IF v_old_route = v_route.code AND COALESCE(v_old_dest,'') = COALESCE(v_route.destination_code,'') THEN
      RETURN jsonb_build_object('ok', true, 'changed', 0, 'unchanged', true);
    END IF;
    UPDATE public.forwarding_orders SET
      route_code = v_route.code, destination_code = v_route.destination_code,
      route_id = v_route.id, shipping_method = v_route.shipping_method,
      aliases = (CASE WHEN v_old_no = ANY(aliases) THEN aliases ELSE aliases || v_old_no END),
      request_no = 'FW' || lpad(COALESCE(v_cust,''),5,'0') || upper(v_route.code)
                   || to_char(now(),'YYMMDD') || upper(COALESCE(v_route.destination_code,'XXX'))
                   || lpad((floor(random()*100000))::text,5,'0')
    WHERE id = _entity_id RETURNING request_no INTO v_new_no;
  ELSE
    RAISE EXCEPTION 'unknown entity_type %', _entity_type;
  END IF;

  FOR v_wb IN
    SELECT id, waybill_no FROM public.waybills
     WHERE (_entity_type='order' AND order_id = _entity_id)
        OR (_entity_type='forwarding' AND forwarding_id = _entity_id)
  LOOP
    UPDATE public.waybills SET
      waybill_no = public.gen_waybill_no(v_cust, v_route.code, v_route.destination_code, v_route.shipping_method),
      aliases = (CASE WHEN v_wb.waybill_no = ANY(aliases) THEN aliases ELSE aliases || v_wb.waybill_no END),
      shipping_method = v_route.shipping_method
    WHERE id = v_wb.id;
    v_changed := v_changed + 1;
  END LOOP;

  IF _entity_type = 'order' THEN
    PERFORM public.recompute_mark_nos_for_parent(_entity_id, NULL);
  ELSE
    PERFORM public.recompute_mark_nos_for_parent(NULL, _entity_id);
  END IF;

  SELECT full_name INTO v_op_name FROM public.profiles WHERE id = _operator_id;

  INSERT INTO public.admin_action_logs (operator_id, operator_name, action, entity_type, entity_id, before, after, note)
  VALUES (_operator_id, v_op_name, 'change_route', _entity_type, _entity_id,
          jsonb_build_object('route_code', v_old_route, 'destination_code', v_old_dest, 'no', v_old_no),
          jsonb_build_object('route_code', v_route.code, 'destination_code', v_route.destination_code, 'no', v_new_no, 'waybills_changed', v_changed),
          COALESCE(_note, '线路变更 ' || COALESCE(v_old_route,'') || '→' || v_route.code));

  RETURN jsonb_build_object('ok', true, 'old_no', v_old_no, 'new_no', v_new_no, 'waybills_changed', v_changed);
END $$;