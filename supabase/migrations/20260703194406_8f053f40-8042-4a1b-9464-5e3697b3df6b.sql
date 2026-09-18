
-- Last-mile fee tiered fields (existing threshold + fee_cad stay for backward compat)
ALTER TABLE public.shipping_routes
  ADD COLUMN IF NOT EXISTS last_mile_step_kg numeric NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_mile_rate_cad numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_mile_formula text;

-- Manual unlock flag for containers when their batch is beyond draft
ALTER TABLE public.cartons
  ADD COLUMN IF NOT EXISTS unlocked boolean NOT NULL DEFAULT false;
ALTER TABLE public.pallets
  ADD COLUMN IF NOT EXISTS unlocked boolean NOT NULL DEFAULT false;

-- Cascade batch status to child cartons/pallets on batch status change
CREATE OR REPLACE FUNCTION public.sync_container_status_from_batch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.cartons
       SET status = NEW.status::text,
           unlocked = CASE WHEN NEW.status = 'draft' THEN false ELSE unlocked END
     WHERE batch_id = NEW.id;
    UPDATE public.pallets
       SET status = NEW.status::text,
           unlocked = CASE WHEN NEW.status = 'draft' THEN false ELSE unlocked END
     WHERE batch_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_container_status_from_batch ON public.batches;
CREATE TRIGGER trg_sync_container_status_from_batch
  AFTER UPDATE OF status ON public.batches
  FOR EACH ROW EXECUTE FUNCTION public.sync_container_status_from_batch();
