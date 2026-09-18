-- ============ 1. 绑定关系表补充（永久绑定） ============
ALTER TABLE public.wechat_identity_bindings
  ADD COLUMN IF NOT EXISTS corp_id_hash text,
  ADD COLUMN IF NOT EXISTS open_kfid text,
  ADD COLUMN IF NOT EXISTS customer_display_name text,
  ADD COLUMN IF NOT EXISTS bound_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS unbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE UNIQUE INDEX IF NOT EXISTS wechat_identity_bindings_active_euid
  ON public.wechat_identity_bindings (external_userid)
  WHERE status = 'active' AND external_userid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wechat_bind_codes_upper_code
  ON public.wechat_ai_bind_codes (upper(code));

-- ============ 2. 会话表 ============
CREATE TABLE IF NOT EXISTS public.wechat_ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corp_id_hash text,
  open_kfid text NOT NULL,
  external_userid text NOT NULL,
  customer_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'active',
  current_intent text,
  pending_action text,
  awaiting_field text,
  last_tracking_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wechat_ai_conversations_key
  ON public.wechat_ai_conversations (open_kfid, external_userid);
GRANT ALL ON public.wechat_ai_conversations TO service_role;
GRANT SELECT ON public.wechat_ai_conversations TO authenticated;
ALTER TABLE public.wechat_ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read wechat conversations" ON public.wechat_ai_conversations
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- ============ 3. 永久消息表 ============
CREATE TABLE IF NOT EXISTS public.wechat_ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.wechat_ai_conversations(id) ON DELETE CASCADE,
  msgid text,
  direction text NOT NULL,
  origin integer,
  message_type text NOT NULL DEFAULT 'text',
  text_content text,
  media_id text,
  ocr_text text,
  ocr_confidence numeric,
  send_time timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  reply_to_message_id uuid REFERENCES public.wechat_ai_messages(id) ON DELETE SET NULL,
  processing_status text,
  wechat_errcode integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wechat_ai_messages_msgid ON public.wechat_ai_messages (msgid) WHERE msgid IS NOT NULL;
CREATE INDEX IF NOT EXISTS wechat_ai_messages_conv ON public.wechat_ai_messages (conversation_id, created_at DESC);
GRANT ALL ON public.wechat_ai_messages TO service_role;
GRANT SELECT ON public.wechat_ai_messages TO authenticated;
ALTER TABLE public.wechat_ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read wechat messages" ON public.wechat_ai_messages
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- ============ 4. GPT 运行记录 ============
CREATE TABLE IF NOT EXISTS public.wechat_ai_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.wechat_ai_conversations(id) ON DELETE CASCADE,
  user_message_id uuid REFERENCES public.wechat_ai_messages(id) ON DELETE SET NULL,
  model text,
  intent text,
  input_context_summary text,
  state_before jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_patch jsonb NOT NULL DEFAULT '{}'::jsonb,
  state_after jsonb NOT NULL DEFAULT '{}'::jsonb,
  tool_requested text,
  openai_status integer,
  openai_duration_ms integer,
  total_duration_ms integer,
  result_status text,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wechat_ai_agent_runs_conv ON public.wechat_ai_agent_runs (conversation_id, created_at DESC);
GRANT ALL ON public.wechat_ai_agent_runs TO service_role;
GRANT SELECT ON public.wechat_ai_agent_runs TO authenticated;
ALTER TABLE public.wechat_ai_agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read wechat agent runs" ON public.wechat_ai_agent_runs
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- ============ 5. 工具调用记录 ============
CREATE TABLE IF NOT EXISTS public.wechat_ai_tool_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id uuid REFERENCES public.wechat_ai_agent_runs(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.wechat_ai_conversations(id) ON DELETE CASCADE,
  tool_name text NOT NULL,
  request_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  success boolean NOT NULL DEFAULT false,
  result_code text,
  duration_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wechat_ai_tool_runs_run ON public.wechat_ai_tool_runs (agent_run_id);
CREATE INDEX IF NOT EXISTS wechat_ai_tool_runs_time ON public.wechat_ai_tool_runs (created_at DESC);
GRANT ALL ON public.wechat_ai_tool_runs TO service_role;
GRANT SELECT ON public.wechat_ai_tool_runs TO authenticated;
ALTER TABLE public.wechat_ai_tool_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read wechat tool runs" ON public.wechat_ai_tool_runs
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- ============ 6. 录单草稿与版本 ============
CREATE TABLE IF NOT EXISTS public.wechat_forwarding_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.wechat_ai_conversations(id) ON DELETE CASCADE,
  customer_code text,
  draft_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_status text NOT NULL DEFAULT 'active',
  idempotency_key text,
  created_fw_tracking_no text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS wechat_forwarding_drafts_conv ON public.wechat_forwarding_drafts (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS wechat_forwarding_drafts_active ON public.wechat_forwarding_drafts (conversation_id) WHERE draft_status = 'active';
GRANT ALL ON public.wechat_forwarding_drafts TO service_role;
GRANT SELECT ON public.wechat_forwarding_drafts TO authenticated;
ALTER TABLE public.wechat_forwarding_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read wechat drafts" ON public.wechat_forwarding_drafts
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE TABLE IF NOT EXISTS public.wechat_forwarding_draft_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.wechat_forwarding_drafts(id) ON DELETE CASCADE,
  message_id uuid REFERENCES public.wechat_ai_messages(id) ON DELETE SET NULL,
  changed_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wechat_draft_events_draft ON public.wechat_forwarding_draft_events (draft_id, created_at);
GRANT ALL ON public.wechat_forwarding_draft_events TO service_role;
GRANT SELECT ON public.wechat_forwarding_draft_events TO authenticated;
ALTER TABLE public.wechat_forwarding_draft_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read wechat draft events" ON public.wechat_forwarding_draft_events
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- ============ 7. 管理操作审计 ============
CREATE TABLE IF NOT EXISTS public.wechat_ai_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  before_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wechat_ai_admin_audit_time ON public.wechat_ai_admin_audit (created_at DESC);
GRANT ALL ON public.wechat_ai_admin_audit TO service_role;
GRANT SELECT ON public.wechat_ai_admin_audit TO authenticated;
ALTER TABLE public.wechat_ai_admin_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read wechat admin audit" ON public.wechat_ai_admin_audit
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- ============ 8. 草稿过期维护函数 ============
CREATE OR REPLACE FUNCTION public.wechat_expire_stale_drafts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  UPDATE public.wechat_forwarding_drafts
     SET draft_status = 'expired', updated_at = now()
   WHERE draft_status = 'active' AND expires_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.wechat_expire_stale_drafts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.wechat_expire_stale_drafts() TO service_role;