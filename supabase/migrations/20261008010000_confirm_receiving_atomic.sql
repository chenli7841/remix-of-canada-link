-- Confirm only scanned waybills, including those nested in cartons/pallets.
-- Service-only entry point: the server checks return reminders before this call.
CREATE OR REPLACE FUNCTION public.confirm_receiving_atomic(_receiving_id uuid, _batch_id uuid, _operator_id uuid, _location text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
 r public.receivings%ROWTYPE;
 b public.batches%ROWTYPE;
 ids uuid[];
 changed uuid[];
 fids uuid[];
 oids uuid[];
 actor text;
 loc text;
 n_orders integer := 0;
 n_forwardings integer := 0;
 previous_bulk text := current_setting('app.bulk_waybill_insert',true);
BEGIN
 IF _operator_id IS NULL OR NOT public.is_staff(_operator_id) THEN RAISE EXCEPTION '没有收货操作权限'; END IF;
 SELECT * INTO r FROM public.receivings WHERE id=_receiving_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION '收货单不存在'; END IF;
 IF r.batch_id IS NULL OR r.batch_id IS DISTINCT FROM _batch_id THEN RAISE EXCEPTION '匹配批次已变化，请刷新后重试'; END IF;
 IF r.status IN ('confirmed','closed') THEN
   RETURN jsonb_build_object('ok',true,'already_confirmed',true,'waybills_updated',0,'orders_updated',0);
 END IF;
 SELECT * INTO b FROM public.batches WHERE id=r.batch_id FOR UPDATE;
 IF b.status::text='closed' THEN RAISE EXCEPTION '匹配批次已关闭，不能退回到件状态'; END IF;
 SELECT coalesce(nullif(full_name,''),email,'工作人员') INTO actor FROM public.profiles WHERE id=_operator_id;
 loc := coalesce(nullif(btrim(_location),''),r.warehouse_code,'目的地仓库');
 -- Scanning an outer carton/pallet does not confirm its contents: the UI asks
 -- for secondary scans. Match-all explicitly creates these waybill scan rows.
 SELECT coalesce(array_agg(w.id),ARRAY[]::uuid[]) INTO ids
 FROM public.waybills w
 LEFT JOIN public.cartons c ON c.id=w.carton_id
 LEFT JOIN public.pallets p ON p.id=coalesce(w.pallet_id,c.pallet_id)
 WHERE EXISTS(SELECT 1 FROM public.receiving_scans s WHERE s.receiving_id=r.id AND s.kind='waybill' AND s.ref_id=w.id)
 AND (w.assigned_batch_id=r.batch_id OR c.batch_id=r.batch_id OR p.batch_id=r.batch_id);
 IF cardinality(ids)=0 THEN RAISE EXCEPTION '没有已扫描确认的批次运单，请先确认内部明细或使用一键匹配'; END IF;
 PERFORM id FROM public.waybills WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 -- Existing in_transit means local delivery in this system; do not regress it.
 SELECT coalesce(array_agg(id),ARRAY[]::uuid[]),array_agg(DISTINCT forwarding_id),array_agg(DISTINCT order_id)
 INTO changed,fids,oids FROM public.waybills WHERE id=ANY(ids) AND status::text NOT IN ('arrived','delivered','cancelled','in_transit','ready_pickup');
 PERFORM id FROM public.forwarding_orders WHERE id=ANY(fids) ORDER BY id FOR UPDATE;
 PERFORM id FROM public.orders WHERE id=ANY(oids) ORDER BY id FOR UPDATE;
 INSERT INTO public.admin_action_logs(entity_type,entity_id,action,operator_id,operator_name,note,before,after)
 SELECT 'waybill',id::text,'update_status',_operator_id,actor,'收货确认：运单已到件；收货单 '||r.receiving_no,
 jsonb_build_object('status',status),jsonb_build_object('status','arrived','receiving_id',r.id,'batch_id',b.id) FROM public.waybills WHERE id=ANY(changed);
 PERFORM set_config('app.bulk_waybill_insert','on',true);
 UPDATE public.waybills SET status='arrived' WHERE id=ANY(changed);
 -- Only complete parents whose remaining parcels have all arrived or advanced.
 WITH eligible AS (
 SELECT f.id,f.status FROM public.forwarding_orders f WHERE f.id=ANY(fids)
 AND f.status NOT IN ('arrived','delivered','cancelled','in_transit','ready_pickup')
 AND NOT EXISTS(SELECT 1 FROM public.waybills w WHERE w.forwarding_id=f.id AND w.status::text NOT IN ('arrived','delivered','cancelled','in_transit','ready_pickup'))
 ), updated AS (UPDATE public.forwarding_orders f SET status='arrived' FROM eligible e WHERE f.id=e.id RETURNING f.id,e.status)
 INSERT INTO public.admin_action_logs(entity_type,entity_id,action,operator_id,operator_name,note,before,after)
 SELECT 'forwarding',id::text,'update_status',_operator_id,actor,'收货确认：集运订单已到件；收货单 '||r.receiving_no,jsonb_build_object('status',status),jsonb_build_object('status','arrived','receiving_id',r.id) FROM updated;
 GET DIAGNOSTICS n_forwardings=ROW_COUNT;
 WITH eligible AS (
 SELECT o.id,o.status FROM public.orders o WHERE o.id=ANY(oids)
 AND o.status::text NOT IN ('arrived','delivered','cancelled','in_transit','ready_pickup')
 AND NOT EXISTS(SELECT 1 FROM public.waybills w WHERE w.order_id=o.id AND w.status::text NOT IN ('arrived','delivered','cancelled','in_transit','ready_pickup'))
 ), updated AS (UPDATE public.orders o SET status='arrived' FROM eligible e WHERE o.id=e.id RETURNING o.id,e.status)
 INSERT INTO public.admin_action_logs(entity_type,entity_id,action,operator_id,operator_name,note,before,after)
 SELECT 'order',id::text,'update_status',_operator_id,actor,'收货确认：订单已到件；收货单 '||r.receiving_no,jsonb_build_object('status',status),jsonb_build_object('status','arrived','receiving_id',r.id) FROM updated;
 GET DIAGNOSTICS n_orders=ROW_COUNT;
 PERFORM set_config('app.bulk_waybill_insert',coalesce(previous_bulk,''),true);
 INSERT INTO public.shipments(tracking_no,status)
 SELECT waybill_no,'created' FROM public.waybills WHERE id=ANY(changed) ON CONFLICT(tracking_no) DO NOTHING;
 INSERT INTO public.tracking_events(shipment_id,status_zh,status_en,location_zh,location_en,event_time,source,source_ref)
 SELECT s.id,'已到件','Arrived at destination warehouse',loc,loc,now(),'admin_action','receiving:'||r.id
 FROM public.waybills w JOIN public.shipments s ON s.tracking_no=w.waybill_no WHERE w.id=ANY(changed);
 UPDATE public.batches SET status='arrived' WHERE id=b.id AND status::text<>'arrived';
 IF b.status::text<>'arrived' THEN
 INSERT INTO public.admin_action_logs(entity_type,entity_id,action,operator_id,operator_name,note,before,after)
 VALUES('batch',b.id::text,'update_status',_operator_id,actor,'收货确认：匹配批次已到件；收货单 '||r.receiving_no,jsonb_build_object('status',b.status),jsonb_build_object('status','arrived','receiving_id',r.id));
 END IF;
 UPDATE public.receivings SET status='confirmed',confirmed_at=now() WHERE id=r.id;
 INSERT INTO public.admin_action_logs(entity_type,entity_id,action,operator_id,operator_name,note,before,after)
 VALUES('receiving',r.id::text,'confirm',_operator_id,actor,'确认到件：批次 '||b.batch_no||'；更新运单 '||cardinality(changed)||' 张，订单 '||(n_orders+n_forwardings)||' 张',jsonb_build_object('status',r.status),jsonb_build_object('status','confirmed','batch_id',b.id,'waybills_updated',cardinality(changed),'orders_updated',n_orders+n_forwardings));
 RETURN jsonb_build_object('ok',true,'waybills_updated',cardinality(changed),'orders_updated',n_orders+n_forwardings);
END;
$$;
REVOKE ALL ON FUNCTION public.confirm_receiving_atomic(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_receiving_atomic(uuid,uuid,uuid,text) TO service_role;
