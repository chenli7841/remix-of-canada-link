BEGIN;
-- Draft deliberately keeps this operational-only batch out of customer batch lists.
INSERT INTO public.batches(id,batch_no,display_name,shipping_method,planned_ship_date,status,notes)
VALUES('c5ec1a10-1111-4111-8111-000000000001','SPECIAL-HANDLING','特殊处理订单','sea','2026-11-11','draft','常驻处理批次；客户端暂隐藏。保留原费用付款记录，不使用普通批次结算。')
ON CONFLICT(id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.protect_special_handling_batch() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.id='c5ec1a10-1111-4111-8111-000000000001' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION '特殊处理订单是常驻批次，不能删除'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status OR NEW.batch_no IS DISTINCT FROM OLD.batch_no OR NEW.display_name IS DISTINCT FROM OLD.display_name THEN
   RAISE EXCEPTION '特殊处理订单暂仅后台使用，不可关闭、改名或启用普通批次状态';
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS protect_special_handling_batch ON public.batches;
CREATE TRIGGER protect_special_handling_batch BEFORE UPDATE OR DELETE ON public.batches FOR EACH ROW EXECUTE FUNCTION public.protect_special_handling_batch();

CREATE OR REPLACE FUNCTION public.transfer_receiving_special_units(_receiving_id uuid,_operator_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE bid uuid:='c5ec1a10-1111-4111-8111-000000000001'; r receivings%ROWTYPE; u jsonb; ids uuid[]; old_rows jsonb; n integer:=0; added integer:=0; affected integer; uid uuid; cc text; existing_id uuid;
BEGIN
 IF _operator_id IS NULL OR NOT is_staff(_operator_id) THEN RAISE EXCEPTION '没有操作权限'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(bid::text,0));
 SELECT * INTO r FROM receivings WHERE id=_receiving_id FOR UPDATE;
 IF NOT FOUND OR r.status<>'confirmed' THEN RAISE EXCEPTION '请先确认收货'; END IF;
 PERFORM 1 FROM batches WHERE id=bid FOR UPDATE;
 FOR u IN SELECT value FROM jsonb_array_elements(coalesce(r.included_units,'[]')) WHERE value->>'handling_status'='pending_special' LOOP
  IF u->>'kind' NOT IN ('waybill','carton','pallet') THEN RAISE EXCEPTION '未知单元'; END IF;
  SELECT coalesce(array_agg(id),'{}') INTO ids FROM logistics_unit_waybills(u->>'kind',(u->>'ref_id')::uuid);
  IF cardinality(ids)=0 THEN RAISE EXCEPTION '单元 % 内没有运单，请先核对',u->>'code'; END IF;
  PERFORM 1 FROM waybills WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
  SELECT jsonb_agg(to_jsonb(w)) INTO old_rows FROM waybills w WHERE id=ANY(ids);
  INSERT INTO admin_action_logs(entity_type,entity_id,action,operator_id,before,after,note)
  VALUES(u->>'kind',u->>'ref_id','transfer_special_handling',_operator_id,
    jsonb_build_object('unit',u,'waybills',old_rows,'carton',CASE WHEN u->>'kind'='carton' THEN (SELECT to_jsonb(c) FROM cartons c WHERE id=(u->>'ref_id')::uuid) END),
    jsonb_build_object('batch_id',bid,'receiving_id',r.id),'转入特殊处理订单，保留费用及付款记录');
  IF u->>'kind'='carton' THEN
   UPDATE cartons SET batch_id=bid,pallet_id=NULL WHERE id=(u->>'ref_id')::uuid;
  ELSIF u->>'kind'='pallet' THEN
   UPDATE pallets SET batch_id=bid WHERE id=(u->>'ref_id')::uuid;
   UPDATE cartons SET batch_id=bid WHERE pallet_id=(u->>'ref_id')::uuid;
  ELSE
   UPDATE waybills SET carton_id=NULL,pallet_id=NULL WHERE id=ANY(ids);
  END IF;
  UPDATE waybills SET assigned_batch_id=bid WHERE id=ANY(ids);
  -- Keep the carton as one delivery unit, regardless of its internal waybill count.
  uid:=NULL; cc:=NULL;
  IF u->>'kind'='carton' THEN SELECT customer_user_id,customer_code INTO uid,cc FROM cartons WHERE id=(u->>'ref_id')::uuid;
  ELSIF u->>'kind'='pallet' THEN SELECT customer_user_id,customer_code INTO uid,cc FROM pallets WHERE id=(u->>'ref_id')::uuid;
  END IF;
  IF uid IS NULL THEN
   IF (SELECT count(DISTINCT user_id) FROM waybills WHERE id=ANY(ids))<>1 THEN RAISE EXCEPTION '单元 % 涉及多个客户，不能作为单一派送单元',u->>'code'; END IF;
   SELECT user_id INTO uid FROM waybills WHERE id=ANY(ids) LIMIT 1;
  END IF;
  SELECT customer_code INTO cc FROM profiles WHERE id=uid;
  IF uid IS NULL OR cc IS NULL THEN RAISE EXCEPTION '单元 % 缺少客户资料',u->>'code'; END IF;
  SELECT id INTO existing_id FROM delivery_queue WHERE kind::text=u->>'kind' AND ref_id=(u->>'ref_id')::uuid AND status IN ('pending','dispatched') ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF existing_id IS NULL THEN
   INSERT INTO delivery_queue(kind,ref_id,code,customer_user_id,customer_code,source_receiving_id,source_batch_id,added_by,status)
   VALUES(u->>'kind',(u->>'ref_id')::uuid,u->>'code',uid,cc,r.id,bid,_operator_id,'pending')
   ON CONFLICT(kind,ref_id,status) DO NOTHING;
   GET DIAGNOSTICS affected=ROW_COUNT; added:=added+affected;
  ELSE
   UPDATE delivery_queue SET source_batch_id=bid WHERE id=existing_id;
  END IF;
  UPDATE receivings SET included_units=(SELECT jsonb_agg(CASE WHEN x->>'kind'=u->>'kind' AND x->>'ref_id'=u->>'ref_id' THEN x||jsonb_build_object('handling_status','special_ready','original_batch_id',x->'batch_id','batch_id',bid,'transferred_at',now()) ELSE x END) FROM jsonb_array_elements(included_units) x) WHERE id=r.id;
  n:=n+1;
 END LOOP;
 INSERT INTO admin_action_logs(entity_type,entity_id,action,operator_id,note,after)
 VALUES('batch',bid::text,'receive_special_units',_operator_id,'收货特殊处理单元转入并补齐待派送',jsonb_build_object('receiving_id',r.id,'units',n,'queue_added',added));
 RETURN jsonb_build_object('batch_id',bid,'units',n,'queue_added',added);
END $$;
REVOKE ALL ON FUNCTION public.transfer_receiving_special_units(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_receiving_special_units(uuid,uuid) TO service_role;
COMMIT;
