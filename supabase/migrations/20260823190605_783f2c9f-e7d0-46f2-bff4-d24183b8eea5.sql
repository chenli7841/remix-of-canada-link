CREATE TABLE public.wechat_identity_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_type text NOT NULL CHECK (channel_type IN ('adp_visitor','wechat_kf','wecom_group','wecom_user')),
  visitor_biz_id text,
  external_userid text,
  chat_id text,
  customer_code text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_group_name text,
  binding_source text NOT NULL DEFAULT 'bind_code'
    CHECK (binding_source IN ('bind_code','chat_id','external_userid','visitor_biz_id','remark','manual')),
  verified boolean NOT NULL DEFAULT false,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wib_has_identity CHECK (
    COALESCE(visitor_biz_id, external_userid, chat_id) IS NOT NULL
  )
);

CREATE UNIQUE INDEX wib_visitor_uniq ON public.wechat_identity_bindings(visitor_biz_id) WHERE visitor_biz_id IS NOT NULL;
CREATE UNIQUE INDEX wib_external_uniq ON public.wechat_identity_bindings(external_userid) WHERE external_userid IS NOT NULL;
CREATE UNIQUE INDEX wib_chat_uniq ON public.wechat_identity_bindings(chat_id) WHERE chat_id IS NOT NULL;
CREATE INDEX wib_customer_idx ON public.wechat_identity_bindings(customer_code);

GRANT ALL ON public.wechat_identity_bindings TO service_role;
ALTER TABLE public.wechat_identity_bindings ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER wib_set_updated_at BEFORE UPDATE ON public.wechat_identity_bindings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TABLE IF EXISTS public.wechat_ai_bindings;