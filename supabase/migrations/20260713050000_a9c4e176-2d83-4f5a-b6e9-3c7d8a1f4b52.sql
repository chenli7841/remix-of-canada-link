-- Storage-fee settlement from "My inventory": customers can pay down accrued
-- storage fees directly (not tied to a batch). storage_fee_from is a separate
-- clock from intake_at — intake_at is the permanent warehouse-arrival record
-- and must never change; storage_fee_from resets to now() on each payment so
-- the next bill only covers days since the last payment.
ALTER TABLE public.forwarding_orders
  ADD COLUMN IF NOT EXISTS storage_fee_from timestamptz;

-- Read-only preview of what pay_storage_fees() would charge right now.
CREATE OR REPLACE FUNCTION public.preview_storage_fees()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    WHERE f.user_id = auth.uid()
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
  )
  FROM sf3;
$$;
GRANT EXECUTE ON FUNCTION public.preview_storage_fees() TO authenticated;

-- Actually charge: check balance -> deduct CAD -> invoice(+items) -> reset
-- storage_fee_from (never touches intake_at) -> award points.
CREATE OR REPLACE FUNCTION public.pay_storage_fees()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  rate numeric := public.current_fx_cny_to_cad();
  total_cad numeric := 0;
  total_cny numeric := 0;
  bal numeric := 0;
  v_inv_id uuid;
  v_inv_no text;
  v_points integer;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;

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
  VALUES (uid, 'spend', total_cny, total_cad, rate, 'completed', 'storage', '仓库扣费');

  INSERT INTO public.invoices(user_id, type, status, subtotal_cny, total_cny, paid_cny, fx_rate, currency, paid_at, paid_cad, note)
  VALUES (uid, 'manual', 'paid', total_cny, total_cny, total_cny, rate, 'CNY', now(), total_cad, '仓储费结算')
  RETURNING id, invoice_no INTO v_inv_id, v_inv_no;

  INSERT INTO public.invoice_items(invoice_id, forwarding_id, description, amount_cny)
  SELECT v_inv_id, forwarding_id,
    '仓储费 · ' || COALESCE(request_no, forwarding_id::text) || '（' || billable_days || ' 天 · ' || cbm_charged || ' cbm）',
    round(fee_cad / rate, 2)
  FROM _sf;

  UPDATE public.forwarding_orders SET storage_fee_from = now()
  WHERE id IN (SELECT forwarding_id FROM _sf);

  v_points := public.award_points_for_spend(uid, total_cad);

  RETURN jsonb_build_object(
    'ok', true, 'paid_cad', total_cad, 'paid_cny', total_cny,
    'invoice_id', v_inv_id, 'invoice_no', v_inv_no, 'points_earned', v_points
  );
END $$;
GRANT EXECUTE ON FUNCTION public.pay_storage_fees() TO authenticated;
