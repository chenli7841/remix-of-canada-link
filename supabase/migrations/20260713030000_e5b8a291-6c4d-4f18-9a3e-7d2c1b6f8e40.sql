-- Batch wallet payment (pay_batch) already checked balance and deducted CAD, but
-- never created an invoice (unlike place_shop_order) and never marked the
-- batch's waybills as paid (only orders/forwarding_orders). Rebuild it to do
-- all three: check balance -> deduct -> create invoice(+items) -> mark
-- orders/forwarding_orders/waybills paid.
CREATE OR REPLACE FUNCTION public.pay_batch(_batch_no text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  rate numeric := public.current_fx_cny_to_cad();
  total_cny numeric := 0;
  total_cad numeric := 0;
  bal numeric := 0;
  v_freight_cny numeric := 0;
  v_customs_cny numeric := 0;
  v_insurance_cny numeric := 0;
  v_subtotal_cny numeric := 0;
  v_other_cny numeric := 0;
  v_inv_id uuid;
  v_inv_no text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _batch_no IS NULL OR _batch_no = '' THEN RAISE EXCEPTION 'batch_no required'; END IF;

  SELECT COALESCE(SUM(total_cny),0) INTO total_cny
  FROM public.orders WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid';

  SELECT total_cny + COALESCE((SELECT SUM(COALESCE(fee_cny,0)) FROM public.forwarding_orders
     WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid'),0)
  INTO total_cny;

  IF total_cny <= 0 THEN RETURN jsonb_build_object('ok', false, 'reason','nothing_to_pay'); END IF;

  total_cad := round(total_cny * rate, 2);

  SELECT COALESCE(balance_cad,0) INTO bal FROM public.wallets WHERE user_id = uid;
  IF bal < total_cad THEN
    RETURN jsonb_build_object('ok', false, 'reason','insufficient', 'need_cad', total_cad, 'balance_cad', bal);
  END IF;

  -- Best-effort freight/customs/insurance breakdown for the invoice header
  -- (orders carry real columns; forwarding only breaks out customs, so its
  -- remainder is treated as freight). Any rounding slack lands in other_cny
  -- so the header rows always foot to total_cny exactly.
  SELECT COALESCE(SUM(shipping_cny),0), COALESCE(SUM(customs_cny),0), COALESCE(SUM(insurance_cny),0), COALESCE(SUM(subtotal_cny),0)
  INTO v_freight_cny, v_customs_cny, v_insurance_cny, v_subtotal_cny
  FROM public.orders WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid';

  v_freight_cny := v_freight_cny + COALESCE((
    SELECT SUM(GREATEST(COALESCE(fee_cny,0) - COALESCE(customs_cny,0), 0))
    FROM public.forwarding_orders WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid'
  ), 0);
  v_customs_cny := v_customs_cny + COALESCE((
    SELECT SUM(COALESCE(customs_cny,0))
    FROM public.forwarding_orders WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid'
  ), 0);
  v_other_cny := total_cny - (v_freight_cny + v_customs_cny + v_insurance_cny + v_subtotal_cny);

  INSERT INTO public.wallet_transactions (user_id, type, amount_cny, amount_cad, fx_rate_cny_to_cad, status, channel, note)
  VALUES (uid, 'spend', total_cny, total_cad, rate, 'completed', 'batch', '集运扣款 · 批次 ' || _batch_no);

  INSERT INTO public.invoices(
    user_id, type, status, batch_no, subtotal_cny, freight_cny, customs_cny, insurance_cny, other_cny,
    total_cny, paid_cny, fx_rate, currency, paid_at, paid_cad, note
  ) VALUES (
    uid, 'batch', 'paid', _batch_no, v_subtotal_cny, v_freight_cny, v_customs_cny, v_insurance_cny, v_other_cny,
    total_cny, total_cny, rate, 'CNY', now(), total_cad, '批次 ' || _batch_no
  ) RETURNING id, invoice_no INTO v_inv_id, v_inv_no;

  INSERT INTO public.invoice_items(invoice_id, order_id, description, freight_cny, customs_cny, insurance_cny, amount_cny)
  SELECT v_inv_id, o.id, '订单 ' || o.order_no, o.shipping_cny, o.customs_cny, o.insurance_cny, o.total_cny
  FROM public.orders o WHERE o.user_id = uid AND o.batch_no = _batch_no AND o.payment_status = 'unpaid';

  INSERT INTO public.invoice_items(invoice_id, forwarding_id, description, freight_cny, customs_cny, insurance_cny, amount_cny)
  SELECT v_inv_id, f.id, '集运 ' || COALESCE(f.request_no, f.id::text),
         GREATEST(COALESCE(f.fee_cny,0) - COALESCE(f.customs_cny,0), 0), COALESCE(f.customs_cny,0), 0, COALESCE(f.fee_cny,0)
  FROM public.forwarding_orders f WHERE f.user_id = uid AND f.batch_no = _batch_no AND f.payment_status = 'unpaid';

  UPDATE public.orders SET payment_status = 'paid', status = CASE WHEN status='pending' THEN 'paid'::order_status ELSE status END
   WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid';
  UPDATE public.forwarding_orders SET payment_status = 'paid'
   WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid';
  UPDATE public.waybills SET payment_status = 'paid'
   WHERE user_id = uid AND batch_no = _batch_no AND payment_status <> 'paid';

  RETURN jsonb_build_object('ok', true, 'paid_cad', total_cad, 'paid_cny', total_cny, 'invoice_id', v_inv_id, 'invoice_no', v_inv_no);
END;
$$;
