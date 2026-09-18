ALTER TABLE public.shipping_routes
  ADD COLUMN IF NOT EXISTS blacklist_vip_levels public.vip_level[] NOT NULL DEFAULT ARRAY[]::public.vip_level[],
  ADD COLUMN IF NOT EXISTS blacklist_customer_codes text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE public.freight_rules
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'forward';

ALTER TABLE public.freight_rules
  DROP CONSTRAINT IF EXISTS freight_rules_direction_chk;
ALTER TABLE public.freight_rules
  ADD CONSTRAINT freight_rules_direction_chk CHECK (direction IN ('forward','reverse'));