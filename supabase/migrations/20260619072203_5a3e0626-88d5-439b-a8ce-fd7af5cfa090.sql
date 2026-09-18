
-- Detained domestic packages (扫描后无对应订单时滞留登记)
CREATE TABLE IF NOT EXISTS public.detained_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domestic_tracking_no text NOT NULL,
  customer_code text,
  note text,
  status text NOT NULL DEFAULT 'detained',
  intake_parent_kind text,
  intake_parent_id uuid,
  intake_waybill_ids uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  released_at timestamptz,
  released_by uuid
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.detained_packages TO authenticated;
GRANT ALL ON public.detained_packages TO service_role;
ALTER TABLE public.detained_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage detained" ON public.detained_packages FOR ALL
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_detained_tracking ON public.detained_packages (domestic_tracking_no);
CREATE INDEX IF NOT EXISTS idx_detained_status ON public.detained_packages (status);

-- Enable pg_trgm for fuzzy matching on domestic_tracking_no
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_orders_domestic_trgm ON public.orders USING gin (domestic_tracking_no gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_fo_domestic_trgm ON public.forwarding_orders USING gin (domestic_tracking_no gin_trgm_ops);
