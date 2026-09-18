-- Sign-up dedup for username / email / phone: all case-insensitive, no
-- whitespace, and phone numbers compared after stripping symbols + the
-- leading NANP "1" country code so "6478917666" and "1-647-891-7666"
-- collide as the same number.

CREATE OR REPLACE FUNCTION public.normalize_phone(p_phone text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_phone IS NULL OR p_phone = '' THEN NULL
    ELSE (
      SELECT CASE
        WHEN length(digits) = 11 AND left(digits, 1) = '1' THEN substring(digits from 2)
        ELSE digits
      END
      FROM (SELECT regexp_replace(p_phone, '[^0-9]', '', 'g') AS digits) s
    )
  END
$$;

-- Backfill/repair: strip whitespace that may already exist in stored values
-- so the new CHECK constraints below don't fail on existing rows.
UPDATE public.profiles SET username = regexp_replace(username, '\s', '', 'g') WHERE username ~ '\s';
UPDATE public.profiles SET email = regexp_replace(email, '\s', '', 'g') WHERE email ~ '\s';
UPDATE public.profiles SET phone = regexp_replace(phone, '\s', '', 'g') WHERE phone ~ '\s';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_no_space CHECK (username IS NULL OR username !~ '\s'),
  ADD CONSTRAINT profiles_email_no_space CHECK (email IS NULL OR email !~ '\s'),
  ADD CONSTRAINT profiles_phone_no_space CHECK (phone IS NULL OR phone !~ '\s');

CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_lower_idx ON public.profiles (lower(email));

CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_normalized_idx
  ON public.profiles (public.normalize_phone(phone))
  WHERE phone IS NOT NULL AND phone <> '';

-- Pre-submit availability checks for the signup form (mirrors check_username_available).
CREATE OR REPLACE FUNCTION public.check_email_available(p_email text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE lower(email) = lower(p_email)
  )
$$;
GRANT EXECUTE ON FUNCTION public.check_email_available(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_phone_available(p_phone text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE phone IS NOT NULL AND phone <> ''
      AND public.normalize_phone(phone) = public.normalize_phone(p_phone)
  )
$$;
GRANT EXECUTE ON FUNCTION public.check_phone_available(text) TO anon, authenticated;

-- Keep login-by-phone consistent with the same normalization used for dedup.
CREATE OR REPLACE FUNCTION public.resolve_login_email(p_identifier text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT email FROM public.profiles
  WHERE lower(username) = lower(p_identifier)
     OR (public.normalize_phone(phone) IS NOT NULL AND public.normalize_phone(phone) = public.normalize_phone(p_identifier))
     OR lower(email) = lower(p_identifier)
  LIMIT 1
$$;
