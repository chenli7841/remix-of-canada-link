
CREATE TABLE public.receivings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_no TEXT NOT NULL UNIQUE,
  batch_id UUID REFERENCES public.batches(id) ON DELETE SET NULL,
  warehouse_code TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','matched','confirmed','closed')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_receivings_batch ON public.receivings(batch_id);
CREATE INDEX idx_receivings_status ON public.receivings(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receivings TO authenticated;
GRANT ALL ON public.receivings TO service_role;
ALTER TABLE public.receivings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage receivings" ON public.receivings FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.receiving_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_id UUID NOT NULL REFERENCES public.receivings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('waybill','carton','pallet')),
  ref_id UUID NOT NULL,
  code TEXT NOT NULL,
  note TEXT,
  operator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (receiving_id, kind, ref_id)
);
CREATE INDEX idx_receiving_scans_recv ON public.receiving_scans(receiving_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.receiving_scans TO authenticated;
GRANT ALL ON public.receiving_scans TO service_role;
ALTER TABLE public.receiving_scans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage receiving scans" ON public.receiving_scans FOR ALL TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.update_updated_at_column() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER trg_receivings_updated BEFORE UPDATE ON public.receivings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
