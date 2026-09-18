
ALTER TYPE public.surcharge_scope ADD VALUE IF NOT EXISTS 'forwarding';
ALTER TABLE public.surcharges
  ADD COLUMN IF NOT EXISTS forwarding_id uuid REFERENCES public.forwarding_orders(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS surcharges_forwarding_idx ON public.surcharges(forwarding_id);
