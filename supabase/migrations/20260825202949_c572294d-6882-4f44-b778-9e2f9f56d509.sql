-- 1) 清除无有效草稿却残留的创建运单意图
UPDATE public.wechat_ai_conversations c
SET current_intent = NULL,
    pending_action = NULL,
    awaiting_field = NULL,
    updated_at = now()
WHERE c.current_intent = 'create_forwarding_order'
  AND NOT EXISTS (
    SELECT 1 FROM public.wechat_forwarding_drafts d
    WHERE d.conversation_id = c.id
      AND d.draft_status = 'active'
      AND d.expires_at > now()
  );

UPDATE public.wechat_gpt_session s
SET current_intent = NULL,
    pending_action = NULL,
    create_order_draft = '{}'::jsonb,
    updated_at = now()
WHERE s.current_intent = 'create_forwarding_order'
  AND COALESCE(s.create_order_draft, '{}'::jsonb) - 'awaiting_confirmation' = '{}'::jsonb;

-- 2) 清除非法的 last_tracking_number（绑定码等短码）
UPDATE public.wechat_ai_conversations
SET last_tracking_number = NULL, updated_at = now()
WHERE last_tracking_number IS NOT NULL
  AND upper(last_tracking_number) !~ '^(FW[0-9A-Z]{4,}|[0-9]{8,30}|[A-Z]{2,4}[0-9]{8,})$';

UPDATE public.wechat_gpt_session
SET last_tracking_number = NULL, updated_at = now()
WHERE last_tracking_number IS NOT NULL
  AND upper(last_tracking_number) !~ '^(FW[0-9A-Z]{4,}|[0-9]{8,30}|[A-Z]{2,4}[0-9]{8,})$';

-- 3) 依据 active 永久绑定重新同步会话客户号
UPDATE public.wechat_ai_conversations c
SET customer_code = b.customer_code, updated_at = now()
FROM public.wechat_identity_bindings b
WHERE b.external_userid = c.external_userid
  AND COALESCE(b.status, 'active') = 'active'
  AND c.external_userid IS NOT NULL
  AND c.customer_code IS DISTINCT FROM b.customer_code;