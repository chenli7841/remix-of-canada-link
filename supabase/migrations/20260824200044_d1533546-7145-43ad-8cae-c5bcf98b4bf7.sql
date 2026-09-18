-- ===== 微信客服本地快速通道内部表（service_role only）=====

CREATE TABLE public.wechat_kf_state (
  external_userid text PRIMARY KEY,
  open_kfid text,
  state text NOT NULL DEFAULT 'idle',
  draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.wechat_kf_state TO service_role;
ALTER TABLE public.wechat_kf_state ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wechat_kf_msg_dedup (
  msgid text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.wechat_kf_msg_dedup TO service_role;
ALTER TABLE public.wechat_kf_msg_dedup ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wechat_kf_image_cache (
  sha256 text PRIMARY KEY,
  result jsonb NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.wechat_kf_image_cache TO service_role;
ALTER TABLE public.wechat_kf_image_cache ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wechat_kf_cursor (
  open_kfid text PRIMARY KEY,
  cursor text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.wechat_kf_cursor TO service_role;
ALTER TABLE public.wechat_kf_cursor ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.wechat_kf_token (
  id text PRIMARY KEY,
  access_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.wechat_kf_token TO service_role;
ALTER TABLE public.wechat_kf_token ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_wechat_kf_state_updated_at
  BEFORE UPDATE ON public.wechat_kf_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 消息去重认领：首次到达返回 true，重复返回 false（24 小时 TTL）
CREATE OR REPLACE FUNCTION public.wechat_kf_msg_claim(_msgid text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inserted integer;
BEGIN
  DELETE FROM public.wechat_kf_msg_dedup WHERE created_at < now() - interval '24 hours';
  INSERT INTO public.wechat_kf_msg_dedup(msgid) VALUES (_msgid)
  ON CONFLICT (msgid) DO NOTHING;
  GET DIAGNOSTICS _inserted = ROW_COUNT;
  RETURN _inserted > 0;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.wechat_kf_msg_claim(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.wechat_kf_msg_claim(text) TO service_role;

-- 图片识别缓存读取（自动清理过期）
CREATE OR REPLACE FUNCTION public.wechat_kf_image_cache_get(_sha256 text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r jsonb;
BEGIN
  DELETE FROM public.wechat_kf_image_cache WHERE expires_at < now();
  SELECT result INTO _r FROM public.wechat_kf_image_cache WHERE sha256 = _sha256;
  RETURN _r;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.wechat_kf_image_cache_get(text) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.wechat_kf_image_cache_get(text) TO service_role;