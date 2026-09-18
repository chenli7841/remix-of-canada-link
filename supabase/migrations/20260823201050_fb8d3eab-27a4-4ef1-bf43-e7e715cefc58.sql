ALTER TABLE public.shipping_routes
  ADD COLUMN IF NOT EXISTS wechat_ai_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wechat_ai_price_text text;