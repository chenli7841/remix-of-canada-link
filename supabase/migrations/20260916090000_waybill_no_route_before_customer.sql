-- 运单号排列规则修正：线路代码必须排在客户号前面。
--
-- 现状（20260913100000 引入的计数器方案）拼接顺序是
--   公司(2) + 客户号(5) + 线路(2) + 日期(MMDD,4) + 序号(4，无上限)
-- 例如 SC09001TY09160001——客户号在前、线路在中间，不符合目标格式。
--
-- 目标格式：SC + 线路代码 + 客户号 + 日期 + 递增三位序号，即
--   公司(2) + 线路(2) + 客户号(5) + 日期(YYMMDD,6) + 序号(3)
-- 且每天每客户每线路恰好 1000 个坑位（000~999），用满后第 1001 张必须报错，
-- 不追加第四位、不改用随机数兜底——原因见 20260913100000 的注释：位数一旦
-- 可以悄悄变长/变随机，"号码不够用"的故障就会用另一种形式复现。
--
-- 计数维度不变：仍按 客户+线路+业务日 独立计数（不同线路可以撞相同尾号，
-- 数据库唯一性约束在 waybills.waybill_no 整串上，不是只查三位尾号）。
-- 业务日改成按 America/Toronto 计算；计数键（scope_key，内部使用，不对外
-- 展示）改用 YYYYMMDD 带完整 4 位年份，避免多年后 key 复用；可见号码里的
-- 日期段改用 YYMMDD（2 位年份），比原来的 MMDD 多带年份信息，防止跨年后
-- 出现与历史完全相同的整串运单号。

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
  v_local timestamp; v_day_key text; v_day_disp text;
  v_scope_key text; v_seq bigint;
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

  v_local := now() AT TIME ZONE 'America/Toronto';
  v_day_key  := to_char(v_local, 'YYYYMMDD');
  v_day_disp := to_char(v_local, 'YYMMDD');

  -- 客户 + 线路 + 业务日（含年份）三段共同决定计数维度，任一段不同都独立计数。
  v_scope_key := company || route || cust || v_day_key;

  INSERT INTO public.waybill_no_counters AS c (scope_key, seq, updated_at)
    VALUES (v_scope_key, 1, now())
  ON CONFLICT (scope_key) DO UPDATE
    SET seq = c.seq + 1, updated_at = now()
  RETURNING seq INTO v_seq;

  -- 三位尾号只有 000~999 共 1000 个坑位。用满后直接报错，让整个建单事务
  -- 回滚（计数器的这次自增也随事务一起回滚，不会把坑位"烧掉"），等换一
  -- 条线路或到下一个业务日再试。
  IF v_seq > 1000 THEN
    RAISE EXCEPTION '运单号当日额度已用完（客户 % / 线路 % / %），单日单客户单线路上限 1000 个',
      cust, route, v_day_disp;
  END IF;

  RETURN company || route || cust || v_day_disp || lpad((v_seq - 1)::text, 3, '0');
END $$;

-- =========================================================================
-- 迁移历史计数：把旧 scope_key（company+cust+route+MMDD，13 字符）的计数
-- 迁移到新 scope_key（company+route+cust+YYYYMMDD，17 字符），seq 原样
-- 保留、不清零。这样今天已经在旧格式下生成过的运单（例如客户 09001 的 TY
-- 线路当天已出的 999 个号）会继续占着当天的额度，新规则不会让同一客户、
-- 同一线路、同一天再多出 1000 个坑位。
-- 年份从该计数器行的 updated_at（换算成 America/Toronto）取得——这批旧
-- 计数器都是本次上线前几天内产生的，用它换算年份是准确的。
DO $$
DECLARE r record; v_year text; v_new_key text;
BEGIN
  FOR r IN
    SELECT scope_key, seq, updated_at
      FROM public.waybill_no_counters
     WHERE scope_key ~ '^[A-Z]{2}[0-9]{5}[A-Z0-9]{2}[0-9]{4}$'
  LOOP
    v_year := to_char(r.updated_at AT TIME ZONE 'America/Toronto', 'YYYY');
    v_new_key := left(r.scope_key, 2)          -- company
              || substr(r.scope_key, 8, 2)     -- route
              || substr(r.scope_key, 3, 5)     -- cust
              || v_year || right(r.scope_key, 4); -- YYYY + MMDD

    INSERT INTO public.waybill_no_counters AS c (scope_key, seq, updated_at)
      VALUES (v_new_key, r.seq, r.updated_at)
    ON CONFLICT (scope_key) DO UPDATE
      SET seq = GREATEST(c.seq, EXCLUDED.seq),
          updated_at = GREATEST(c.updated_at, EXCLUDED.updated_at);
  END LOOP;

  DELETE FROM public.waybill_no_counters
   WHERE scope_key ~ '^[A-Z]{2}[0-9]{5}[A-Z0-9]{2}[0-9]{4}$';
END $$;
