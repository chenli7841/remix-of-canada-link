-- Customer-owned "My Items" catalog: name, HS code, SKU, declared value, units/box,
-- MFN/GST/SIMA duty info, unit of measure — reusable when filling forwarding requests.

CREATE TABLE IF NOT EXISTS public.my_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  hs_code text NOT NULL,
  sku text,
  declared_value_cny numeric(12,2) NOT NULL DEFAULT 0,
  inner_qty integer,
  mfn_rate numeric(8,4) NOT NULL DEFAULT 0,
  gst_rate numeric(8,4) NOT NULL DEFAULT 0.05,
  sima_involved boolean NOT NULL DEFAULT false,
  unit text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.my_items TO authenticated;
GRANT ALL ON public.my_items TO service_role;

ALTER TABLE public.my_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "my_items_all_own" ON public.my_items;
CREATE POLICY "my_items_all_own" ON public.my_items FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_my_items_user ON public.my_items(user_id);

CREATE TRIGGER trg_my_items_updated BEFORE UPDATE ON public.my_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Safe customer-facing sync into the shared HS code library: inserts a new code only
-- when it doesn't already exist. Never touches an existing row's duty rates — those are
-- staff-curated master data (hs_codes itself stays admin-write-only via upsertHsCode()).
CREATE OR REPLACE FUNCTION public.ensure_hs_code(
  p_hs_code text, p_name_zh text, p_unit text,
  p_mfn_rate numeric, p_gst_rate numeric, p_sima_involved boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.hs_codes (hs_code, chapter, name_zh, unit, mfn_rate, gst_rate, sima_involved, is_active)
  VALUES (
    p_hs_code, left(p_hs_code, 2), p_name_zh, p_unit,
    COALESCE(p_mfn_rate, 0), COALESCE(p_gst_rate, 0.05), COALESCE(p_sima_involved, false), true
  )
  ON CONFLICT (hs_code) DO NOTHING;
END; $$;
GRANT EXECUTE ON FUNCTION public.ensure_hs_code(text, text, text, numeric, numeric, boolean) TO authenticated;
