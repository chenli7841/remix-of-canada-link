-- Customer-scoped pending-intake diagnosis and confirmed tracking correction for ChatGPT.
CREATE OR REPLACE FUNCTION public.chatgpt_diagnose_my_pending_intake(_tracking_no text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_input text := upper(regexp_replace(trim(COALESCE(_tracking_no, '')), '\s+', '', 'g'));
  v_exact jsonb;
  v_candidates jsonb := '[]'::jsonb;
  v_detained jsonb;
  v_first_scan_at timestamptz;
  v_order_created_at timestamptz;
  v_order_intake_at timestamptz;
  v_result_code text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF length(v_input) < 5 OR length(v_input) > 100 THEN RAISE EXCEPTION 'valid tracking number required'; END IF;

  SELECT to_jsonb(x) INTO v_exact FROM (
    SELECT 'forwarding'::text AS order_type, f.id AS record_id, f.request_no AS order_no,
      upper(f.domestic_tracking_no) AS system_tracking_no, f.status::text AS status,
      f.created_at, f.updated_at, f.intake_at
    FROM public.forwarding_orders f
    WHERE f.user_id = v_uid AND upper(COALESCE(f.domestic_tracking_no, '')) = v_input
      AND f.status::text <> 'cancelled'
    UNION ALL
    SELECT 'order'::text, o.id, o.order_no, upper(o.domestic_tracking_no), o.status::text,
      o.created_at, o.updated_at, NULL::timestamptz
    FROM public.orders o
    WHERE o.user_id = v_uid AND upper(COALESCE(o.domestic_tracking_no, '')) = v_input
      AND o.status::text <> 'cancelled'
    LIMIT 1
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.score DESC, c.created_at DESC), '[]'::jsonb)
  INTO v_candidates
  FROM (
    SELECT * FROM (
      SELECT 'forwarding'::text AS order_type, f.id AS record_id, f.request_no AS order_no,
        upper(f.domestic_tracking_no) AS system_tracking_no, f.status::text AS status,
        f.created_at, f.updated_at,
        similarity(upper(f.domestic_tracking_no), v_input) AS score,
        CASE
          WHEN length(f.domestic_tracking_no) = length(v_input) THEN 'one_or_more_characters_different'
          WHEN length(f.domestic_tracking_no) = length(v_input) - 1 THEN 'system_number_may_be_missing_one_character'
          WHEN length(f.domestic_tracking_no) = length(v_input) + 1 THEN 'system_number_may_have_one_extra_character'
          ELSE 'similar_number'
        END AS difference_type
      FROM public.forwarding_orders f
      WHERE f.user_id = v_uid AND f.domestic_tracking_no IS NOT NULL AND f.intake_at IS NULL
        AND f.status::text NOT IN ('cancelled','delivered')
        AND upper(f.domestic_tracking_no) <> v_input
        AND abs(length(f.domestic_tracking_no) - length(v_input)) <= 1
        AND similarity(upper(f.domestic_tracking_no), v_input) >= 0.55
      UNION ALL
      SELECT 'order'::text, o.id, o.order_no, upper(o.domestic_tracking_no), o.status::text,
        o.created_at, o.updated_at,
        similarity(upper(o.domestic_tracking_no), v_input),
        CASE
          WHEN length(o.domestic_tracking_no) = length(v_input) THEN 'one_or_more_characters_different'
          WHEN length(o.domestic_tracking_no) = length(v_input) - 1 THEN 'system_number_may_be_missing_one_character'
          WHEN length(o.domestic_tracking_no) = length(v_input) + 1 THEN 'system_number_may_have_one_extra_character'
          ELSE 'similar_number'
        END
      FROM public.orders o
      WHERE o.user_id = v_uid AND o.domestic_tracking_no IS NOT NULL
        AND o.status::text = 'pending'
        AND upper(o.domestic_tracking_no) <> v_input
        AND abs(length(o.domestic_tracking_no) - length(v_input)) <= 1
        AND similarity(upper(o.domestic_tracking_no), v_input) >= 0.55
    ) u ORDER BY score DESC, created_at DESC LIMIT 5
  ) c;

  -- A detained number is only returned when it is the supplied number, belongs to the
  -- authenticated customer's code, or closely corresponds to one of that customer's candidates.
  SELECT to_jsonb(d) INTO v_detained
  FROM (
    SELECT dp.id, upper(dp.domestic_tracking_no) AS tracking_no, dp.status,
      dp.created_at AS first_scan_at, dp.released_at
    FROM public.detained_packages dp
    LEFT JOIN public.profiles p ON p.id = v_uid
    WHERE upper(dp.domestic_tracking_no) = v_input
      AND (dp.customer_code IS NULL OR dp.customer_code = p.customer_code OR jsonb_array_length(v_candidates) > 0 OR v_exact IS NOT NULL)
    ORDER BY dp.created_at ASC LIMIT 1
  ) d;

  IF v_detained IS NULL AND (v_exact IS NOT NULL OR jsonb_array_length(v_candidates) > 0) THEN
    SELECT to_jsonb(d) INTO v_detained
    FROM (
      SELECT dp.id, upper(dp.domestic_tracking_no) AS tracking_no, dp.status,
        dp.created_at AS first_scan_at, dp.released_at
      FROM public.detained_packages dp
      WHERE abs(length(dp.domestic_tracking_no) - length(v_input)) <= 1
        AND similarity(upper(dp.domestic_tracking_no), v_input) >= 0.55
      ORDER BY similarity(upper(dp.domestic_tracking_no), v_input) DESC, dp.created_at ASC LIMIT 1
    ) d;
  END IF;

  IF v_detained IS NOT NULL THEN v_first_scan_at := (v_detained->>'first_scan_at')::timestamptz; END IF;
  IF v_exact IS NOT NULL THEN
    v_order_created_at := (v_exact->>'created_at')::timestamptz;
    v_order_intake_at := NULLIF(v_exact->>'intake_at', '')::timestamptz;
  END IF;

  v_result_code := CASE
    WHEN v_order_intake_at IS NOT NULL THEN 'already_intaked'
    WHEN v_exact IS NOT NULL AND v_first_scan_at IS NOT NULL AND v_first_scan_at < v_order_created_at THEN 'late_order_entry'
    WHEN v_exact IS NOT NULL AND v_first_scan_at IS NOT NULL THEN 'awaiting_second_scan'
    WHEN v_exact IS NOT NULL THEN 'scan_not_found'
    WHEN jsonb_array_length(v_candidates) > 0 AND v_detained IS NOT NULL THEN 'possible_tracking_typo'
    WHEN v_detained IS NOT NULL THEN 'detained_without_customer_order'
    ELSE 'not_found'
  END;

  RETURN jsonb_build_object(
    'input_tracking_no', v_input,
    'result_code', v_result_code,
    'exact_order', v_exact,
    'detained_record', v_detained,
    'similar_pending_orders', v_candidates,
    'first_scan_at', v_first_scan_at,
    'order_created_at', v_order_created_at,
    'requires_customer_confirmation', v_result_code = 'possible_tracking_typo',
    'can_request_tracking_correction', v_result_code = 'possible_tracking_typo'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.chatgpt_correct_my_pending_tracking(
  _order_type text,
  _record_id uuid,
  _expected_tracking_no text,
  _new_tracking_no text,
  _reason text,
  _confirmation text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old text := upper(regexp_replace(trim(COALESCE(_expected_tracking_no, '')), '\s+', '', 'g'));
  v_new text := upper(regexp_replace(trim(COALESCE(_new_tracking_no, '')), '\s+', '', 'g'));
  v_current text;
  v_order_no text;
  v_status text;
  v_intake_at timestamptz;
  v_operator_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  IF _confirmation <> 'CONFIRM_CORRECT_PENDING_TRACKING' THEN RAISE EXCEPTION 'explicit confirmation required'; END IF;
  IF length(trim(COALESCE(_reason, ''))) < 2 OR length(_reason) > 500 THEN RAISE EXCEPTION 'reason is required'; END IF;
  IF length(v_new) < 5 OR length(v_new) > 100 OR v_new = v_old THEN RAISE EXCEPTION 'valid different tracking number required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.detained_packages WHERE upper(domestic_tracking_no) = v_new AND status = 'detained') THEN
    RAISE EXCEPTION 'new tracking number is not an active detained number';
  END IF;
  IF EXISTS (SELECT 1 FROM public.forwarding_orders WHERE user_id=v_uid AND upper(COALESCE(domestic_tracking_no,''))=v_new AND status::text<>'cancelled')
     OR EXISTS (SELECT 1 FROM public.orders WHERE user_id=v_uid AND upper(COALESCE(domestic_tracking_no,''))=v_new AND status::text<>'cancelled') THEN
    RAISE EXCEPTION 'tracking number already belongs to another active order';
  END IF;

  IF _order_type = 'forwarding' THEN
    SELECT upper(COALESCE(domestic_tracking_no,'')), request_no, status::text, intake_at
      INTO v_current, v_order_no, v_status, v_intake_at
    FROM public.forwarding_orders WHERE id=_record_id AND user_id=v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'order not found or no permission'; END IF;
    IF v_current <> v_old THEN RAISE EXCEPTION 'tracking number changed; diagnose again'; END IF;
    IF v_intake_at IS NOT NULL OR v_status IN ('cancelled','delivered') THEN RAISE EXCEPTION 'order is no longer pending intake'; END IF;
    UPDATE public.forwarding_orders SET domestic_tracking_no=v_new WHERE id=_record_id;
  ELSIF _order_type = 'order' THEN
    SELECT upper(COALESCE(domestic_tracking_no,'')), order_no, status::text
      INTO v_current, v_order_no, v_status
    FROM public.orders WHERE id=_record_id AND user_id=v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'order not found or no permission'; END IF;
    IF v_current <> v_old THEN RAISE EXCEPTION 'tracking number changed; diagnose again'; END IF;
    IF v_status <> 'pending' THEN RAISE EXCEPTION 'order is no longer pending intake'; END IF;
    UPDATE public.orders SET domestic_tracking_no=v_new WHERE id=_record_id;
  ELSE
    RAISE EXCEPTION 'unsupported order type';
  END IF;

  SELECT COALESCE(full_name,email,v_uid::text) INTO v_operator_name FROM public.profiles WHERE id=v_uid;
  INSERT INTO public.admin_action_logs(entity_type,entity_id,action,before,after,operator_id,operator_name,note)
  VALUES (CASE WHEN _order_type='forwarding' THEN 'forwarding' ELSE 'order' END,
    _record_id,'customer_correct_pending_tracking',
    jsonb_build_object('domestic_tracking_no',v_old),jsonb_build_object('domestic_tracking_no',v_new),
    v_uid,v_operator_name,'[ChatGPT Customer] '||trim(_reason));

  RETURN jsonb_build_object('ok',true,'order_type',_order_type,'record_id',_record_id,'order_no',v_order_no,
    'before_tracking_no',v_old,'after_tracking_no',v_new,'audit_recorded',true,
    'next_step','等待仓库重新扫描或人工核对后入库');
END;
$$;

REVOKE ALL ON FUNCTION public.chatgpt_diagnose_my_pending_intake(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.chatgpt_correct_my_pending_tracking(text,uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chatgpt_diagnose_my_pending_intake(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.chatgpt_correct_my_pending_tracking(text,uuid,text,text,text,text) TO authenticated;
