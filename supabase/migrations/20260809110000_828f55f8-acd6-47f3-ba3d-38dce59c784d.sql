-- pay_storage_fees(): carry the same per-line `meta` the batch-settlement
-- path now writes (see settleBatchForCustomer / duty.server.ts), so the
-- invoice's 其他费用 table can show 仓储费's own relevant columns (billing
-- period, cbm charged, rate) instead of just a description string. Also
-- sets invoices.other_cny (was left at its 0 default), since this whole
-- invoice IS an "other fee" — the footer's 其他 total was silently showing
-- 0 for every storage-fee invoice before this.
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

  RETURN jsonb_build_object(
    'ok', true, 'paid_cad', total_cad, 'paid_cny', total_cny,
    'invoice_id', v_inv_id, 'invoice_no', v_inv_no, 'points_earned', v_points
  );
END $$;
GRANT EXECUTE ON FUNCTION public.pay_storage_fees() TO authenticated;
