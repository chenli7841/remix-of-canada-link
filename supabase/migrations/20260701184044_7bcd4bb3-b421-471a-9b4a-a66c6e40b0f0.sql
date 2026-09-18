
ALTER TABLE public.surcharges DROP CONSTRAINT IF EXISTS surcharges_check;
ALTER TABLE public.surcharges ADD CONSTRAINT surcharges_check CHECK (
  (scope = 'waybill'    AND waybill_id    IS NOT NULL AND carton_id IS NULL AND pallet_id IS NULL AND batch_id IS NULL AND forwarding_id IS NULL) OR
  (scope = 'carton'     AND carton_id     IS NOT NULL AND waybill_id IS NULL AND pallet_id IS NULL AND batch_id IS NULL AND forwarding_id IS NULL) OR
  (scope = 'pallet'     AND pallet_id     IS NOT NULL AND waybill_id IS NULL AND carton_id IS NULL AND batch_id IS NULL AND forwarding_id IS NULL) OR
  (scope = 'batch'      AND batch_id      IS NOT NULL AND waybill_id IS NULL AND carton_id IS NULL AND pallet_id IS NULL AND forwarding_id IS NULL) OR
  (scope = 'forwarding' AND forwarding_id IS NOT NULL AND waybill_id IS NULL AND carton_id IS NULL AND pallet_id IS NULL AND batch_id IS NULL)
);
