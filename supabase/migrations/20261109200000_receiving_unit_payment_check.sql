BEGIN;
CREATE OR REPLACE FUNCTION public.merge_receiving_unit_checked(_receiving_id uuid,_kind text,_ref_id uuid,_operator_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r receivings%ROWTYPE; ws uuid[]; paid_count integer; total_count integer; completed_count integer; info jsonb;
BEGIN
 IF _operator_id IS NULL OR NOT is_staff(_operator_id) THEN RAISE EXCEPTION '没有收货操作权限'; END IF;
 SELECT * INTO r FROM receivings WHERE id=_receiving_id FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('open','matched') THEN RAISE EXCEPTION '收货单不存在或已确认'; END IF;
 SELECT coalesce(array_agg(w.id),'{}') INTO ws FROM waybills w WHERE
 (_kind='waybill' AND w.id=_ref_id) OR (_kind='carton' AND w.carton_id=_ref_id) OR
 (_kind='pallet' AND (w.pallet_id=_ref_id OR w.carton_id IN (SELECT id FROM cartons WHERE pallet_id=_ref_id)));
 PERFORM 1 FROM waybills WHERE id=ANY(ws) FOR UPDATE;
 SELECT count(*),count(*) FILTER(WHERE payment_status='paid'),count(*) FILTER(WHERE status::text IN ('delivered','completed'))
 INTO total_count,paid_count,completed_count FROM waybills WHERE id=ANY(ws);
 info:=jsonb_build_object('payment_checked_at',now(),'paid_count',paid_count,'waybill_count',total_count,'completed_count',completed_count,
 'handling_status',CASE WHEN total_count>0 AND paid_count=total_count THEN 'paid_status_only' ELSE 'pending_special' END);
 PERFORM scan_receiving_hierarchy(r.id,_kind,_ref_id,_operator_id,false,true);
 UPDATE receivings SET included_units=(SELECT jsonb_agg(CASE WHEN u->>'kind'=_kind AND u->>'ref_id'=_ref_id::text THEN u||info ELSE u END) FROM jsonb_array_elements(included_units) u) WHERE id=r.id;
 INSERT INTO admin_action_logs(entity_type,entity_id,action,operator_id,note,after)
 VALUES('receiving',r.id::text,'merge_unit_payment_checked',_operator_id,'重新收货保留原付款记录；未付款标记待特殊处理',info||jsonb_build_object('kind',_kind,'ref_id',_ref_id));
 RETURN info;
END $$;
REVOKE ALL ON FUNCTION public.merge_receiving_unit_checked(uuid,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.merge_receiving_unit_checked(uuid,text,uuid,uuid) TO service_role;
COMMIT;
