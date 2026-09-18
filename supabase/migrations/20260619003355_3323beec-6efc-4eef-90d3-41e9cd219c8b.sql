
-- 1. Add batch fields to waybills
ALTER TABLE public.waybills
  ADD COLUMN IF NOT EXISTS batch_no text,
  ADD COLUMN IF NOT EXISTS shipping_method text,
  ADD COLUMN IF NOT EXISTS eta date;

-- Backfill from parent
UPDATE public.waybills w SET
  batch_no = COALESCE(w.batch_no, o.batch_no),
  shipping_method = COALESCE(w.shipping_method, o.shipping_method),
  eta = COALESCE(w.eta, o.eta)
FROM public.orders o WHERE w.order_id = o.id;

UPDATE public.waybills w SET
  batch_no = COALESCE(w.batch_no, f.batch_no),
  shipping_method = COALESCE(w.shipping_method, f.shipping_method),
  eta = COALESCE(w.eta, f.eta)
FROM public.forwarding_orders f WHERE w.forwarding_id = f.id;

-- 2. Convert domestic_tracking_nos array -> single text
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS domestic_tracking_no text;
UPDATE public.orders SET domestic_tracking_no = domestic_tracking_nos[1]
  WHERE domestic_tracking_no IS NULL AND domestic_tracking_nos IS NOT NULL AND array_length(domestic_tracking_nos,1) >= 1;
ALTER TABLE public.orders DROP COLUMN IF EXISTS domestic_tracking_nos;

ALTER TABLE public.forwarding_orders ADD COLUMN IF NOT EXISTS domestic_tracking_no text;
UPDATE public.forwarding_orders SET domestic_tracking_no = domestic_tracking_nos[1]
  WHERE domestic_tracking_no IS NULL AND domestic_tracking_nos IS NOT NULL AND array_length(domestic_tracking_nos,1) >= 1;
ALTER TABLE public.forwarding_orders DROP COLUMN IF EXISTS domestic_tracking_nos;

-- 3. Ensure shipments exist for each waybill's intl tracking so timeline can be looked up
INSERT INTO public.shipments (tracking_no, shipping_method, status)
SELECT DISTINCT w.intl_tracking_no, COALESCE(w.shipping_method,'air'), 'created'
FROM public.waybills w
WHERE w.intl_tracking_no IS NOT NULL AND w.intl_tracking_no <> ''
ON CONFLICT (tracking_no) DO NOTHING;
