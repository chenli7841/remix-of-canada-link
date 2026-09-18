
-- Add batch info to forwarding_orders
ALTER TABLE public.forwarding_orders
  ADD COLUMN IF NOT EXISTS batch_no text,
  ADD COLUMN IF NOT EXISTS eta date,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid';

-- RPC: pay all unpaid items in a batch from wallet (CAD). Uses display rate stored on order or 0.19 fallback.
CREATE OR REPLACE FUNCTION public.pay_batch(_batch_no text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  rate numeric := 0.19;
  total_cny numeric := 0;
  total_cad numeric := 0;
  bal numeric := 0;
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

  INSERT INTO public.wallet_transactions (user_id, type, amount_cny, amount_cad, fx_rate_cny_to_cad, status, channel, note)
  VALUES (uid, 'spend', total_cny, total_cad, rate, 'completed', 'wallet', 'Batch payment: ' || _batch_no);

  UPDATE public.orders SET payment_status = 'paid', status = CASE WHEN status='pending' THEN 'paid'::order_status ELSE status END
   WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid';
  UPDATE public.forwarding_orders SET payment_status = 'paid'
   WHERE user_id = uid AND batch_no = _batch_no AND payment_status = 'unpaid';

  RETURN jsonb_build_object('ok', true, 'paid_cad', total_cad, 'paid_cny', total_cny);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_batch(text) TO authenticated;
