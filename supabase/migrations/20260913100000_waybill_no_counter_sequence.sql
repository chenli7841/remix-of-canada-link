-- 运单号生成改成真正的递增序号，替换掉之前"3位随机数 + 查重试500次 + 超时瞎猜"的方案
-- （见 20260828043555_...的 gen_short_no/gen_waybill_no）。
--
-- 根因：同一个客户 + 同一条线路 + 同一天，能变化的只有末尾 3 位随机数，一共只有
-- 1000 种组合。下单箱数没有任何上限（见 20260904150000 的注释：单次提交合法地
-- 达到几百箱），大客户单日单线路很容易把这 1000 个坑占得七七八八。重试超过 500
-- 次找不到空号时，原逻辑会直接再拼一位数字就退出、不再验证是否唯一——命中已存在
-- 的号码时，waybills.waybill_no 的 UNIQUE 约束会报错，整单建单失败。这就是客户
-- 反馈"运单号不够"的根因。
--
-- 改成按 (公司前缀+客户+线路+当天) 维度原子递增的计数器后：
--   · 从根上不会再撞号（数字用完了继续往上加，不受位数限制，lpad 对更长的数字
--     不做截断），不存在"用完"这回事；
--   · 单次生成从"最多 500 次 EXISTS 全表查询 + 兜底瞎猜"降为一次 UPSERT，
--     对大批量建单（几百箱）也是明显的性能提升。
--
-- 只动 gen_waybill_no 本身；gen_short_no 以及复用它的 gen_fo_request_no /
-- gen_order_no（集运单号/电商单号，每单只生成一次，撞满 1000 个坑的概率极低）
-- 保持不变，不在这次改动范围内。

CREATE TABLE IF NOT EXISTS public.waybill_no_counters (
  scope_key text PRIMARY KEY,
  seq bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.waybill_no_counters FROM public, anon, authenticated;
GRANT ALL ON public.waybill_no_counters TO service_role;
ALTER TABLE public.waybill_no_counters ENABLE ROW LEVEL SECURITY;
-- 不给 authenticated/anon 建策略 = 默认全拒绝，只有 service_role（或者跑在
-- SECURITY DEFINER 函数里、当前角色已经切换成函数属主）能碰这张表，跟仓库里
-- 其它内部计数/簿记表（如 partner_api_idempotency）的一贯做法一致。

CREATE OR REPLACE FUNCTION public.gen_waybill_no(
  _customer_code text DEFAULT NULL,
  _route_code text DEFAULT NULL,
  _destination_code text DEFAULT NULL,
  _shipping_method text DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  company text; route_map jsonb; route text; cust text;
  v_scope_key text; v_seq bigint; v_day text;
BEGIN
  SELECT (value->>'code') INTO company FROM public.app_settings WHERE key = 'waybill_company_code';
  company := COALESCE(NULLIF(company,''), 'SC');

  IF _route_code IS NOT NULL AND _route_code <> '' THEN
    route := upper(_route_code);
  ELSE
    SELECT value INTO route_map FROM public.app_settings WHERE key = 'waybill_route_codes';
    route := upper(COALESCE(
      route_map->COALESCE(_shipping_method,'air')->>COALESCE(_destination_code,''), 'XX'));
  END IF;
  IF length(route) < 2 THEN route := lpad(route, 2, 'X'); END IF;
  IF length(route) > 2 THEN route := left(route, 2); END IF;

  cust := lpad(regexp_replace(COALESCE(_customer_code,''), '\D', '', 'g'), 5, '0');
  IF length(cust) > 5 THEN cust := right(cust, 5); END IF;

  v_day := to_char(now(), 'MMDD');
  -- company(2)+cust(5)+route(2)+day(4) 全是定长字段，直接拼接不会因为长度不定
  -- 而串位，跟 gen_short_no 原来的做法一致。
  v_scope_key := company || cust || route || v_day;

  INSERT INTO public.waybill_no_counters AS c (scope_key, seq, updated_at)
    VALUES (v_scope_key, 1, now())
  ON CONFLICT (scope_key) DO UPDATE
    SET seq = c.seq + 1, updated_at = now()
  RETURNING seq INTO v_seq;

  -- lpad 对已经比目标宽度更长的数字不做截断，所以就算某个客户某条线路当天冲到
  -- 10000+ 单，序号只会自然变长，不会丢精度、也不会绕回重复。
  RETURN company || cust || route || v_day || lpad(v_seq::text, 4, '0');
END $$;
-- 不改这个函数本身的 EXECUTE 权限：20260828043555 用 DROP+CREATE 重建过一次，
-- 之后就是 Postgres 新函数的默认权限（PUBLIC 可执行），这个改动只动号码生成
-- 逻辑本身，不顺手收权限，避免引入跟这次修复无关的访问面变化。
