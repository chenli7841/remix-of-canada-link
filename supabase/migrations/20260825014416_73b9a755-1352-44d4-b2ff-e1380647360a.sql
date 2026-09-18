CREATE TABLE IF NOT EXISTS public.wechat_kf_lock (
  open_kfid text PRIMARY KEY,
  locked_until timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.wechat_kf_lock TO service_role;

ALTER TABLE public.wechat_kf_lock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service role only" ON public.wechat_kf_lock FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.wechat_kf_try_lock(_open_kfid text, _ttl_seconds integer DEFAULT 60)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _ok boolean;
BEGIN
  INSERT INTO public.wechat_kf_lock (open_kfid, locked_until, updated_at)
  VALUES (_open_kfid, now() + make_interval(secs => GREATEST(_ttl_seconds, 5)), now())
  ON CONFLICT (open_kfid) DO UPDATE
    SET locked_until = now() + make_interval(secs => GREATEST(_ttl_seconds, 5)),
        updated_at = now()
    WHERE public.wechat_kf_lock.locked_until < now()
  RETURNING true INTO _ok;
  RETURN COALESCE(_ok, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.wechat_kf_release_lock(_open_kfid text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.wechat_kf_lock SET locked_until = now() - interval '1 second', updated_at = now()
  WHERE open_kfid = _open_kfid;
$$;

REVOKE ALL ON FUNCTION public.wechat_kf_try_lock(text, integer) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.wechat_kf_release_lock(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wechat_kf_try_lock(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.wechat_kf_release_lock(text) TO service_role;