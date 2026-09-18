
CREATE TABLE public.delivery_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('waybill','carton','pallet')),
  ref_id UUID NOT NULL,
  code TEXT NOT NULL,
  customer_user_id UUID,
  customer_code TEXT,
  source_receiving_id UUID REFERENCES public.receivings(id) ON DELETE SET NULL,
  source_batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','dispatched','cancelled')),
  notes TEXT,
  added_by UUID,
  dispatched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_id, status)
);

CREATE INDEX idx_delivery_queue_status ON public.delivery_queue(status);
CREATE INDEX idx_delivery_queue_customer ON public.delivery_queue(customer_user_id);
CREATE INDEX idx_delivery_queue_batch ON public.delivery_queue(source_batch_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_queue TO authenticated;
GRANT ALL ON public.delivery_queue TO service_role;

ALTER TABLE public.delivery_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff manage delivery_queue"
ON public.delivery_queue FOR ALL
TO authenticated
USING (public.is_staff(auth.uid()))
WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER update_delivery_queue_updated_at
BEFORE UPDATE ON public.delivery_queue
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
