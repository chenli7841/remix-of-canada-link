ALTER TABLE public.freight_rules
  ADD COLUMN IF NOT EXISTS clearance_fee_level text NOT NULL DEFAULT 'waybill';
ALTER TABLE public.freight_rules
  DROP CONSTRAINT IF EXISTS freight_rules_clearance_fee_level_check;
ALTER TABLE public.freight_rules
  ADD CONSTRAINT freight_rules_clearance_fee_level_check
  CHECK (clearance_fee_level IN ('waybill','batch'));