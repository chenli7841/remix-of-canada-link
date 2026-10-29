-- Shared format: prefix + route(2) + customer(5) + Toronto YYMMDD + sequence(3).
-- Existing numbers remain stable; route changes retain aliases. No historical renumbering.
BEGIN;
CREATE OR REPLACE FUNCTION public.gen_short_no(_prefix text, _customer_code text, _route_code text, _at timestamptz)
RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE pfx text; cust text; route text; local_day timestamp; scope text; n bigint; candidate text;
BEGIN
  pfx := upper(COALESCE(NULLIF(_prefix,''),'XX'));
  pfx := rpad(left(pfx,2),2,'X');
  cust := right(lpad(regexp_replace(COALESCE(_customer_code,''),'\D','','g'),5,'0'),5);
  route := left(lpad(upper(COALESCE(NULLIF(_route_code,''),'XX')),2,'X'),2);
  local_day := COALESCE(_at,now()) AT TIME ZONE 'America/Toronto';
  scope := pfx || route || cust || to_char(local_day,'YYYYMMDD');
  LOOP
    INSERT INTO public.waybill_no_counters AS c(scope_key,seq,updated_at) VALUES(scope,1,now())
      ON CONFLICT(scope_key) DO UPDATE SET seq=c.seq+1,updated_at=now() RETURNING seq INTO n;
    IF n > 1000 THEN RAISE EXCEPTION '编号当日额度已用完：% / % / %（最多1000个）',cust,route,to_char(local_day,'YYMMDD'); END IF;
    candidate := pfx || route || cust || to_char(local_day,'YYMMDD') || lpad((n-1)::text,3,'0');
    EXIT WHEN NOT EXISTS(SELECT 1 FROM public.forwarding_orders WHERE request_no=candidate OR aliases @> ARRAY[candidate])
      AND NOT EXISTS(SELECT 1 FROM public.orders WHERE order_no=candidate OR aliases @> ARRAY[candidate])
      AND NOT EXISTS(SELECT 1 FROM public.waybills WHERE waybill_no=candidate OR aliases @> ARRAY[candidate])
      AND NOT EXISTS(SELECT 1 FROM public.shipments WHERE tracking_no=candidate);
  END LOOP;
  RETURN candidate;
END $$;

CREATE OR REPLACE FUNCTION public.gen_fo_request_no() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF COALESCE(NEW.request_no,'')='' THEN NEW.request_no:=public.gen_short_no('FW',NEW.customer_code,NEW.route_code,now()); END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.gen_order_no() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF COALESCE(NEW.order_no,'')='' THEN NEW.order_no:=public.gen_short_no('SC',NEW.customer_code,NEW.route_code,now()); END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.gen_waybill_no(_customer_code text DEFAULT NULL,_route_code text DEFAULT NULL,_destination_code text DEFAULT NULL,_shipping_method text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql SET search_path=public AS $$
DECLARE company text; route text; route_map jsonb;
BEGIN
  SELECT value->>'code' INTO company FROM public.app_settings WHERE key='waybill_company_code';
  company:=COALESCE(NULLIF(company,''),'SC');
  route:=NULLIF(_route_code,'');
  IF route IS NULL THEN
    SELECT value INTO route_map FROM public.app_settings WHERE key='waybill_route_codes';
    route:=COALESCE(route_map->COALESCE(_shipping_method,'air')->>COALESCE(_destination_code,''),'XX');
  END IF;
  RETURN public.gen_short_no(company,_customer_code,route,now());
END $$;

-- Preserve the deployed route-change function and its permissions; replace only
-- numbering expressions. Refuse unknown implementations instead of overwriting them.
DO $$
DECLARE body text; next_body text;
BEGIN
  body:=pg_get_functiondef('public.admin_change_route(text,uuid,text,uuid,text)'::regprocedure);
  next_body:=regexp_replace(body,
    $re$order_no = 'SC' \|\| lpad\(COALESCE\(v_cust,''\),5,'0'\) \|\| upper\(v_route.code\)\s*\|\| to_char\(now\(\),'YYMMDD'\) \|\| upper\(COALESCE\(v_route.destination_code,'XXX'\)\)\s*\|\| lpad\(\(floor\(random\(\)\*100000\)\)::text,5,'0'\)$re$,
    $rep$order_no = public.gen_short_no('SC',v_cust,v_route.code,now())$rep$);
  next_body:=regexp_replace(next_body,
    $re$request_no = 'FW' \|\| lpad\(COALESCE\(v_cust,''\),5,'0'\) \|\| upper\(v_route.code\)\s*\|\| to_char\(now\(\),'YYMMDD'\) \|\| upper\(COALESCE\(v_route.destination_code,'XXX'\)\)\s*\|\| lpad\(\(floor\(random\(\)\*100000\)\)::text,5,'0'\)$re$,
    $rep$request_no = public.gen_short_no('FW',v_cust,v_route.code,now())$rep$);
  IF position('random()' in next_body)>0 OR position('public.gen_short_no(''FW''' in next_body)=0 OR position('public.gen_short_no(''SC''' in next_body)=0 THEN
    RAISE EXCEPTION 'Unexpected admin_change_route implementation; inspect before migrating';
  END IF;
  next_body:=replace(next_body,'FROM public.orders WHERE id = _entity_id;','FROM public.orders WHERE id = _entity_id FOR UPDATE;');
  next_body:=replace(next_body,'FROM public.forwarding_orders WHERE id = _entity_id;','FROM public.forwarding_orders WHERE id = _entity_id FOR UPDATE;');
  EXECUTE next_body;
END $$;
COMMIT;
