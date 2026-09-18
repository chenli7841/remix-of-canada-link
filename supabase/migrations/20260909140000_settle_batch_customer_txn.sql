-- 批次结算收敛为一个事务 RPC，解决大批次超时 + 半成功（钱扣了、账单/运单没全更新、重试重复扣款）。
--
-- 只做「钱 + 状态」这一段，全部在同一事务里：
--   锁定该客户在批次内的未付运单 → 读冻结账单金额（不重算整批）→ 校验余额
--   → 写钱包流水（触发器扣余额）→ 冻结账单转已付 → 运单批量标记已付
--   → batch_settlements 快照 → （可选）积分 → 一条批次操作日志
-- 逐运单日志 / shipments / 物流轨迹这些重活留在事务外，由调用方提交后批量补写。
--
-- 幂等：先按「该客户在批次内还有没有未付运单」判断；配合 FOR UPDATE 行锁，
-- 并发或重试都会拿到 already_paid，且事务原子性保证不会出现「扣了一半」。

CREATE OR REPLACE FUNCTION public.settle_batch_customer_txn(_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_batch_id      uuid    := NULLIF(_payload->>'batch_id', '')::uuid;
  v_user          uuid    := NULLIF(_payload->>'customer_user_id', '')::uuid;
  v_code          text    := NULLIF(_payload->>'customer_code', '');
  v_method        text    := COALESCE(NULLIF(_payload->>'method', ''), 'wallet');
  v_discount_cad  numeric := GREATEST(COALESCE((_payload->>'discount_cad')::numeric, 0), 0);
  v_ref           text    := NULLIF(_payload->>'ref_no', '');
  v_note          text    := NULLIF(_payload->>'note', '');
  v_operator      uuid    := NULLIF(_payload->>'operator_id', '')::uuid;
  v_operator_name text    := NULLIF(_payload->>'operator_name', '');
  v_enforce       boolean := COALESCE((_payload->>'enforce_balance')::boolean, false);
  v_award         boolean := COALESCE((_payload->>'award_points')::boolean, false);

  v_batch_no   text;
  v_wb_ids     uuid[];
  v_wb_nos     text[];
  v_order_ids  uuid[];
  v_fwd_ids    uuid[];
  v_inv        public.invoices%ROWTYPE;
  v_inv_fx     numeric;
  v_sub_cny    numeric;
  v_discount_cny numeric;
  v_total_cny  numeric;
  v_sub_cad    numeric;
  v_final_cad  numeric;
  v_bal        numeric;
  v_label      text;
  v_points     int := 0;
BEGIN
  IF v_batch_id IS NULL OR v_user IS NULL THEN
    RAISE EXCEPTION 'settle_batch_customer_txn: batch_id and customer_user_id are required';
  END IF;

  SELECT batch_no INTO v_batch_no FROM public.batches WHERE id = v_batch_id;
  v_batch_no := COALESCE(v_batch_no, v_batch_id::text);

  -- 1) 锁定并收集该客户在本批次内的未付运单
  SELECT array_agg(s.id), array_agg(s.waybill_no)
    INTO v_wb_ids, v_wb_nos
  FROM (
    SELECT w.id, w.waybill_no
    FROM public.waybills w
    WHERE w.assigned_batch_id = v_batch_id
      AND w.payment_status IS DISTINCT FROM 'paid'
      AND (
        EXISTS (SELECT 1 FROM public.orders o WHERE o.id = w.order_id AND o.customer_code = v_code)
        OR EXISTS (SELECT 1 FROM public.forwarding_orders f WHERE f.id = w.forwarding_id AND f.customer_code = v_code)
      )
    ORDER BY w.id
    FOR UPDATE
  ) s;

  IF v_wb_ids IS NULL OR array_length(v_wb_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_paid');
  END IF;

  SELECT
    COALESCE(array_agg(DISTINCT order_id) FILTER (WHERE order_id IS NOT NULL), '{}')::uuid[],
    COALESCE(array_agg(DISTINCT forwarding_id) FILTER (WHERE forwarding_id IS NOT NULL), '{}')::uuid[]
    INTO v_order_ids, v_fwd_ids
  FROM public.waybills WHERE id = ANY(v_wb_ids);

  -- 2) 冻结账单（价格确认时生成）——付款按它的金额扣，不重算整批
  SELECT * INTO v_inv
  FROM public.invoices
  WHERE user_id = v_user AND type = 'batch' AND batch_no = v_batch_no
    AND status IN ('unpaid', 'overdue')
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_inv.id IS NULL THEN
    -- 调用方负责在没有冻结账单时先生成一张；到这里还没有说明确实无可结算
    RETURN jsonb_build_object('ok', false, 'reason', 'no_frozen_invoice');
  END IF;

  v_inv_fx  := COALESCE(NULLIF(v_inv.fx_rate, 0), public.current_fx_cny_to_cad());
  v_sub_cny := ROUND(COALESCE(v_inv.total_cny, 0), 2);
  v_discount_cny := CASE WHEN v_discount_cad > 0 THEN ROUND(v_discount_cad / v_inv_fx, 2) ELSE 0 END;
  v_total_cny := ROUND(v_sub_cny - v_discount_cny, 2);
  v_sub_cad   := ROUND(v_sub_cny * v_inv_fx, 2);
  v_final_cad := ROUND(v_sub_cad - v_discount_cad, 2);

  IF v_final_cad <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'nothing_to_pay');
  END IF;

  v_label := CASE v_method WHEN 'wallet' THEN '钱包扣款' WHEN 'emt' THEN 'EMT 收款' ELSE '现金收款' END;

  -- 3) 余额校验（仅客户自助 / 需强制余额时）
  IF v_enforce AND v_method = 'wallet' THEN
    SELECT COALESCE(balance_cad, 0) INTO v_bal FROM public.wallets WHERE user_id = v_user;
    IF COALESCE(v_bal, 0) < v_final_cad THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'insufficient',
        'need_cad', v_final_cad, 'balance_cad', COALESCE(v_bal, 0));
    END IF;
  END IF;

  -- 4) 钱包流水（apply_wallet_tx 触发器：wallet 渠道才扣余额，emt/cash 只留痕）
  INSERT INTO public.wallet_transactions (user_id, type, status, amount_cad, amount_cny, channel, ref_no, note)
  VALUES (
    v_user, 'spend', 'completed', v_final_cad, v_total_cny, v_method, v_ref,
    COALESCE(v_note, '批次 ' || v_batch_no || ' · ' || v_label
      || CASE WHEN v_discount_cad > 0 THEN ' (含折扣 CA$' || to_char(v_discount_cad, 'FM999999990.00') || ')' ELSE '' END)
  );

  -- 5) 冻结账单转已付（金额/行项不动，只翻状态 + 记实付）
  UPDATE public.invoices SET
    payment_method = v_method,
    status         = 'paid',
    paid_cny       = v_total_cny,
    paid_cad       = v_final_cad,
    paid_at        = now(),
    note           = '批次 ' || v_batch_no || ' · ' || v_label
      || CASE WHEN v_discount_cad > 0 THEN ' (折扣 CA$' || to_char(v_discount_cad, 'FM999999990.00') || ')' ELSE '' END
  WHERE id = v_inv.id
  RETURNING * INTO v_inv;

  -- 6) 运单批量标记已付（一条语句）
  UPDATE public.waybills SET payment_status = 'paid' WHERE id = ANY(v_wb_ids);

  -- 7) 付款状态快照
  INSERT INTO public.batch_settlements (batch_id, customer_code, is_paid, paid_at)
  VALUES (v_batch_id, v_code, true, now())
  ON CONFLICT (batch_id, customer_code)
  DO UPDATE SET is_paid = true, paid_at = now(), updated_at = now();

  -- 8) 积分（可选）
  IF v_award THEN
    BEGIN
      SELECT public.award_points_for_spend(v_user, v_final_cad) INTO v_points;
    EXCEPTION WHEN OTHERS THEN
      v_points := 0;
    END;
  END IF;

  -- 9) 一条批次级操作日志（逐运单/物流轨迹留给调用方事务外补写）
  INSERT INTO public.admin_action_logs (entity_type, entity_id, action, after, operator_id, operator_name, note)
  VALUES (
    'batch', v_batch_id::text, 'wallet_deduct',
    jsonb_build_object('user_id', v_user, 'customer_code', v_code, 'amount_cad', v_final_cad,
                       'discount_cad', v_discount_cad, 'invoice_id', v_inv.id, 'method', v_method),
    v_operator, v_operator_name,
    '客户 ' || COALESCE(v_code, v_user::text) || ' 结算 CA$' || to_char(v_final_cad, 'FM999999990.00')
      || CASE WHEN v_discount_cad > 0 THEN '（折扣 CA$' || to_char(v_discount_cad, 'FM999999990.00') || '）' ELSE '' END
      || '（批次 ' || v_batch_no || ' · ' || v_label || '）'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'invoice_id', v_inv.id,
    'invoice_no', v_inv.invoice_no,
    'paid_cad', v_final_cad,
    'total_cny', v_total_cny,
    'points_earned', v_points,
    'batch_no', v_batch_no,
    'waybill_ids', to_jsonb(v_wb_ids),
    'waybill_nos', to_jsonb(v_wb_nos),
    'order_ids', to_jsonb(v_order_ids),
    'forwarding_ids', to_jsonb(v_fwd_ids)
  );
END $$;

REVOKE ALL ON FUNCTION public.settle_batch_customer_txn(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_batch_customer_txn(jsonb) TO authenticated, service_role;
