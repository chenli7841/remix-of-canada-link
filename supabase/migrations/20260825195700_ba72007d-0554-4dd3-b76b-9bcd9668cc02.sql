CREATE OR REPLACE FUNCTION public.wechat_callback_claim(_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer := 0;
BEGIN
  DELETE FROM public.wechat_callback_dedup WHERE expires_at < now();
  INSERT INTO public.wechat_callback_dedup(hash) VALUES (_hash)
  ON CONFLICT (hash) DO NOTHING;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END;
$$;