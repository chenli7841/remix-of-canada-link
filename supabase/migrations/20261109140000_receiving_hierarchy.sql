ALTER TABLE public.receivings ADD COLUMN IF NOT EXISTS included_units jsonb NOT NULL DEFAULT '[]'::jsonb;
-- All hierarchy changes share the receipt lock with final confirmation.
CREATE OR REPLACE FUNCTION public.scan_receiving_hierarchy(_receiving_id uuid,_kind text,_ref_id uuid,_operator_id uuid,_remove boolean DEFAULT false,_include boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r receivings%ROWTYPE; ws uuid[]; cs uuid[]; ps uuid[]; n integer; root_code text; root_batch uuid;
BEGIN
 IF _operator_id IS NULL OR NOT is_staff(_operator_id) THEN RAISE EXCEPTION '没有收货操作权限'; END IF;
 SELECT * INTO r FROM receivings WHERE id=_receiving_id FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('open','matched') THEN RAISE EXCEPTION '收货单不存在或已确认'; END IF;
 IF _kind NOT IN ('waybill','carton','pallet') THEN RAISE EXCEPTION '不支持的收货类型'; END IF;
 IF _kind='waybill' THEN
 SELECT waybill_no INTO root_code FROM waybills WHERE id=_ref_id;
 ELSIF _kind='carton' THEN SELECT carton_no INTO root_code FROM cartons WHERE id=_ref_id;
 ELSE SELECT pallet_no INTO root_code FROM pallets WHERE id=_ref_id;
 END IF;
 IF root_code IS NULL THEN RAISE EXCEPTION '收货项目不存在或缺少编号'; END IF;
 SELECT coalesce(array_agg(c.id),'{}') INTO cs FROM cartons c WHERE (_kind='carton' AND c.id=_ref_id) OR (_kind='pallet' AND c.pallet_id=_ref_id);
 SELECT coalesce(array_agg(w.id),'{}') INTO ws FROM waybills w WHERE (_kind='waybill' AND w.id=_ref_id) OR w.carton_id=ANY(cs) OR (_kind='pallet' AND w.pallet_id=_ref_id);
 IF _include THEN
   IF NOT EXISTS(SELECT 1 FROM receiving_scans WHERE receiving_id=r.id AND kind=_kind AND ref_id=_ref_id) THEN RAISE EXCEPTION '请先扫描待合并项目'; END IF;
   IF _kind='pallet' THEN SELECT batch_id INTO root_batch FROM pallets WHERE id=_ref_id;
   ELSIF _kind='carton' THEN SELECT coalesce(c.batch_id,p.batch_id) INTO root_batch FROM cartons c LEFT JOIN pallets p ON p.id=c.pallet_id WHERE c.id=_ref_id;
   ELSE SELECT coalesce(w.assigned_batch_id,c.batch_id,p.batch_id) INTO root_batch FROM waybills w LEFT JOIN cartons c ON c.id=w.carton_id LEFT JOIN pallets p ON p.id=coalesce(w.pallet_id,c.pallet_id) WHERE w.id=_ref_id;
   END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.included_units) u WHERE u->>'kind'=_kind AND u->>'ref_id'=_ref_id::text) THEN
     r.included_units:=r.included_units || jsonb_build_array(jsonb_build_object('kind',_kind,'ref_id',_ref_id,'code',root_code,'batch_id',root_batch));
     UPDATE receivings SET included_units=r.included_units WHERE id=r.id;
   END IF;
 END IF;
 -- Restrict roots to selected batch contents, including inherited membership.
 IF NOT (
 EXISTS(SELECT 1 FROM jsonb_array_elements(r.included_units) u WHERE
   (u->>'kind'=_kind AND u->>'ref_id'=_ref_id::text)
   OR (_kind='carton' AND u->>'kind'='pallet' AND EXISTS(SELECT 1 FROM cartons WHERE id=_ref_id AND pallet_id::text=u->>'ref_id'))
   OR (_kind='waybill' AND EXISTS(SELECT 1 FROM waybills w LEFT JOIN cartons c ON c.id=w.carton_id WHERE w.id=_ref_id AND ((u->>'kind'='carton' AND w.carton_id::text=u->>'ref_id') OR (u->>'kind'='pallet' AND (w.pallet_id::text=u->>'ref_id' OR c.pallet_id::text=u->>'ref_id')))))
) OR (_kind='pallet' AND EXISTS(SELECT 1 FROM pallets WHERE id=_ref_id AND batch_id=ANY(r.batch_ids))) OR
 (_kind='carton' AND EXISTS(SELECT 1 FROM cartons c LEFT JOIN pallets p ON p.id=c.pallet_id WHERE c.id=_ref_id AND (c.batch_id=ANY(r.batch_ids) OR p.batch_id=ANY(r.batch_ids)))) OR
 (_kind='waybill' AND EXISTS(SELECT 1 FROM waybills w LEFT JOIN cartons c ON c.id=w.carton_id LEFT JOIN pallets p ON p.id=coalesce(w.pallet_id,c.pallet_id) WHERE w.id=_ref_id AND (w.assigned_batch_id=ANY(r.batch_ids) OR c.batch_id=ANY(r.batch_ids) OR p.batch_id=ANY(r.batch_ids))))
 ) THEN
   IF _remove THEN
     DELETE FROM receiving_scans WHERE receiving_id=r.id AND kind=_kind AND ref_id=_ref_id;
     INSERT INTO admin_action_logs(entity_type,entity_id,action,operator_id,note,after)
     VALUES('receiving',r.id::text,'dismiss_unmatched',_operator_id,'踢出未匹配收货项目 '||root_code,jsonb_build_object('kind',_kind,'ref_id',_ref_id));
     RETURN jsonb_build_object('ok',true);
   END IF;
   RAISE EXCEPTION '该项目不属于匹配批次，请先添加对应批次';
 END IF;
 IF _remove THEN
 UPDATE receivings SET included_units=coalesce((SELECT jsonb_agg(u) FROM jsonb_array_elements(r.included_units) u WHERE NOT (u->>'kind'=_kind AND u->>'ref_id'=_ref_id::text)),'[]'::jsonb) WHERE id=r.id;
 DELETE FROM receiving_scans WHERE receiving_id=r.id AND ((kind='waybill' AND ref_id=ANY(ws)) OR (kind='carton' AND ref_id=ANY(cs)) OR (kind=_kind AND ref_id=_ref_id));
 ELSE
 INSERT INTO receiving_scans(receiving_id,kind,ref_id,code,operator_id,scanned_at)
 SELECT r.id,x.kind,x.id,x.code,_operator_id,now() FROM (
 SELECT 'waybill' AS kind,id,waybill_no AS code FROM waybills WHERE id=ANY(ws)
 UNION SELECT 'carton',id,carton_no FROM cartons WHERE id=ANY(cs)
 UNION SELECT 'pallet',id,pallet_no FROM pallets WHERE _kind='pallet' AND id=_ref_id
 ) x ON CONFLICT(receiving_id,kind,ref_id) DO NOTHING;
 END IF;
 -- Include ancestor cartons, then reconcile them before pallets.
 SELECT coalesce(array_agg(DISTINCT id),'{}') INTO cs FROM cartons WHERE id=ANY(cs) OR id IN (SELECT carton_id FROM waybills WHERE id=ANY(ws));
 IF _remove THEN
 DELETE FROM receiving_scans WHERE receiving_id=r.id AND kind='carton' AND ref_id=ANY(cs);
 ELSE
 INSERT INTO receiving_scans(receiving_id,kind,ref_id,code,operator_id,scanned_at)
 SELECT r.id,'carton',c.id,c.carton_no,_operator_id,now() FROM cartons c WHERE c.id=ANY(cs)
 AND EXISTS(SELECT 1 FROM waybills w WHERE w.carton_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM waybills w WHERE w.carton_id=c.id AND NOT EXISTS(SELECT 1 FROM receiving_scans s WHERE s.receiving_id=r.id AND s.kind='waybill' AND s.ref_id=w.id))
 ON CONFLICT(receiving_id,kind,ref_id) DO NOTHING;
 END IF;
 SELECT coalesce(array_agg(DISTINCT id),'{}') INTO ps FROM pallets WHERE (_kind='pallet' AND id=_ref_id) OR id IN (SELECT pallet_id FROM cartons WHERE id=ANY(cs)) OR id IN (SELECT pallet_id FROM waybills WHERE id=ANY(ws));
 IF _remove THEN
 DELETE FROM receiving_scans WHERE receiving_id=r.id AND kind='pallet' AND ref_id=ANY(ps);
 ELSE
 INSERT INTO receiving_scans(receiving_id,kind,ref_id,code,operator_id,scanned_at)
 SELECT r.id,'pallet',p.id,p.pallet_no,_operator_id,now() FROM pallets p WHERE p.id=ANY(ps)
 AND (EXISTS(SELECT 1 FROM cartons WHERE pallet_id=p.id) OR EXISTS(SELECT 1 FROM waybills WHERE pallet_id=p.id))
 AND NOT EXISTS(SELECT 1 FROM cartons c WHERE c.pallet_id=p.id AND NOT EXISTS(SELECT 1 FROM receiving_scans s WHERE s.receiving_id=r.id AND s.kind='carton' AND s.ref_id=c.id))
 AND NOT EXISTS(SELECT 1 FROM waybills w WHERE w.pallet_id=p.id AND NOT EXISTS(SELECT 1 FROM receiving_scans s WHERE s.receiving_id=r.id AND s.kind='waybill' AND s.ref_id=w.id))
 ON CONFLICT(receiving_id,kind,ref_id) DO NOTHING;
 END IF;
 INSERT INTO admin_action_logs(entity_type,entity_id,action,operator_id,note,after)
 VALUES('receiving',r.id::text,CASE WHEN _remove THEN 'remove_hierarchy' ELSE 'confirm_hierarchy' END,_operator_id,
 CASE WHEN _remove THEN '撤销分级确认 ' ELSE '分级确认 ' END || root_code,jsonb_build_object('kind',_kind,'ref_id',_ref_id,'included',_include,'waybill_count',cardinality(ws),'carton_count',cardinality(cs)));
 RETURN jsonb_build_object('ok',true,'waybills',cardinality(ws),'cartons',cardinality(cs));
END $$;
REVOKE ALL ON FUNCTION public.scan_receiving_hierarchy(uuid,text,uuid,uuid,boolean,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.scan_receiving_hierarchy(uuid,text,uuid,uuid,boolean,boolean) TO service_role;

DO $$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.confirm_receiving_multi_atomic(uuid,uuid,uuid[],uuid,text)'::regprocedure) INTO definition;
 IF position('receiving_included_unit' in definition)=0 THEN
 definition:=replace(definition,
 'w.assigned_batch_id=ANY(batch_ids) OR c.batch_id=ANY(batch_ids) OR p.batch_id=ANY(batch_ids)',
 'w.assigned_batch_id=ANY(batch_ids) OR c.batch_id=ANY(batch_ids) OR p.batch_id=ANY(batch_ids) OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.included_units) receiving_included_unit WHERE (receiving_included_unit->>''kind''=''waybill'' AND receiving_included_unit->>''ref_id''=w.id::text) OR (receiving_included_unit->>''kind''=''carton'' AND receiving_included_unit->>''ref_id''=w.carton_id::text) OR (receiving_included_unit->>''kind''=''pallet'' AND (receiving_included_unit->>''ref_id''=w.pallet_id::text OR receiving_included_unit->>''ref_id''=c.pallet_id::text)))');
 EXECUTE definition;
 END IF;
END $$;
