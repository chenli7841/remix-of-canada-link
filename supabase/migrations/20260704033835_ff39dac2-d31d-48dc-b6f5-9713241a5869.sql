
ALTER TABLE public.freight_rules 
  ADD COLUMN IF NOT EXISTS min_charge_level text NOT NULL DEFAULT 'waybill';

ALTER TABLE public.freight_rules 
  DROP CONSTRAINT IF EXISTS freight_rules_min_charge_level_check;
ALTER TABLE public.freight_rules 
  ADD CONSTRAINT freight_rules_min_charge_level_check 
  CHECK (min_charge_level IN ('waybill','batch'));
