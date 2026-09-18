-- Stop auto-generating SC tracking numbers on forwarding_orders.
-- Tracking numbers should only appear via waybills (per box/pallet).
DROP TRIGGER IF EXISTS trg_gen_fo_tracking_no ON public.forwarding_orders;
DROP FUNCTION IF EXISTS public.gen_fo_tracking_no();

-- Clear previously auto-generated tracking_no values that have no matching waybill.
UPDATE public.forwarding_orders fo
SET tracking_no = NULL
WHERE tracking_no IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.waybills w WHERE w.forwarding_id = fo.id);