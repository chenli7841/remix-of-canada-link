-- User approved four-digit numbering and historical renumbering; old numbers remain aliases.
BEGIN;
SET LOCAL statement_timeout = '0';
SET LOCAL lock_timeout = '10s';
LOCK TABLE public.forwarding_orders,public.orders,public.waybills,public.shipments,public.tracking_events,public.waybill_no_counters IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE number_migration_shipments ON COMMIT DROP AS SELECT id,tracking_no FROM public.shipments;
ALTER TABLE number_migration_shipments ENABLE ROW LEVEL SECURITY;
CREATE TEMP TABLE number_migration_events ON COMMIT DROP AS SELECT id,shipment_id FROM public.tracking_events;
ALTER TABLE number_migration_events ENABLE ROW LEVEL SECURITY;
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
    IF n > 10000 THEN RAISE EXCEPTION '编号当日额度已用完：% / % / %（最多10000个）',cust,route,to_char(local_day,'YYMMDD'); END IF;
    candidate := pfx || route || cust || to_char(local_day,'YYMMDD') || lpad((n-1)::text,4,'0');
    EXIT WHEN NOT EXISTS(SELECT 1 FROM public.forwarding_orders WHERE request_no=candidate OR aliases @> ARRAY[candidate])
      AND NOT EXISTS(SELECT 1 FROM public.orders WHERE order_no=candidate OR aliases @> ARRAY[candidate])
      AND NOT EXISTS(SELECT 1 FROM public.waybills WHERE waybill_no=candidate OR aliases @> ARRAY[candidate])
      AND NOT EXISTS(SELECT 1 FROM public.shipments WHERE tracking_no=candidate);
  END LOOP;
  RETURN candidate;
END $$;


CREATE TABLE IF NOT EXISTS public.document_number_migration_20261028 (
 entity_type text NOT NULL, entity_id uuid NOT NULL, old_no text, new_no text NOT NULL UNIQUE,
 before_row jsonb NOT NULL, migrated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(entity_type,entity_id)
);
ALTER TABLE public.document_number_migration_20261028 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_number_migration_20261028 FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.document_number_migration_20261028 TO service_role;
DO $$
DECLARE r record; candidate text; company text;
BEGIN
 SELECT COALESCE(NULLIF(value->>'code',''),'SC') INTO company FROM public.app_settings WHERE key='waybill_company_code';
 company:=COALESCE(company,'SC');
 FOR r IN
  SELECT 'forwarding' AS kind,f.id,f.request_no AS old_no,f.customer_code,COALESCE(sr.code,f.route_code) AS route_code,f.created_at,'FW' AS prefix,to_jsonb(f) AS original FROM public.forwarding_orders f LEFT JOIN public.shipping_routes sr ON sr.id=f.route_id
  UNION ALL SELECT 'order',o.id,o.order_no,o.customer_code,COALESCE(sr.code,o.route_code),o.created_at,'SC',to_jsonb(o) FROM public.orders o LEFT JOIN public.shipping_routes sr ON sr.id=o.route_id
  UNION ALL SELECT 'waybill',w.id,w.waybill_no,COALESCE(o.customer_code,f.customer_code),COALESCE(sr.code,o.route_code,f.route_code),w.created_at,company,to_jsonb(w) FROM public.waybills w LEFT JOIN public.orders o ON o.id=w.order_id LEFT JOIN public.forwarding_orders f ON f.id=w.forwarding_id LEFT JOIN public.shipping_routes sr ON sr.id=COALESCE(o.route_id,f.route_id)
  ORDER BY created_at,id
 LOOP
  IF EXISTS(SELECT 1 FROM public.document_number_migration_20261028 WHERE entity_type=r.kind AND entity_id=r.id) THEN CONTINUE; END IF;
  IF r.customer_code IS NULL OR r.route_code IS NULL OR r.created_at IS NULL THEN RAISE EXCEPTION 'Missing numbering metadata for % %',r.kind,r.id; END IF;
  candidate:=public.gen_short_no(r.prefix,r.customer_code,r.route_code,r.created_at);
  INSERT INTO public.document_number_migration_20261028 VALUES(r.kind,r.id,r.old_no,candidate,r.original,now());
 END LOOP;
END $$;
-- Keep shipment IDs (and therefore all tracking event relationships) unchanged.
UPDATE public.shipments s SET tracking_no=m.new_no FROM public.document_number_migration_20261028 m WHERE s.tracking_no=m.old_no AND m.old_no<>m.new_no;
UPDATE public.forwarding_orders f SET request_no=m.new_no,
 aliases=ARRAY(SELECT DISTINCT n FROM unnest(COALESCE(f.aliases,'{}'::text[])||ARRAY[m.old_no]) n WHERE n IS NOT NULL AND n<>'')
 FROM public.document_number_migration_20261028 m WHERE m.entity_type='forwarding' AND f.id=m.entity_id AND f.request_no=m.old_no;
UPDATE public.orders o SET order_no=m.new_no,
 aliases=ARRAY(SELECT DISTINCT n FROM unnest(COALESCE(o.aliases,'{}'::text[])||ARRAY[m.old_no]) n WHERE n IS NOT NULL AND n<>'')
 FROM public.document_number_migration_20261028 m WHERE m.entity_type='order' AND o.id=m.entity_id AND o.order_no=m.old_no;
-- Avoid recomputing the same large parent's tracking snapshot once per child.
ALTER TABLE public.waybills DISABLE TRIGGER unified_tracking_waybill_snapshot;
UPDATE public.waybills w SET waybill_no=m.new_no,
 aliases=ARRAY(SELECT DISTINCT n FROM unnest(COALESCE(w.aliases,'{}'::text[])||ARRAY[m.old_no]) n WHERE n IS NOT NULL AND n<>'')
 FROM public.document_number_migration_20261028 m WHERE m.entity_type='waybill' AND w.id=m.entity_id AND w.waybill_no=m.old_no;
ALTER TABLE public.waybills ENABLE TRIGGER unified_tracking_waybill_snapshot;
UPDATE public.forwarding_orders f SET tracking_no=m.new_no FROM public.document_number_migration_20261028 m WHERE f.tracking_no=m.old_no;
UPDATE public.orders o SET tracking_no=m.new_no FROM public.document_number_migration_20261028 m WHERE o.tracking_no=m.old_no;
DO $$ DECLARE r record;
BEGIN
 FOR r IN SELECT entity_type,entity_id FROM public.document_number_migration_20261028 WHERE entity_type IN ('order','forwarding') LOOP
  PERFORM public.refresh_order_tracking(r.entity_type,r.entity_id);
 END LOOP;
 IF EXISTS(
  SELECT 1 FROM public.document_number_migration_20261028 m LEFT JOIN (
   SELECT 'forwarding' AS kind,id,request_no AS no,aliases FROM public.forwarding_orders
   UNION ALL SELECT 'order',id,order_no,aliases FROM public.orders
   UNION ALL SELECT 'waybill',id,waybill_no,aliases FROM public.waybills
  ) x ON x.kind=m.entity_type AND x.id=m.entity_id
  WHERE x.no IS DISTINCT FROM m.new_no OR x.no !~ '^[A-Z0-9]{4}[0-9]{15}$' OR NOT COALESCE(m.old_no=ANY(x.aliases),false)
 ) THEN RAISE EXCEPTION 'Historical number/alias verification failed'; END IF;
 IF EXISTS(
  SELECT 1 FROM public.document_number_migration_20261028 m JOIN (
   SELECT 'forwarding' AS kind,id,to_jsonb(f) AS row_data FROM public.forwarding_orders f
   UNION ALL SELECT 'order',id,to_jsonb(o) FROM public.orders o
   UNION ALL SELECT 'waybill',id,to_jsonb(w) FROM public.waybills w
  ) x ON x.kind=m.entity_type AND x.id=m.entity_id
  WHERE (x.row_data - ARRAY['request_no','order_no','waybill_no','aliases','tracking_no','updated_at'])
    IS DISTINCT FROM (m.before_row - ARRAY['request_no','order_no','waybill_no','aliases','tracking_no','updated_at'])
 ) THEN RAISE EXCEPTION 'Unexpected business data change; rolling back'; END IF;
 IF EXISTS(SELECT id,shipment_id FROM number_migration_events EXCEPT SELECT id,shipment_id FROM public.tracking_events)
 OR EXISTS(SELECT id,shipment_id FROM public.tracking_events EXCEPT SELECT id,shipment_id FROM number_migration_events)
 THEN RAISE EXCEPTION 'Tracking event relationships changed'; END IF;
 IF EXISTS(SELECT 1 FROM number_migration_shipments b LEFT JOIN public.document_number_migration_20261028 m ON m.old_no=b.tracking_no LEFT JOIN public.shipments s ON s.id=b.id WHERE s.tracking_no IS DISTINCT FROM COALESCE(m.new_no,b.tracking_no))
 THEN RAISE EXCEPTION 'Shipment number mapping failed'; END IF;
END $$;
SELECT entity_type,count(*) AS migrated_count FROM public.document_number_migration_20261028 GROUP BY entity_type ORDER BY entity_type;
COMMIT;
