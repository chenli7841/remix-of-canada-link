-- 1) 新号生成函数（统一短格式）
CREATE OR REPLACE FUNCTION public.gen_short_no(_prefix text, _customer_code text, _route_code text, _at timestamptz)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE cust text; route text; pfx text;
BEGIN
  pfx := upper(COALESCE(NULLIF(_prefix,''),'XX'));
  IF length(pfx) <> 2 THEN pfx := rpad(left(pfx,2),2,'X'); END IF;
  cust := lpad(regexp_replace(COALESCE(_customer_code,''), '\D','','g'), 5, '0');
  IF length(cust) > 5 THEN cust := right(cust, 5); END IF;
  route := upper(COALESCE(NULLIF(_route_code,''), 'XX'));
  IF length(route) < 2 THEN route := lpad(route, 2, 'X'); END IF;
  IF length(route) > 2 THEN route := left(route, 2); END IF;
  RETURN pfx || cust || route || to_char(COALESCE(_at, now()),'MMDD')
         || lpad((floor(random()*1000))::text, 3, '0');
END $$;

-- 2) 触发器函数改用新规则
CREATE OR REPLACE FUNCTION public.gen_fo_request_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE cand text; i int := 0;
BEGIN
  IF NEW.request_no IS NOT NULL AND NEW.request_no <> '' THEN RETURN NEW; END IF;
  LOOP
    cand := public.gen_short_no('FW', NEW.customer_code, NEW.route_code, now());
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.forwarding_orders WHERE request_no = cand);
    i := i + 1;
    IF i > 500 THEN cand := cand || lpad((floor(random()*10))::text,1,'0'); EXIT; END IF;
  END LOOP;
  NEW.request_no := cand;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.gen_order_no()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE cand text; i int := 0;
BEGIN
  IF NEW.order_no IS NOT NULL AND NEW.order_no <> '' THEN RETURN NEW; END IF;
  LOOP
    cand := public.gen_short_no('SC', NEW.customer_code, NEW.route_code, now());
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE order_no = cand);
    i := i + 1;
    IF i > 500 THEN cand := cand || lpad((floor(random()*10))::text,1,'0'); EXIT; END IF;
  END LOOP;
  NEW.order_no := cand;
  RETURN NEW;
END $$;

DROP FUNCTION IF EXISTS public.gen_waybill_no(text, text, text, text);
CREATE FUNCTION public.gen_waybill_no(_customer_code text DEFAULT NULL, _route_code text DEFAULT NULL, _destination_code text DEFAULT NULL, _shipping_method text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE company text; route_map jsonb; route text; cand text; i int := 0;
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

  LOOP
    cand := public.gen_short_no(company, _customer_code, route, now());
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.waybills WHERE waybill_no = cand);
    i := i + 1;
    IF i > 500 THEN cand := cand || lpad((floor(random()*10))::text,1,'0'); EXIT; END IF;
  END LOOP;
  RETURN cand;
END $$;

-- 3) 重写历史单号
DO $mig$
DECLARE r record; cand text; i int; oldno text; company text;
BEGIN
  SELECT COALESCE(NULLIF(value->>'code',''),'SC') INTO company FROM public.app_settings WHERE key='waybill_company_code';
  company := COALESCE(company,'SC');

  -- 集运订单
  FOR r IN SELECT id, customer_code, route_code, request_no, created_at FROM public.forwarding_orders LOOP
    oldno := r.request_no;
    i := 0;
    LOOP
      cand := public.gen_short_no('FW', r.customer_code, r.route_code, r.created_at);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.forwarding_orders WHERE request_no = cand);
      i := i + 1;
      IF i > 800 THEN cand := cand || lpad((floor(random()*100))::text,2,'0'); EXIT; END IF;
    END LOOP;
    UPDATE public.forwarding_orders
       SET request_no = cand,
           aliases = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(aliases,'{}'::text[]) || CASE WHEN oldno IS NULL OR oldno='' THEN '{}'::text[] ELSE ARRAY[oldno] END) x))
     WHERE id = r.id;
  END LOOP;

  -- 电商订单
  FOR r IN SELECT id, customer_code, route_code, order_no, created_at FROM public.orders LOOP
    oldno := r.order_no;
    i := 0;
    LOOP
      cand := public.gen_short_no('SC', r.customer_code, r.route_code, r.created_at);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.orders WHERE order_no = cand);
      i := i + 1;
      IF i > 800 THEN cand := cand || lpad((floor(random()*100))::text,2,'0'); EXIT; END IF;
    END LOOP;
    UPDATE public.orders
       SET order_no = cand,
           aliases = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(aliases,'{}'::text[]) || CASE WHEN oldno IS NULL OR oldno='' THEN '{}'::text[] ELSE ARRAY[oldno] END) x))
     WHERE id = r.id;
  END LOOP;

  -- 运单
  FOR r IN
    SELECT w.id, w.waybill_no, w.created_at,
           COALESCE(o.customer_code, f.customer_code) AS customer_code,
           COALESCE(o.route_code, f.route_code) AS route_code
      FROM public.waybills w
      LEFT JOIN public.orders o ON o.id = w.order_id
      LEFT JOIN public.forwarding_orders f ON f.id = w.forwarding_id
  LOOP
    oldno := r.waybill_no;
    i := 0;
    LOOP
      cand := public.gen_short_no(company, r.customer_code, r.route_code, r.created_at);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.waybills WHERE waybill_no = cand);
      i := i + 1;
      IF i > 800 THEN cand := cand || lpad((floor(random()*100))::text,2,'0'); EXIT; END IF;
    END LOOP;
    UPDATE public.waybills
       SET waybill_no = cand,
           aliases = (SELECT ARRAY(SELECT DISTINCT x FROM unnest(COALESCE(aliases,'{}'::text[]) || CASE WHEN oldno IS NULL OR oldno='' THEN '{}'::text[] ELSE ARRAY[oldno] END) x))
     WHERE id = r.id;
    IF oldno IS NOT NULL AND oldno <> '' THEN
      UPDATE public.shipments SET tracking_no = cand WHERE tracking_no = oldno;
    END IF;
  END LOOP;

  -- 重算唛头
  FOR r IN SELECT DISTINCT order_id, forwarding_id FROM public.waybills LOOP
    PERFORM public.recompute_mark_nos_for_parent(r.order_id, r.forwarding_id);
  END LOOP;
END $mig$;