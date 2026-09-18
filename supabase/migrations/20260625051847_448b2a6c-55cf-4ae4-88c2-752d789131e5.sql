
-- =========================================================================
-- 1. profiles: 用户注册地址 + 电话
-- =========================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reg_country     text,
  ADD COLUMN IF NOT EXISTS reg_province    text,
  ADD COLUMN IF NOT EXISTS reg_city        text,
  ADD COLUMN IF NOT EXISTS reg_address     text,
  ADD COLUMN IF NOT EXISTS reg_postal_code text,
  ADD COLUMN IF NOT EXISTS reg_phone       text;

-- =========================================================================
-- 2. 单号别名 + 唛头号
-- =========================================================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public.forwarding_orders
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public.waybills
  ADD COLUMN IF NOT EXISTS aliases text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS mark_no text;

CREATE INDEX IF NOT EXISTS idx_orders_aliases    ON public.orders            USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_fo_aliases        ON public.forwarding_orders USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_waybills_aliases  ON public.waybills          USING GIN (aliases);
CREATE INDEX IF NOT EXISTS idx_waybills_mark_no  ON public.waybills (mark_no);

-- =========================================================================
-- 3. 新单号生成: {SC|FW}{cust5}{route2}{YYMMDD}{dest3}{rnd5}
-- =========================================================================
CREATE OR REPLACE FUNCTION public.gen_order_no()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cust text; route text; dest text;
BEGIN
  IF NEW.order_no IS NOT NULL AND NEW.order_no <> '' THEN RETURN NEW; END IF;
  cust  := lpad(regexp_replace(COALESCE(NEW.customer_code,''), '\D','','g'), 5, '0');
  IF length(cust) > 5 THEN cust := right(cust, 5); END IF;
  route := upper(COALESCE(NULLIF(NEW.route_code,''), 'XX'));
  IF length(route) < 2 THEN route := lpad(route, 2, 'X'); END IF;
  IF length(route) > 2 THEN route := left(route, 2); END IF;
  dest  := upper(COALESCE(NULLIF(NEW.destination_code,''), 'XXX'));
  IF length(dest) < 3 THEN dest := lpad(dest, 3, 'X'); END IF;
  IF length(dest) > 3 THEN dest := left(dest, 3); END IF;
  NEW.order_no := 'SC' || cust || route || to_char(now(),'YYMMDD') || dest
                  || lpad((floor(random()*100000))::text, 5, '0');
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.gen_fo_request_no()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE cust text; route text; dest text;
BEGIN
  IF NEW.request_no IS NOT NULL AND NEW.request_no <> '' THEN RETURN NEW; END IF;
  cust  := lpad(regexp_replace(COALESCE(NEW.customer_code,''), '\D','','g'), 5, '0');
  IF length(cust) > 5 THEN cust := right(cust, 5); END IF;
  route := upper(COALESCE(NULLIF(NEW.route_code,''), 'XX'));
  IF length(route) < 2 THEN route := lpad(route, 2, 'X'); END IF;
  IF length(route) > 2 THEN route := left(route, 2); END IF;
  dest  := upper(COALESCE(NULLIF(NEW.destination_code,''), 'XXX'));
  IF length(dest) < 3 THEN dest := lpad(dest, 3, 'X'); END IF;
  IF length(dest) > 3 THEN dest := left(dest, 3); END IF;
  NEW.request_no := 'FW' || cust || route || to_char(now(),'YYMMDD') || dest
                    || lpad((floor(random()*100000))::text, 5, '0');
  RETURN NEW;
END $$;

-- 强制运单号 route 也是 2 位 (与单号格式一致)
CREATE OR REPLACE FUNCTION public.gen_waybill_no(
  _customer_code text, _route_code text DEFAULT NULL, _destination_code text DEFAULT NULL, _shipping_method text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE company text; route_map jsonb; route text; dest text; cust text; rnd text;
BEGIN
  SELECT (value->>'code') INTO company FROM public.app_settings WHERE key = 'waybill_company_code';
  company := COALESCE(NULLIF(company,''), 'SC');
  IF length(company) <> 2 THEN company := rpad(left(company,2),2,'X'); END IF;

  IF _route_code IS NOT NULL AND _route_code <> '' THEN
    route := upper(_route_code);
  ELSE
    SELECT value INTO route_map FROM public.app_settings WHERE key = 'waybill_route_codes';
    route := upper(COALESCE(
      route_map->COALESCE(_shipping_method,'air')->>COALESCE(_destination_code,''), 'XX'));
  END IF;
  IF length(route) < 2 THEN route := lpad(route,2,'X'); END IF;
  IF length(route) > 2 THEN route := left(route,2); END IF;

  dest := upper(COALESCE(NULLIF(_destination_code,''), 'XXX'));
  IF length(dest) < 3 THEN dest := lpad(dest,3,'X'); END IF;
  IF length(dest) > 3 THEN dest := left(dest,3); END IF;

  cust := lpad(regexp_replace(COALESCE(_customer_code,''), '\D','','g'), 5, '0');
  IF length(cust) > 5 THEN cust := right(cust, 5); END IF;

  rnd := lpad((floor(random()*100000))::text, 5, '0');

  RETURN company || cust || route || to_char(now(),'YYMMDD') || dest || rnd;
END $$;

-- =========================================================================
-- 4. 唛头号自动生成 / 维护: {cust}-{order_last5}-{seq}/{total}
-- =========================================================================
CREATE OR REPLACE FUNCTION public.recompute_mark_nos_for_parent(
  _order_id uuid, _forwarding_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cust text; ono text; last5 text; total int;
BEGIN
  IF _order_id IS NOT NULL THEN
    SELECT customer_code, order_no INTO cust, ono FROM public.orders WHERE id = _order_id;
    last5 := lpad(right(regexp_replace(COALESCE(ono,''),'\D','','g'),5),5,'0');
    SELECT count(*) INTO total FROM public.waybills WHERE order_id = _order_id;
    IF total > 0 THEN
      WITH ordered AS (
        SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
          FROM public.waybills WHERE order_id = _order_id)
      UPDATE public.waybills w
         SET mark_no = lpad(COALESCE(cust,''),5,'0') || '-' || last5
                       || '-' || lpad(o.rn::text,2,'0') || '/' || lpad(total::text,2,'0')
        FROM ordered o WHERE w.id = o.id;
    END IF;
  ELSIF _forwarding_id IS NOT NULL THEN
    SELECT customer_code, request_no INTO cust, ono FROM public.forwarding_orders WHERE id = _forwarding_id;
    last5 := lpad(right(regexp_replace(COALESCE(ono,''),'\D','','g'),5),5,'0');
    SELECT count(*) INTO total FROM public.waybills WHERE forwarding_id = _forwarding_id;
    IF total > 0 THEN
      WITH ordered AS (
        SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
          FROM public.waybills WHERE forwarding_id = _forwarding_id)
      UPDATE public.waybills w
         SET mark_no = lpad(COALESCE(cust,''),5,'0') || '-' || last5
                       || '-' || lpad(o.rn::text,2,'0') || '/' || lpad(total::text,2,'0')
        FROM ordered o WHERE w.id = o.id;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.trg_recompute_mark_nos()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.recompute_mark_nos_for_parent(
    COALESCE(NEW.order_id, OLD.order_id),
    COALESCE(NEW.forwarding_id, OLD.forwarding_id));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_waybills_mark_no ON public.waybills;
CREATE TRIGGER trg_waybills_mark_no
AFTER INSERT OR DELETE ON public.waybills
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_mark_nos();

-- 回填现有运单的 mark_no
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT DISTINCT order_id, forwarding_id FROM public.waybills LOOP
    PERFORM public.recompute_mark_nos_for_parent(r.order_id, r.forwarding_id);
  END LOOP;
END $$;

-- =========================================================================
-- 5. 单号归一化 + 跨类型查找 (扫描忽略 route/dest 段)
-- =========================================================================
-- 输入格式: 2字符前缀 + 5字符客户号 + 2字符线路 + 6字符日期 + 3字符目的地 + 5字符随机 = 23 字符
-- 归一化: 去掉 route(2) + dest(3),保留 prefix(2)+cust(5)+date(6)+rnd(5) = 18 字符
CREATE OR REPLACE FUNCTION public.normalize_no(_input text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _input IS NULL THEN NULL
    WHEN upper(trim(_input)) ~ '^[A-Z]{2}[0-9]{5}[A-Z0-9]{2}[0-9]{6}[A-Z0-9]{3}[0-9]{5}$' THEN
      substr(upper(trim(_input)),1,7)        -- prefix + cust
        || substr(upper(trim(_input)),10,6)  -- date
        || substr(upper(trim(_input)),19,5)  -- rnd
    ELSE upper(trim(_input))
  END;
$$;

CREATE OR REPLACE FUNCTION public.find_by_any_no(_input text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n text; k text; r jsonb;
BEGIN
  n := upper(trim(COALESCE(_input,'')));
  IF n = '' THEN RETURN NULL; END IF;
  k := public.normalize_no(n);

  SELECT jsonb_build_object('kind','waybill','id',id,'no',waybill_no,
           'order_id',order_id,'forwarding_id',forwarding_id) INTO r
    FROM public.waybills
   WHERE waybill_no = n OR n = ANY(aliases) OR public.normalize_no(waybill_no) = k
   LIMIT 1;
  IF r IS NOT NULL THEN RETURN r; END IF;

  SELECT jsonb_build_object('kind','order','id',id,'no',order_no) INTO r
    FROM public.orders
   WHERE order_no = n OR n = ANY(aliases) OR public.normalize_no(order_no) = k
   LIMIT 1;
  IF r IS NOT NULL THEN RETURN r; END IF;

  SELECT jsonb_build_object('kind','forwarding','id',id,'no',request_no) INTO r
    FROM public.forwarding_orders
   WHERE request_no = n OR n = ANY(aliases) OR public.normalize_no(request_no) = k
   LIMIT 1;
  RETURN r;
END $$;

GRANT EXECUTE ON FUNCTION public.find_by_any_no(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_no(text) TO authenticated, anon;

-- =========================================================================
-- 6. 线路变更: 重新生成 order_no / waybill_nos, 旧号写入 aliases, 记录日志
-- =========================================================================
CREATE OR REPLACE FUNCTION public.admin_change_route(
  _entity_type text,   -- 'order' | 'forwarding'
  _entity_id   uuid,
  _new_route_code text,
  _operator_id uuid DEFAULT NULL,
  _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_route public.shipping_routes;
  v_old_no text; v_new_no text;
  v_cust text;
  v_wb record;
  v_changed int := 0;
  v_old_route text; v_old_dest text;
BEGIN
  IF _operator_id IS NULL THEN _operator_id := auth.uid(); END IF;
  IF _operator_id IS NULL OR NOT public.is_staff(_operator_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_route FROM public.shipping_routes WHERE code = _new_route_code AND is_active = true;
  IF v_route IS NULL THEN RAISE EXCEPTION '线路 % 不可用', _new_route_code; END IF;

  IF _entity_type = 'order' THEN
    SELECT order_no, customer_code, route_code, destination_code
      INTO v_old_no, v_cust, v_old_route, v_old_dest
      FROM public.orders WHERE id = _entity_id;
    IF v_old_no IS NULL THEN RAISE EXCEPTION 'order not found'; END IF;
    -- 不变直接返回
    IF v_old_route = v_route.code AND COALESCE(v_old_dest,'') = COALESCE(v_route.destination_code,'') THEN
      RETURN jsonb_build_object('ok', true, 'changed', 0, 'unchanged', true);
    END IF;
    UPDATE public.orders SET
      route_code = v_route.code,
      destination_code = v_route.destination_code,
      route_id = v_route.id,
      shipping_method = v_route.shipping_method,
      aliases = (CASE WHEN v_old_no = ANY(aliases) THEN aliases ELSE aliases || v_old_no END),
      order_no = 'SC' || lpad(COALESCE(v_cust,''),5,'0')
                 || upper(v_route.code)
                 || to_char(now(),'YYMMDD')
                 || upper(COALESCE(v_route.destination_code,'XXX'))
                 || lpad((floor(random()*100000))::text,5,'0')
    WHERE id = _entity_id
    RETURNING order_no INTO v_new_no;

  ELSIF _entity_type = 'forwarding' THEN
    SELECT request_no, customer_code, route_code, destination_code
      INTO v_old_no, v_cust, v_old_route, v_old_dest
      FROM public.forwarding_orders WHERE id = _entity_id;
    IF v_old_no IS NULL THEN RAISE EXCEPTION 'forwarding not found'; END IF;
    IF v_old_route = v_route.code AND COALESCE(v_old_dest,'') = COALESCE(v_route.destination_code,'') THEN
      RETURN jsonb_build_object('ok', true, 'changed', 0, 'unchanged', true);
    END IF;
    UPDATE public.forwarding_orders SET
      route_code = v_route.code,
      destination_code = v_route.destination_code,
      route_id = v_route.id,
      shipping_method = v_route.shipping_method,
      aliases = (CASE WHEN v_old_no = ANY(aliases) THEN aliases ELSE aliases || v_old_no END),
      request_no = 'FW' || lpad(COALESCE(v_cust,''),5,'0')
                   || upper(v_route.code)
                   || to_char(now(),'YYMMDD')
                   || upper(COALESCE(v_route.destination_code,'XXX'))
                   || lpad((floor(random()*100000))::text,5,'0')
    WHERE id = _entity_id
    RETURNING request_no INTO v_new_no;
  ELSE
    RAISE EXCEPTION 'unknown entity_type %', _entity_type;
  END IF;

  -- 重新生成每条运单号, 旧号入 aliases
  FOR v_wb IN
    SELECT id, waybill_no FROM public.waybills
     WHERE (_entity_type='order' AND order_id = _entity_id)
        OR (_entity_type='forwarding' AND forwarding_id = _entity_id)
  LOOP
    UPDATE public.waybills SET
      waybill_no = public.gen_waybill_no(v_cust, v_route.code, v_route.destination_code, v_route.shipping_method),
      aliases = (CASE WHEN v_wb.waybill_no = ANY(aliases) THEN aliases ELSE aliases || v_wb.waybill_no END),
      shipping_method = v_route.shipping_method
    WHERE id = v_wb.id;
    v_changed := v_changed + 1;
  END LOOP;

  -- 重新计算唛头号 (依赖新 order_no)
  IF _entity_type = 'order' THEN
    PERFORM public.recompute_mark_nos_for_parent(_entity_id, NULL);
  ELSE
    PERFORM public.recompute_mark_nos_for_parent(NULL, _entity_id);
  END IF;

  -- 操作日志
  INSERT INTO public.admin_action_logs (operator_id, action, target_type, target_id, before, after, note)
  VALUES (_operator_id, 'change_route', _entity_type, _entity_id,
          jsonb_build_object('route_code', v_old_route, 'destination_code', v_old_dest, 'no', v_old_no),
          jsonb_build_object('route_code', v_route.code, 'destination_code', v_route.destination_code, 'no', v_new_no),
          COALESCE(_note, '线路变更 ' || COALESCE(v_old_route,'') || '→' || v_route.code));

  RETURN jsonb_build_object('ok', true, 'old_no', v_old_no, 'new_no', v_new_no,
                            'waybills_changed', v_changed);
END $$;

GRANT EXECUTE ON FUNCTION public.admin_change_route(text, uuid, text, uuid, text) TO authenticated;
