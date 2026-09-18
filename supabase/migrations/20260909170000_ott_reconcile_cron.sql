-- OTT 充值定时对账（pg_cron）：
--   pg_cron 每 2 分钟调 _ott_reconcile_tick()，它用 pg_net 打我们自己的
--   /api/public/hooks/reconcile-ott（带共享密钥），由该路由用应用端的 OTT 密钥
--   逐笔调 CMP 核验并原子入账。用户关掉付款页也能自动补录。
--
--   启用前需设置两个数据库参数（值与应用环境变量 OTT_RECONCILE_SECRET 保持一致）：
--     ALTER DATABASE postgres SET app.ott_reconcile_url =
--       'https://shopper.epluscanada.com/api/public/hooks/reconcile-ott';
--     ALTER DATABASE postgres SET app.ott_reconcile_secret = '<一段随机字符串>';
--   未设置时 tick 直接跳过，定时任务空转不产生副作用。

-- ---------------------------------------------------------------------------
-- 系统对账专用：只做 OTT 三个 op，无 auth.uid / 角色校验，仅 service_role 可执行。
-- 与 wallet_recharge_action 相同的原子条件更新 + ROW_COUNT，审计记为 system-reconcile。
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._wallet_recharge_settle_system(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_op      text  := _payload->>'op';
  v_id      uuid  := NULLIF(_payload->>'tx_id', '')::uuid;
  v_pid     text  := NULLIF(_payload->>'provider_payment_id', '');
  v_pstatus text  := NULLIF(_payload->>'provider_status', '');
  v_presp   jsonb := _payload->'provider_response';
  v_tx      public.wallet_transactions%ROWTYPE;
  v_rows    int := 0;
  v_action  text;
  v_now_status text;
BEGIN
  IF v_id IS NULL THEN RAISE EXCEPTION 'tx_id required'; END IF;
  SELECT * INTO v_tx FROM public.wallet_transactions WHERE id = v_id FOR UPDATE;
  IF v_tx.id IS NULL OR v_tx.type <> 'recharge' THEN RAISE EXCEPTION 'not a recharge transaction'; END IF;

  IF v_op = 'ott_settle' THEN
    UPDATE public.wallet_transactions SET
      status = 'completed', verified_at = now(),
      provider_payment_id = COALESCE(provider_payment_id, v_pid),
      provider_status = v_pstatus, provider_response = v_presp
    WHERE id = v_id AND status = 'pending';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_action := 'ott_reconcile_settle';
  ELSIF v_op = 'ott_mark_failed' THEN
    UPDATE public.wallet_transactions SET
      status = 'failed', verified_at = now(),
      provider_status = v_pstatus, provider_response = v_presp
    WHERE id = v_id AND status = 'pending';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_action := 'ott_reconcile_failed';
  ELSIF v_op = 'ott_record' THEN
    UPDATE public.wallet_transactions SET
      verified_at = now(), provider_status = v_pstatus, provider_response = v_presp,
      provider_payment_id = COALESCE(provider_payment_id, v_pid)
    WHERE id = v_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_action := 'ott_reconcile_record';
  ELSE
    RAISE EXCEPTION 'unknown op: %', v_op;
  END IF;

  SELECT status INTO v_now_status FROM public.wallet_transactions WHERE id = v_id;

  IF v_op <> 'ott_record' OR v_pstatus IS DISTINCT FROM v_tx.provider_status THEN
    INSERT INTO public.admin_action_logs (entity_type, entity_id, action, before, after, operator_id, operator_name, note)
    VALUES (
      'wallet_transaction', v_id::text, v_action,
      jsonb_build_object('status', v_tx.status, 'provider_status', v_tx.provider_status),
      jsonb_build_object('status', v_now_status, 'provider_status', v_pstatus, 'rows_changed', v_rows),
      NULL, 'system-reconcile', 'OTT 定时对账'
    );
  END IF;

  RETURN jsonb_build_object('ok', v_rows > 0 OR v_op = 'ott_record', 'rows_changed', v_rows, 'status', v_now_status, 'was', v_tx.status);
END $$;

REVOKE ALL ON FUNCTION public._wallet_recharge_settle_system(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._wallet_recharge_settle_system(jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- pg_cron / pg_net（Supabase 需在 Database > Extensions 先启用；未启用则本段跳过，
-- 定时任务不注册，其余功能——包括后台「向 OTT 查询」按钮——不受影响）
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  CREATE EXTENSION IF NOT EXISTS pg_net;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron/pg_net 未启用，跳过定时对账注册：%', SQLERRM;
END $$;

CREATE OR REPLACE FUNCTION public._ott_reconcile_tick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    text := NULLIF(current_setting('app.ott_reconcile_url', true), '');
  v_secret text := NULLIF(current_setting('app.ott_reconcile_secret', true), '');
BEGIN
  IF v_url IS NULL OR v_secret IS NULL THEN
    RETURN; -- 未配置，空转
  END IF;
  -- 是否还有待对账的 OTT 充值？没有就不打接口
  IF NOT EXISTS (
    SELECT 1 FROM public.wallet_transactions
    WHERE type = 'recharge' AND status = 'pending' AND channel IN ('wechat', 'alipay', 'card')
      AND created_at > now() - interval '24 hours'
      AND created_at < now() - interval '45 seconds'
  ) THEN
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reconcile-secret', v_secret),
    body := '{}'::jsonb
  );
END $$;

REVOKE ALL ON FUNCTION public._ott_reconcile_tick() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  PERFORM cron.unschedule('ott-reconcile');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule('ott-reconcile', '*/2 * * * *', 'SELECT public._ott_reconcile_tick();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron 不可用，跳过 ott-reconcile 定时任务注册：%', SQLERRM;
END $$;
