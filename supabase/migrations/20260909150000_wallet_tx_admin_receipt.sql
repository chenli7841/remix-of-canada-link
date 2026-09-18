-- 后台钱包流水「操作回执」：员工可对一条流水填写原因、给出结果，把状态改成
--   completed（已充值 / 生效） 或 cancelled（已无效 / 作废），并保留回执记录 + 审计。
--
-- 关键：apply_wallet_tx 触发器只在「转入 completed 且 channel 不是 emt/cash」时动余额，
-- 且没有反向逻辑。所以本 RPC 显式补齐两种情况：
--   1) 转 completed 但触发器不会处理（emt/cash 的充值类）→ 手动加余额
--   2) completed 转 cancelled（余额此前已计入）→ 手动退回
-- 其余组合只改状态 + 记录，不动余额。

ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS receipt_reason text,
  ADD COLUMN IF NOT EXISTS receipt_by uuid,
  ADD COLUMN IF NOT EXISTS receipt_at timestamptz;

CREATE OR REPLACE FUNCTION public.wallet_tx_admin_receipt(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    uuid    := auth.uid();
  v_tx_id  uuid    := NULLIF(_payload->>'tx_id', '')::uuid;
  v_new    text    := _payload->>'new_status';
  v_reason text    := NULLIF(trim(COALESCE(_payload->>'reason', '')), '');
  v_tx     public.wallet_transactions%ROWTYPE;
  v_sign   int;
  v_touches       boolean;
  v_already       boolean;
  v_should        boolean;
  v_trigger_will  boolean;
  v_delta   numeric := 0;
  v_applied numeric := 0;
BEGIN
  IF NOT public.is_staff(v_uid) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  IF v_tx_id IS NULL THEN RAISE EXCEPTION 'tx_id required'; END IF;
  IF v_new NOT IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'new_status must be completed or cancelled';
  END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'reason required'; END IF;

  SELECT * INTO v_tx FROM public.wallet_transactions WHERE id = v_tx_id FOR UPDATE;
  IF v_tx.id IS NULL THEN RAISE EXCEPTION 'transaction not found'; END IF;
  IF v_tx.status = v_new THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_change', 'status', v_tx.status);
  END IF;

  v_sign         := CASE WHEN v_tx.type IN ('recharge', 'refund', 'adjust') THEN 1 ELSE -1 END;
  -- 线下扣款（emt/cash 的 spend）从不影响余额；其余都影响
  v_touches      := NOT (v_tx.type = 'spend' AND COALESCE(v_tx.channel, '') IN ('emt', 'cash'));
  v_already      := (v_tx.status = 'completed' AND v_touches);
  v_should       := (v_new = 'completed' AND v_touches);
  v_trigger_will := (v_new = 'completed' AND v_tx.status <> 'completed'
                     AND COALESCE(v_tx.channel, '') NOT IN ('emt', 'cash'));
  v_delta        := v_sign * COALESCE(v_tx.amount_cad, 0);

  IF v_should AND NOT v_already THEN
    -- 需要计入余额；触发器能处理的就交给触发器（避免双记）
    IF NOT v_trigger_will THEN
      INSERT INTO public.wallets (user_id, balance_cny, balance_cad)
        VALUES (v_tx.user_id, 0, 0) ON CONFLICT (user_id) DO NOTHING;
      UPDATE public.wallets SET balance_cad = balance_cad + v_delta, updated_at = now()
        WHERE user_id = v_tx.user_id;
    END IF;
    v_applied := v_delta;
  ELSIF v_already AND NOT v_should THEN
    -- 撤销一笔已计入的流水 → 反向调整
    UPDATE public.wallets SET balance_cad = balance_cad - v_delta, updated_at = now()
      WHERE user_id = v_tx.user_id;
    v_applied := -v_delta;
  END IF;

  UPDATE public.wallet_transactions SET
    status         = v_new,
    receipt_reason = v_reason,
    receipt_by     = v_uid,
    receipt_at     = now()
  WHERE id = v_tx_id;

  INSERT INTO public.admin_action_logs (entity_type, entity_id, action, before, after, operator_id, operator_name, note)
  VALUES (
    'wallet_transaction', v_tx_id::text,
    CASE WHEN v_new = 'completed' THEN 'receipt_mark_completed' ELSE 'receipt_mark_void' END,
    jsonb_build_object('status', v_tx.status, 'amount_cad', v_tx.amount_cad, 'type', v_tx.type, 'channel', v_tx.channel),
    jsonb_build_object('status', v_new, 'balance_delta_cad', v_applied),
    v_uid,
    (SELECT full_name FROM public.profiles WHERE id = v_uid),
    v_reason
  );

  RETURN jsonb_build_object(
    'ok', true,
    'tx_id', v_tx_id,
    'old_status', v_tx.status,
    'new_status', v_new,
    'balance_delta_cad', v_applied
  );
END $$;

REVOKE ALL ON FUNCTION public.wallet_tx_admin_receipt(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wallet_tx_admin_receipt(jsonb) TO authenticated;
