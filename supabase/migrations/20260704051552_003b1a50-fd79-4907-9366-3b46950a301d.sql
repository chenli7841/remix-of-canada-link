-- Cartons/waybills belong to a batch via their pallet — clear stale direct batch link
UPDATE public.cartons SET batch_id = NULL WHERE pallet_id IS NOT NULL AND batch_id IS NOT NULL;
UPDATE public.waybills SET assigned_batch_id = NULL, batch_no = NULL WHERE pallet_id IS NOT NULL AND assigned_batch_id IS NOT NULL AND carton_id IS NULL;