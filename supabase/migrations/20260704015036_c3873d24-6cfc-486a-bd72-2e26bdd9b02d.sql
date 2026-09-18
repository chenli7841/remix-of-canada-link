DO $$ BEGIN
  CREATE TYPE public.fee_scheme_preference AS ENUM ('merged', 'split');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS fee_scheme_preference public.fee_scheme_preference NOT NULL DEFAULT 'merged';