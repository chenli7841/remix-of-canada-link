
-- App roles enum
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM (
    'owner','manager','warehouse_cn','warehouse_ca','driver','pickup_point','sales','support','customer'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer: has_role
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- is_staff: any non-customer role
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role <> 'customer')
$$;

-- Policies
DROP POLICY IF EXISTS "self can read own roles" ON public.user_roles;
CREATE POLICY "self can read own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "owners can read all roles" ON public.user_roles;
CREATE POLICY "owners can read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'owner'));

DROP POLICY IF EXISTS "owners can insert roles" ON public.user_roles;
CREATE POLICY "owners can insert roles" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'owner'));

DROP POLICY IF EXISTS "owners can delete roles" ON public.user_roles;
CREATE POLICY "owners can delete roles" ON public.user_roles
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'owner'));

-- Update handle_new_user to also seed default customer role
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, phone, customer_code)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url', NEW.phone, public.gen_customer_code())
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.wallets (user_id, balance_cny) VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

-- Backfill: every existing user gets 'customer'
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'customer'::public.app_role FROM auth.users
ON CONFLICT DO NOTHING;

-- Seed the requesting user as owner
INSERT INTO public.user_roles (user_id, role)
VALUES ('5cdb1f6e-6848-4c55-bebd-84694628469d', 'owner')
ON CONFLICT DO NOTHING;
