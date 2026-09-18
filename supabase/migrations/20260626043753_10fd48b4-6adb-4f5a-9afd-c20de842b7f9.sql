ALTER TABLE public.hs_codes
  ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS sima_involved BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS hs_codes_aliases_gin ON public.hs_codes USING GIN (aliases);
CREATE INDEX IF NOT EXISTS hs_codes_sima_idx ON public.hs_codes(sima_involved) WHERE sima_involved = true;