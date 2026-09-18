
DO $$ BEGIN
  CREATE TYPE public.vip_level AS ENUM ('normal','silver','gold','diamond');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vip_level public.vip_level NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 0;

ALTER TABLE public.shipping_routes
  ADD COLUMN IF NOT EXISTS visible_vip_levels public.vip_level[] NOT NULL DEFAULT ARRAY['normal','silver','gold','diamond']::public.vip_level[],
  ADD COLUMN IF NOT EXISTS visible_customer_codes text[] NOT NULL DEFAULT ARRAY[]::text[];
