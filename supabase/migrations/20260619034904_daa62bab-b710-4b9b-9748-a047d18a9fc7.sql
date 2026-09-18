ALTER TABLE public.freight_rules
  ADD COLUMN IF NOT EXISTS insurance_rate_pct numeric NOT NULL DEFAULT 0;