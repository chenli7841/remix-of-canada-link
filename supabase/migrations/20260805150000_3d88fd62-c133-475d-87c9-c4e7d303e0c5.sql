-- Account security tab: password change (uses Supabase Auth directly, no
-- schema change needed), email change, and WeChat account binding.

-- Keep profiles.email in sync when the auth email changes (e.g. once the
-- user confirms a "change email" link sent by supabase.auth.updateUser).
CREATE OR REPLACE FUNCTION public.handle_user_email_updated()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
AFTER UPDATE ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_user_email_updated();

-- WeChat binding: store the linked openid/nickname on the profile.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wechat_openid text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS wechat_nickname text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_wechat_openid_idx
  ON public.profiles (wechat_openid) WHERE wechat_openid IS NOT NULL;

-- Short-lived CSRF state for the WeChat OAuth "bind" flow: maps a random
-- state token (passed through the WeChat redirect) back to the account that
-- requested the binding. Written/read only by server code (service role) —
-- RLS is enabled with no policies, so it's unreachable via anon/authenticated.
CREATE TABLE IF NOT EXISTS public.wechat_bind_states (
  state text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wechat_bind_states ENABLE ROW LEVEL SECURITY;
