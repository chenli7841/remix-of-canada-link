ALTER TABLE public.freight_rules
  ADD COLUMN IF NOT EXISTS delivery_light_max_kg numeric,
  ADD COLUMN IF NOT EXISTS delivery_light_fee_cad numeric,
  ADD COLUMN IF NOT EXISTS delivery_heavy_min_kg numeric,
  ADD COLUMN IF NOT EXISTS delivery_unit_fee_cad numeric,
  ADD COLUMN IF NOT EXISTS oversize_alert_length_cm numeric,
  ADD COLUMN IF NOT EXISTS overweight_alert_ratio numeric,
  ADD COLUMN IF NOT EXISTS remote_postal_prefixes text;

CREATE TABLE IF NOT EXISTS public.batch_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.batches(id) ON DELETE CASCADE,
  customer_code text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, customer_code)
);

GRANT SELECT ON public.batch_settlements TO authenticated;
GRANT ALL ON public.batch_settlements TO service_role;
ALTER TABLE public.batch_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "batch settlements readable by staff or owner customer"
ON public.batch_settlements FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  OR customer_code = (SELECT p.customer_code FROM public.profiles p WHERE p.id = auth.uid())
);

CREATE POLICY "batch settlements manage by staff"
ON public.batch_settlements FOR ALL TO authenticated
USING (public.is_staff(auth.uid()))
WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER trg_batch_settlements_updated BEFORE UPDATE ON public.batch_settlements
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();