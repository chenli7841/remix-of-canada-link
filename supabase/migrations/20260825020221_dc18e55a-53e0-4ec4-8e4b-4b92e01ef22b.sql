ALTER TABLE public.wechat_gpt_session
  ADD COLUMN IF NOT EXISTS last_tracking_number text,
  ADD COLUMN IF NOT EXISTS current_intent text,
  ADD COLUMN IF NOT EXISTS pending_action text,
  ADD COLUMN IF NOT EXISTS create_order_draft jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();