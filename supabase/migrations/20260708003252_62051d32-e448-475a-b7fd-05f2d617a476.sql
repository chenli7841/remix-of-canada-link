-- Username-based login: add username column, backfill, uniqueness, and
-- identifier-resolution RPCs so login can accept username, email, or phone.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;

-- Backfill existing rows so uniqueness can be enforced.
UPDATE public.profiles
SET username = 'user_' || substr(id::text, 1, 8)
WHERE username IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_idx
  ON public.profiles (lower(username));

-- Seed username into new signups (kept in sync with the latest handle_new_user shape).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, phone, customer_code, username)
  VALUES (NEW.id, NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url',
    COALESCE(NEW.phone, NEW.raw_user_meta_data->>'phone'),
    public.gen_customer_code(),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'username', ''), 'user_' || substr(NEW.id::text, 1, 8)))
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.wallets (user_id, balance_cny) VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'customer')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;

-- Availability check for the signup form (no auth required).
CREATE OR REPLACE FUNCTION public.check_username_available(p_username text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE lower(username) = lower(p_username)
  )
$$;
GRANT EXECUTE ON FUNCTION public.check_username_available(text) TO anon, authenticated;

-- Resolve a login identifier (username, phone, or email) to the account's email
-- so the client can complete the actual Supabase password sign-in.
CREATE OR REPLACE FUNCTION public.resolve_login_email(p_identifier text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT email FROM public.profiles
  WHERE lower(username) = lower(p_identifier)
     OR phone = p_identifier
     OR lower(email) = lower(p_identifier)
  LIMIT 1
$$;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(text) TO anon, authenticated;
