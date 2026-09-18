
ALTER TABLE public.forwarding_items ADD COLUMN IF NOT EXISTS hs_code text;

CREATE INDEX IF NOT EXISTS idx_hs_codes_name_zh ON public.hs_codes (name_zh);
CREATE INDEX IF NOT EXISTS idx_hs_codes_name_en ON public.hs_codes (name_en);
CREATE INDEX IF NOT EXISTS idx_hs_codes_aliases_gin ON public.hs_codes USING gin (aliases);
