CREATE TABLE IF NOT EXISTS public.wechat_callback_dedup (
  hash TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);
GRANT ALL ON public.wechat_callback_dedup TO service_role;
ALTER TABLE public.wechat_callback_dedup ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS wechat_callback_dedup_expires_idx ON public.wechat_callback_dedup (expires_at);

CREATE OR REPLACE FUNCTION public.wechat_callback_claim(_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE inserted BOOLEAN := false;
BEGIN
  DELETE FROM public.wechat_callback_dedup WHERE expires_at < now();
  INSERT INTO public.wechat_callback_dedup(hash) VALUES (_hash)
  ON CONFLICT (hash) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;