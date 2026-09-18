-- 充值申请记录（后台）：为 wallet_transactions 的 recharge 类流水补齐渠道核验字段，
-- 加去重约束，并提供 EMT 确认 / 作废 / OTT CMP 核验入账的原子服务端函数。
-- 所有状态写入必须经过这些 SECURITY DEFINER 函数（前端不得直接 update）。

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS provider_payment_id text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_response jsonb;

-- 回填：此前 OTT Payment ID 只塞在 note 的 "pid=xxx" 里
UPDATE public.wallet_transactions
SET provider_payment_id = (regexp_match(note, 'pid=([A-Za-z0-9_-]+)'))[1]
WHERE provider_payment_id IS NULL
  AND note ~ 'pid=[A-Za-z0-9_-]+';

-- 回填可能撞车：同一 provider_payment_id 只保留最新一条，其余置空后再建唯一索引
WITH dups AS (
  SELECT id, row_number() OVER (PARTITION BY provider_payment_id ORDER BY created_at DESC) AS rn
  FROM public.wallet_transactions
  WHERE provider_payment_id IS NOT NULL
)
UPDATE public.wallet_transactions t
SET provider_payment_id = NULL
FROM dups
WHERE dups.id = t.id AND dups.rn > 1;

-- ref_no 全局唯一（一次充值只有一条流水）。若历史数据存在重复 ref_no，本条会失败——
-- 那属于需要人工清理的数据问题，不应静默放过。
CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_ref_no_unique
  ON public.wallet_transactions (ref_no) WHERE ref_no IS NOT NULL;

-- 一个 OTT Payment ID 只对应一条流水
CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_provider_payment_unique
  ON public.wallet_transactions (provider_payment_id) WHERE provider_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS wallet_transactions_recharge_pending
  ON public.wallet_transactions (type, status, created_at DESC)
  WHERE type = 'recharge';

-- ---------------------------------------------------------------------------
-- 原子操作：EMT 确认到账 / 作废 / OTT CMP 核验入账 / 记录查询结果
--   op = emt_confirm | void | ott_settle | ott_mark_failed | ott_record
-- 全部用 WHERE ... AND status='pending' 做条件更新 + ROW_COUNT 校验，保证幂等；
-- 入账靠 apply_wallet_tx 触发器（pending→completed 且非 emt/cash 会自动加余额；
-- emt 渠道触发器跳过，这里对 emt_confirm 手动补一次）。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_recharge_action(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid  := auth.uid();
  v_op      text  := _payload->>'op';
  v_id      uuid  := NULLIF(_payload->>'tx_id', '')::uuid;
  v_reason  text  := NULLIF(trim(COALESCE(_payload->>'reason', '')), '');
  v_pid     text  := NULLIF(_payload->>'provider_payment_id', '');
  v_pstatus text  := NULLIF(_payload->>'provider_status', '');
  v_presp   jsonb := _payload->'provider_response';
  v_tx      public.wallet_transactions%ROWTYPE;
  v_rows    int   := 0;
  v_target  text;
  v_action  text;
  v_now_status text;
BEGIN
  IF NOT (public.has_role(v_uid, 'owner') OR public.has_role(v_uid, 'manager')) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'tx_id required'; END IF;

  SELECT * INTO v_tx FROM public.wallet_transactions WHERE id = v_id FOR UPDATE;
  IF v_tx.id IS NULL THEN RAISE EXCEPTION 'transaction not found'; END IF;
  IF v_tx.type <> 'recharge' THEN RAISE EXCEPTION 'not a recharge transaction'; END IF;

  IF v_op = 'emt_confirm' THEN
    IF COALESCE(v_tx.channel, '') <> 'emt' THEN RAISE EXCEPTION 'not an EMT transaction'; END IF;
    UPDATE public.wallet_transactions SET
      status = 'completed', verified_by = v_uid, verified_at = now(),
      receipt_by = v_uid, receipt_at = now(),
      receipt_reason = COALESCE(v_reason, receipt_reason)
    WHERE id = v_id AND status = 'pending';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    -- 触发器对 emt 渠道不动余额，这里补一次（且仅当本次确实把 pending 改成了 completed）
    IF v_rows = 1 THEN
      UPDATE public.wallets SET balance_cad = balance_cad + COALESCE(v_tx.amount_cad, 0), updated_at = now()
      WHERE user_id = v_tx.user_id;
    END IF;
    v_action := 'emt_confirm_paid';

  ELSIF v_op = 'void' THEN
    IF v_reason IS NULL THEN RAISE EXCEPTION 'reason required'; END IF;
    v_target := CASE WHEN _payload->>'void_status' = 'cancelled' THEN 'cancelled' ELSE 'failed' END;
    -- 只允许从未入账的状态作废；不动钱包余额
    UPDATE public.wallet_transactions SET
      status = v_target, verified_by = v_uid, verified_at = now(),
      receipt_by = v_uid, receipt_at = now(), receipt_reason = v_reason
    WHERE id = v_id AND status IN ('pending', 'failed', 'cancelled') AND status <> v_target;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_action := 'recharge_void';

  ELSIF v_op = 'ott_settle' THEN
    -- 仅由服务端 CMP 核验通过后调用
    UPDATE public.wallet_transactions SET
      status = 'completed', verified_by = v_uid, verified_at = now(),
      provider_payment_id = COALESCE(provider_payment_id, v_pid),
      provider_status = v_pstatus, provider_response = v_presp
    WHERE id = v_id AND status = 'pending';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    -- 非 emt/cash 渠道：触发器已在本次 UPDATE 时自动加余额，这里不重复
    v_action := 'ott_settle_paid';

  ELSIF v_op = 'ott_mark_failed' THEN
    UPDATE public.wallet_transactions SET
      status = 'failed', verified_by = v_uid, verified_at = now(),
      provider_status = v_pstatus, provider_response = v_presp
    WHERE id = v_id AND status = 'pending';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_action := 'ott_mark_failed';

  ELSIF v_op = 'ott_record' THEN
    UPDATE public.wallet_transactions SET
      verified_at = now(), provider_status = v_pstatus, provider_response = v_presp,
      provider_payment_id = COALESCE(provider_payment_id, v_pid)
    WHERE id = v_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_action := 'ott_record_status';

  ELSE
    RAISE EXCEPTION 'unknown op: %', v_op;
  END IF;

  SELECT status INTO v_now_status FROM public.wallet_transactions WHERE id = v_id;

  INSERT INTO public.admin_action_logs (entity_type, entity_id, action, before, after, operator_id, operator_name, note)
  VALUES (
    'wallet_transaction', v_id::text, v_action,
    jsonb_build_object('status', v_tx.status, 'channel', v_tx.channel, 'amount_cad', v_tx.amount_cad),
    jsonb_build_object('status', v_now_status, 'provider_status', v_pstatus, 'rows_changed', v_rows),
    v_uid, (SELECT full_name FROM public.profiles WHERE id = v_uid), v_reason
  );

  RETURN jsonb_build_object(
    'ok', v_rows > 0 OR v_op = 'ott_record',
    'rows_changed', v_rows,
    'status', v_now_status,
    'was', v_tx.status
  );
END $$;

REVOKE ALL ON FUNCTION public.wallet_recharge_action(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_recharge_action(jsonb) TO authenticated;
