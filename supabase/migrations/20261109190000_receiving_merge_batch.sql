BEGIN;
CREATE OR REPLACE FUNCTION public.merge_receiving_batch(_receiving_id uuid,_kind text,_ref_id uuid,_batch_id uuid,_operator_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r receivings%ROWTYPE; actual_batch uuid; n integer;
BEGIN
 IF _operator_id IS NULL OR NOT is_staff(_operator_id) THEN RAISE EXCEPTION '没有收货操作权限'; END IF;
 SELECT * INTO r FROM receivings WHERE id=_receiving_id FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('open','matched') THEN RAISE EXCEPTION '收货单不存在或已确认'; END IF;
 IF NOT EXISTS(SELECT 1 FROM receiving_scans WHERE receiving_id=r.id AND kind=_kind AND ref_id=_ref_id) THEN RAISE EXCEPTION '扫描记录不存在'; END IF;
 IF _kind='waybill' THEN
 SELECT coalesce(w.assigned_batch_id,c.batch_id,p.batch_id) INTO actual_batch FROM waybills w LEFT JOIN cartons c ON c.id=w.carton_id LEFT JOIN pallets p ON p.id=coalesce(w.pallet_id,c.pallet_id) WHERE w.id=_ref_id;
 ELSIF _kind='carton' THEN
 SELECT coalesce(c.batch_id,p.batch_id) INTO actual_batch FROM cartons c LEFT JOIN pallets p ON p.id=c.pallet_id WHERE c.id=_ref_id;
 ELSIF _kind='pallet' THEN SELECT batch_id INTO actual_batch FROM pallets WHERE id=_ref_id;
 END IF;
 IF actual_batch IS NULL OR actual_batch IS DISTINCT FROM _batch_id THEN RAISE EXCEPTION '所属批次已变化或尚未分配，请刷新后重试'; END IF;
 PERFORM set_receiving_batches(r.id,ARRAY[actual_batch],_operator_id,true);
 WITH ps AS (SELECT id,pallet_no FROM pallets WHERE batch_id=actual_batch),
 cs AS (SELECT id,carton_no FROM cartons WHERE batch_id=actual_batch OR pallet_id IN (SELECT id FROM ps)),
 ws AS (SELECT id,waybill_no FROM waybills WHERE assigned_batch_id=actual_batch OR carton_id IN (SELECT id FROM cs) OR pallet_id IN (SELECT id FROM ps))
 INSERT INTO receiving_scans(receiving_id,kind,ref_id,code,operator_id,scanned_at)
 SELECT r.id,x.kind,x.id,x.code,_operator_id,now() FROM (
 SELECT 'pallet' kind,id,pallet_no code FROM ps UNION ALL SELECT 'carton',id,carton_no FROM cs UNION ALL SELECT 'waybill',id,waybill_no FROM ws
 ) x ON CONFLICT(receiving_id,kind,ref_id) DO NOTHING;
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO admin_action_logs(entity_type,entity_id,action,operator_id,note,after)
 VALUES('receiving',r.id::text,'merge_batch',_operator_id,'整批次合并并匹配到货',jsonb_build_object('batch_id',actual_batch,'new_scans',n));
 RETURN jsonb_build_object('ok',true,'new_scans',n);
END $$;
REVOKE ALL ON FUNCTION public.merge_receiving_batch(uuid,text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.merge_receiving_batch(uuid,text,uuid,uuid,uuid) TO service_role;
COMMIT;
