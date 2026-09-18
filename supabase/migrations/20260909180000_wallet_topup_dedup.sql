-- 充值建单幂等：客户端每次充值意图带一个 idempotency_key，重复点击 / 重试落到同一条
-- pending 流水，不再生成多个 TOPUP... 参考号与多个支付订单。

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  -- 建单时存下的支付会话信息（redirect URL / 二维码内容 / mode），用于重复点击时还原展示。
  -- 单独一列，CMP 核验写 provider_response 时不会覆盖它。
  ADD COLUMN IF NOT EXISTS pay_session jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_idempotency_key_unique
  ON public.wallet_transactions (idempotency_key) WHERE idempotency_key IS NOT NULL;
