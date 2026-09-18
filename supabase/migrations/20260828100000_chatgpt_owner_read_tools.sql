-- Read-only Owner capabilities for the EPLUS ChatGPT App.

CREATE OR REPLACE FUNCTION public.chatgpt_owner_access()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'authenticated', auth.uid() IS NOT NULL,
    'owner', auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'owner'::public.app_role),
    'staff', auth.uid() IS NOT NULL AND public.is_staff(auth.uid())
  );
$$;
REVOKE ALL ON FUNCTION public.chatgpt_owner_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_owner_access() TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_owner_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'owner'::public.app_role) THEN
    RAISE EXCEPTION 'owner access required';
  END IF;
  SELECT jsonb_build_object(
    'generated_at', now(),
    'currency', 'CAD',
    'customers', (SELECT count(*) FROM public.profiles),
    'active_ai_drafts', (SELECT count(*) FROM public.ai_forwarding_drafts WHERE status = 'active' AND expires_at >= now()),
    'forwarding_orders', jsonb_build_object(
      'pending', (SELECT count(*) FROM public.forwarding_orders WHERE status = 'pending'),
      'unpaid', (SELECT count(*) FROM public.forwarding_orders WHERE payment_status = 'unpaid'),
      'created_last_24h', (SELECT count(*) FROM public.forwarding_orders WHERE created_at >= now() - interval '24 hours')
    ),
    'waybills', jsonb_build_object(
      'total', (SELECT count(*) FROM public.waybills),
      'unpaid', (SELECT count(*) FROM public.waybills WHERE payment_status = 'unpaid'),
      'without_batch', (SELECT count(*) FROM public.waybills WHERE assigned_batch_id IS NULL),
      'fees_cad', (SELECT COALESCE(ROUND(sum(freight_cad + clearance_cad + duty_cad + insurance_cad + surcharge_cad), 2), 0) FROM public.waybills)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.chatgpt_owner_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_owner_dashboard() TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_owner_search_customers(_query text DEFAULT '', _limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'owner'::public.app_role) THEN
    RAISE EXCEPTION 'owner access required';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_result FROM (
    SELECT id, customer_code, full_name, email, phone, vip_level, is_blacklisted, created_at
    FROM public.profiles
    WHERE COALESCE(_query, '') = '' OR customer_code ILIKE '%' || _query || '%'
      OR full_name ILIKE '%' || _query || '%' OR email ILIKE '%' || _query || '%'
      OR phone ILIKE '%' || _query || '%'
    ORDER BY created_at DESC LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50)
  ) x;
  RETURN jsonb_build_object('customers', v_result, 'count', jsonb_array_length(v_result));
END;
$$;
REVOKE ALL ON FUNCTION public.chatgpt_owner_search_customers(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_owner_search_customers(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_owner_pending_forwardings(_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'owner'::public.app_role) THEN
    RAISE EXCEPTION 'owner access required';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_result FROM (
    SELECT f.id, f.request_no, f.customer_code, p.full_name AS customer_name,
      f.domestic_tracking_no, f.intl_tracking_no, f.route_code, f.shipping_method,
      f.status, f.payment_status, f.items_desc, f.declared_value_cad,
      f.created_at, f.updated_at
    FROM public.forwarding_orders f
    LEFT JOIN public.profiles p ON p.id = f.user_id
    WHERE f.status = 'pending' OR f.payment_status = 'unpaid'
    ORDER BY f.created_at ASC LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50)
  ) x;
  RETURN jsonb_build_object('currency', 'CAD', 'forwardings', v_result, 'count', jsonb_array_length(v_result));
END;
$$;
REVOKE ALL ON FUNCTION public.chatgpt_owner_pending_forwardings(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_owner_pending_forwardings(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_owner_get_forwarding(_request_no text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'owner'::public.app_role) THEN
    RAISE EXCEPTION 'owner access required';
  END IF;
  SELECT jsonb_build_object(
    'id', f.id, 'request_no', f.request_no, 'customer_code', f.customer_code,
    'customer_name', p.full_name, 'domestic_tracking_no', f.domestic_tracking_no,
    'intl_tracking_no', f.intl_tracking_no, 'route_code', f.route_code,
    'status', f.status, 'payment_status', f.payment_status, 'items_desc', f.items_desc,
    'declared_value_cad', f.declared_value_cad, 'note', f.note,
    'created_at', f.created_at, 'updated_at', f.updated_at
  ) INTO v_result
  FROM public.forwarding_orders f LEFT JOIN public.profiles p ON p.id = f.user_id
  WHERE f.request_no = _request_no;
  IF v_result IS NULL THEN RAISE EXCEPTION 'forwarding order not found'; END IF;
  RETURN jsonb_build_object('currency', 'CAD', 'forwarding', v_result);
END;
$$;
REVOKE ALL ON FUNCTION public.chatgpt_owner_get_forwarding(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_owner_get_forwarding(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_admin_search_orders(_query text DEFAULT '', _limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'staff access required';
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_result FROM (
    SELECT o.id, o.order_no, o.customer_code, p.full_name AS customer_name,
      o.status, o.payment_status, o.shipping_method, o.route_code,
      o.tracking_no, o.domestic_tracking_no, o.intl_tracking_no,
      ROUND(o.total_cny * COALESCE(NULLIF(o.fx_rate, 0), 0.19), 2) AS total_cad,
      o.created_at
    FROM public.orders o
    LEFT JOIN public.profiles p ON p.id = o.user_id
    WHERE COALESCE(_query, '') = '' OR o.order_no ILIKE '%' || _query || '%'
      OR o.customer_code ILIKE '%' || _query || '%' OR p.full_name ILIKE '%' || _query || '%'
      OR o.tracking_no ILIKE '%' || _query || '%' OR o.domestic_tracking_no ILIKE '%' || _query || '%'
      OR o.intl_tracking_no ILIKE '%' || _query || '%'
    ORDER BY o.created_at DESC LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50)
  ) x;
  RETURN jsonb_build_object('currency', 'CAD', 'orders', v_result, 'count', jsonb_array_length(v_result));
END;
$$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_search_orders(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_search_orders(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_admin_get_order(_order_no text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_order public.orders; v_customer jsonb; v_items jsonb; v_waybills jsonb; v_fx numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'staff access required';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE order_no = _order_no;
  IF v_order IS NULL THEN RAISE EXCEPTION 'order not found'; END IF;
  v_fx := COALESCE(NULLIF(v_order.fx_rate, 0), 0.19);
  SELECT jsonb_build_object('id', id, 'customer_code', customer_code, 'full_name', full_name, 'email', email, 'phone', phone)
    INTO v_customer FROM public.profiles WHERE id = v_order.user_id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'name_zh', i.name_zh, 'name_en', i.name_en, 'sku', i.sku,
    'quantity', i.quantity, 'paid', i.paid,
    'unit_price_cad', ROUND(i.unit_price_cny * v_fx, 2),
    'subtotal_cad', ROUND(i.subtotal_cny * v_fx, 2), 'waybill_id', i.waybill_id
  ) ORDER BY i.created_at), '[]'::jsonb) INTO v_items
  FROM public.order_items i WHERE i.order_id = v_order.id;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'waybill_no', w.waybill_no, 'status', w.status, 'payment_status', w.payment_status,
    'shipping_method', w.shipping_method, 'weight_kg', w.weight_kg,
    'length_cm', w.length_cm, 'width_cm', w.width_cm, 'height_cm', w.height_cm,
    'freight_cad', w.freight_cad, 'clearance_cad', w.clearance_cad,
    'duty_cad', w.duty_cad, 'insurance_cad', w.insurance_cad,
    'surcharge_cad', w.surcharge_cad, 'updated_at', w.updated_at
  ) ORDER BY w.created_at), '[]'::jsonb) INTO v_waybills
  FROM public.waybills w WHERE w.order_id = v_order.id;
  RETURN jsonb_build_object(
    'currency', 'CAD',
    'order', jsonb_build_object(
      'id', v_order.id, 'order_no', v_order.order_no, 'status', v_order.status,
      'payment_status', v_order.payment_status, 'shipping_method', v_order.shipping_method,
      'route_code', v_order.route_code, 'tracking_no', v_order.tracking_no,
      'domestic_tracking_no', v_order.domestic_tracking_no, 'intl_tracking_no', v_order.intl_tracking_no,
      'subtotal_cad', ROUND(v_order.subtotal_cny * v_fx, 2),
      'shipping_cad', ROUND(v_order.shipping_cny * v_fx, 2),
      'insurance_cad', ROUND(v_order.insurance_cny * v_fx, 2),
      'customs_cad', ROUND(v_order.customs_cny * v_fx, 2),
      'total_cad', ROUND(v_order.total_cny * v_fx, 2),
      'note', v_order.note, 'created_at', v_order.created_at
    ),
    'customer', v_customer, 'items', v_items, 'waybills', v_waybills
  );
END;
$$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_get_order(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_get_order(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_admin_get_customer(_customer_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile public.profiles;
  v_wallet jsonb;
  v_orders jsonb;
  v_forwardings jsonb;
  v_invoices jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'staff access required';
  END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE customer_code = _customer_code;
  IF v_profile IS NULL THEN RAISE EXCEPTION 'customer not found'; END IF;

  SELECT jsonb_build_object('balance_cad', COALESCE(balance_cad, 0), 'updated_at', updated_at)
    INTO v_wallet FROM public.wallets WHERE user_id = v_profile.id;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_orders FROM (
    SELECT o.order_no, o.status, o.payment_status, o.shipping_method,
      ROUND(o.total_cny * COALESCE(NULLIF(o.fx_rate, 0), 0.19), 2) AS total_cad,
      o.created_at
    FROM public.orders o WHERE o.user_id = v_profile.id
    ORDER BY o.created_at DESC LIMIT 10
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_forwardings FROM (
    SELECT f.request_no, f.status, f.payment_status, f.shipping_method,
      COALESCE((f.freight_snapshot->>'total_cad')::numeric,
        f.fee_cny * COALESCE(NULLIF((f.freight_snapshot->>'fx_rate')::numeric, 0), 0.19), 0) AS total_cad,
      f.created_at
    FROM public.forwarding_orders f WHERE f.user_id = v_profile.id
    ORDER BY f.created_at DESC LIMIT 10
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_invoices FROM (
    SELECT i.invoice_no, i.status, i.due_date,
      ROUND(i.total_cny * COALESCE(NULLIF(i.fx_rate, 0), 0.19), 2) AS total_cad,
      COALESCE(i.paid_cad, 0) AS paid_cad, i.created_at
    FROM public.invoices i WHERE i.user_id = v_profile.id
    ORDER BY i.created_at DESC LIMIT 10
  ) x;

  RETURN jsonb_build_object(
    'currency', 'CAD',
    'customer', jsonb_build_object(
      'id', v_profile.id, 'customer_code', v_profile.customer_code,
      'full_name', v_profile.full_name, 'email', v_profile.email, 'phone', v_profile.phone,
      'preferred_lang', v_profile.preferred_lang, 'vip_level', v_profile.vip_level,
      'is_blacklisted', v_profile.is_blacklisted, 'created_at', v_profile.created_at
    ),
    'wallet', COALESCE(v_wallet, jsonb_build_object('balance_cad', 0, 'updated_at', NULL)),
    'counts', jsonb_build_object(
      'orders', (SELECT count(*) FROM public.orders WHERE user_id = v_profile.id),
      'forwardings', (SELECT count(*) FROM public.forwarding_orders WHERE user_id = v_profile.id),
      'waybills', (SELECT count(*) FROM public.waybills WHERE user_id = v_profile.id),
      'invoices', (SELECT count(*) FROM public.invoices WHERE user_id = v_profile.id)
    ),
    'recent_orders', v_orders, 'recent_forwardings', v_forwardings, 'recent_invoices', v_invoices,
    'payment_available_here', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_get_customer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_get_customer(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_admin_search_invoices(
  _query text DEFAULT '',
  _status text DEFAULT NULL,
  _limit integer DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'staff access required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_result FROM (
    SELECT i.id, i.invoice_no, p.customer_code, p.full_name AS customer_name,
      i.type, i.status, i.batch_no, i.due_date,
      ROUND(i.total_cny * COALESCE(NULLIF(i.fx_rate, 0), 0.19), 2) AS total_cad,
      COALESCE(i.paid_cad, ROUND(i.paid_cny * COALESCE(NULLIF(i.fx_rate, 0), 0.19), 2), 0) AS paid_cad,
      i.paid_at, i.created_at, i.updated_at
    FROM public.invoices i
    LEFT JOIN public.profiles p ON p.id = i.user_id
    WHERE (COALESCE(_query, '') = '' OR i.invoice_no ILIKE '%' || _query || '%'
      OR p.customer_code ILIKE '%' || _query || '%' OR p.full_name ILIKE '%' || _query || '%'
      OR i.batch_no ILIKE '%' || _query || '%')
      AND (COALESCE(_status, '') = '' OR i.status::text = _status)
    ORDER BY i.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50)
  ) x;

  RETURN jsonb_build_object(
    'currency', 'CAD', 'invoices', v_result,
    'count', jsonb_array_length(v_result), 'payment_available_here', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_search_invoices(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_search_invoices(text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_admin_get_invoice(_invoice_no text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invoice public.invoices; v_customer jsonb; v_items jsonb; v_fx numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'staff access required';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE invoice_no = _invoice_no;
  IF v_invoice IS NULL THEN RAISE EXCEPTION 'invoice not found'; END IF;
  v_fx := COALESCE(NULLIF(v_invoice.fx_rate, 0), 0.19);

  SELECT jsonb_build_object(
    'id', id, 'customer_code', customer_code, 'full_name', full_name,
    'email', email, 'phone', phone
  ) INTO v_customer FROM public.profiles WHERE id = v_invoice.user_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ii.id, 'description', ii.description,
    'amount_cad', ROUND(ii.amount_cny * v_fx, 2),
    'freight_cad', ROUND(ii.freight_cny * v_fx, 2),
    'customs_cad', ROUND(ii.customs_cny * v_fx, 2),
    'insurance_cad', ROUND(ii.insurance_cny * v_fx, 2),
    'other_cad', ROUND(ii.other_cny * v_fx, 2),
    'waybill_id', ii.waybill_id, 'order_id', ii.order_id,
    'forwarding_id', ii.forwarding_id, 'created_at', ii.created_at
  ) ORDER BY ii.created_at), '[]'::jsonb) INTO v_items
  FROM public.invoice_items ii WHERE ii.invoice_id = v_invoice.id;

  RETURN jsonb_build_object(
    'currency', 'CAD',
    'invoice', jsonb_build_object(
      'id', v_invoice.id, 'invoice_no', v_invoice.invoice_no,
      'type', v_invoice.type, 'status', v_invoice.status,
      'subtotal_cad', ROUND(v_invoice.subtotal_cny * v_fx, 2),
      'freight_cad', ROUND(v_invoice.freight_cny * v_fx, 2),
      'customs_cad', ROUND(v_invoice.customs_cny * v_fx, 2),
      'insurance_cad', ROUND(v_invoice.insurance_cny * v_fx, 2),
      'other_cad', ROUND(v_invoice.other_cny * v_fx, 2),
      'total_cad', ROUND(v_invoice.total_cny * v_fx, 2),
      'paid_cad', COALESCE(v_invoice.paid_cad, ROUND(v_invoice.paid_cny * v_fx, 2), 0),
      'due_date', v_invoice.due_date, 'paid_at', v_invoice.paid_at,
      'batch_no', v_invoice.batch_no, 'period_start', v_invoice.period_start,
      'period_end', v_invoice.period_end, 'note', v_invoice.note,
      'created_at', v_invoice.created_at, 'updated_at', v_invoice.updated_at
    ),
    'customer', v_customer, 'items', v_items, 'payment_available_here', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_get_invoice(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_get_invoice(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_admin_search_forwardings(
  _query text DEFAULT '',
  _status text DEFAULT NULL,
  _limit integer DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'staff access required';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_result FROM (
    SELECT f.id, f.request_no, f.customer_code, p.full_name AS customer_name,
      f.domestic_tracking_no, f.intl_tracking_no, f.route_code, f.shipping_method,
      f.status, f.payment_status, f.items_desc, f.declared_value_cad,
      f.created_at, f.updated_at
    FROM public.forwarding_orders f
    LEFT JOIN public.profiles p ON p.id = f.user_id
    WHERE (COALESCE(_query, '') = '' OR f.request_no ILIKE '%' || _query || '%'
      OR f.customer_code ILIKE '%' || _query || '%' OR p.full_name ILIKE '%' || _query || '%'
      OR f.domestic_tracking_no ILIKE '%' || _query || '%'
      OR f.intl_tracking_no ILIKE '%' || _query || '%')
      AND (COALESCE(_status, '') = '' OR f.status::text = _status)
    ORDER BY f.created_at DESC
    LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50)
  ) x;

  RETURN jsonb_build_object(
    'currency', 'CAD', 'forwardings', v_result,
    'count', jsonb_array_length(v_result), 'payment_available_here', false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_search_forwardings(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_search_forwardings(text, text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_admin_search_batches(_query text DEFAULT '', _status text DEFAULT NULL, _limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'staff access required'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_result FROM (
    SELECT b.id,b.batch_no,b.status,b.shipping_method,b.cargo_type,b.destination_code,
      b.planned_ship_date,b.eta_date,b.waybill_count,b.total_weight_kg,b.total_volume_cm3,b.created_at,b.updated_at
    FROM public.batches b
    WHERE (COALESCE(_query,'')='' OR b.batch_no ILIKE '%'||_query||'%'
      OR b.destination_code ILIKE '%'||_query||'%' OR b.cargo_type ILIKE '%'||_query||'%')
      AND (COALESCE(_status,'')='' OR b.status::text=_status)
    ORDER BY b.created_at DESC LIMIT LEAST(GREATEST(COALESCE(_limit,20),1),50)
  ) x;
  RETURN jsonb_build_object('currency','CAD','batches',v_result,'count',jsonb_array_length(v_result),'payment_available_here',false);
END; $$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_search_batches(text,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_search_batches(text,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_admin_get_batch(_batch_no text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_batch public.batches; v_waybills jsonb; v_fee_cad numeric;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'staff access required'; END IF;
  SELECT * INTO v_batch FROM public.batches WHERE batch_no=_batch_no;
  IF v_batch IS NULL THEN RAISE EXCEPTION 'batch not found'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'waybill_no',w.waybill_no,'customer_code',p.customer_code,'customer_name',p.full_name,
    'status',w.status,'payment_status',w.payment_status,'weight_kg',w.weight_kg,
    'fee_cad',ROUND(w.freight_cad+w.clearance_cad+w.duty_cad+w.insurance_cad+w.surcharge_cad,2)
  ) ORDER BY w.created_at),'[]'::jsonb),
  COALESCE(ROUND(sum(w.freight_cad+w.clearance_cad+w.duty_cad+w.insurance_cad+w.surcharge_cad),2),0)
  INTO v_waybills,v_fee_cad FROM public.waybills w LEFT JOIN public.profiles p ON p.id=w.user_id
  WHERE w.assigned_batch_id=v_batch.id;
  RETURN jsonb_build_object('currency','CAD','batch',jsonb_build_object(
    'id',v_batch.id,'batch_no',v_batch.batch_no,'status',v_batch.status,
    'shipping_method',v_batch.shipping_method,'cargo_type',v_batch.cargo_type,
    'destination_code',v_batch.destination_code,'planned_ship_date',v_batch.planned_ship_date,
    'eta_date',v_batch.eta_date,'waybill_count',v_batch.waybill_count,
    'total_weight_kg',v_batch.total_weight_kg,'total_volume_cm3',v_batch.total_volume_cm3,
    'fee_total_cad',v_fee_cad,'notes',v_batch.notes,'created_at',v_batch.created_at,'updated_at',v_batch.updated_at
  ),'waybills',v_waybills,'payment_available_here',false);
END; $$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_get_batch(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_get_batch(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_admin_search_audit_logs(
  _query text DEFAULT '', _entity_type text DEFAULT NULL, _action text DEFAULT NULL,
  _date_from date DEFAULT NULL, _date_to date DEFAULT NULL, _limit integer DEFAULT 20
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'owner'::public.app_role) THEN RAISE EXCEPTION 'owner access required'; END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(x)), '[]'::jsonb) INTO v_result FROM (
    SELECT l.id,l.entity_type,l.entity_id,l.action,l.operator_name,l.note,l.created_at
    FROM public.admin_action_logs l
    WHERE (COALESCE(_query,'')='' OR l.operator_name ILIKE '%'||_query||'%'
      OR l.note ILIKE '%'||_query||'%' OR l.entity_id ILIKE '%'||_query||'%')
      AND (COALESCE(_entity_type,'')='' OR l.entity_type=_entity_type)
      AND (COALESCE(_action,'')='' OR l.action=_action)
      AND (_date_from IS NULL OR l.created_at>=_date_from::timestamptz)
      AND (_date_to IS NULL OR l.created_at<(_date_to+1)::timestamptz)
    ORDER BY l.created_at DESC LIMIT LEAST(GREATEST(COALESCE(_limit,20),1),50)
  ) x;
  RETURN jsonb_build_object('logs',v_result,'count',jsonb_array_length(v_result));
END; $$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_search_audit_logs(text,text,text,date,date,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_search_audit_logs(text,text,text,date,date,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.chatgpt_admin_get_audit_log(_log_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'owner'::public.app_role) THEN RAISE EXCEPTION 'owner access required'; END IF;
  SELECT jsonb_build_object('id',l.id,'entity_type',l.entity_type,'entity_id',l.entity_id,
    'action',l.action,'before',l.before,'after',l.after,'operator_id',l.operator_id,
    'operator_name',l.operator_name,'note',l.note,'created_at',l.created_at)
  INTO v FROM public.admin_action_logs l WHERE l.id=_log_id;
  IF v IS NULL THEN RAISE EXCEPTION 'audit log not found'; END IF;
  RETURN jsonb_build_object('audit_log',v);
END; $$;
REVOKE ALL ON FUNCTION public.chatgpt_admin_get_audit_log(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_admin_get_audit_log(uuid) TO authenticated;
