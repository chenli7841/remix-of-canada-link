CREATE TABLE public.hs_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  hs_code TEXT NOT NULL,
  chapter TEXT,
  name_zh TEXT NOT NULL,
  name_en TEXT,
  unit TEXT,
  mfn_rate NUMERIC(8,4) DEFAULT 0,
  gst_rate NUMERIC(8,4) DEFAULT 0.05,
  anti_dumping_rate NUMERIC(8,4) DEFAULT 0,
  anti_dumping_note TEXT,
  note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (hs_code)
);

CREATE INDEX hs_codes_chapter_idx ON public.hs_codes(chapter);
CREATE INDEX hs_codes_name_zh_idx ON public.hs_codes(name_zh);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hs_codes TO authenticated;
GRANT ALL ON public.hs_codes TO service_role;

ALTER TABLE public.hs_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read hs_codes" ON public.hs_codes
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE POLICY "staff write hs_codes" ON public.hs_codes
  FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()))
  WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER update_hs_codes_updated_at
  BEFORE UPDATE ON public.hs_codes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();