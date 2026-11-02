begin;
set local lock_timeout = '5s';

-- One source for direct waybills, cartons, and cartons nested in pallets.
create or replace function public.logistics_unit_waybills(_kind text, _id uuid)
returns setof public.waybills language sql stable security definer
set search_path=public,pg_temp as $$
 select w.* from waybills w left join cartons c on c.id=w.carton_id
 left join pallets p on p.id=coalesce(c.pallet_id,w.pallet_id)
 where (_kind='waybill' and w.id=_id)
 or (_kind='carton' and w.carton_id=_id)
 or (_kind='pallet' and coalesce(c.pallet_id,w.pallet_id)=_id)
 or (_kind='batch' and (
   (w.carton_id is null and w.pallet_id is null and w.assigned_batch_id=_id)
   or c.batch_id=_id or p.batch_id=_id));
$$;
revoke all on function public.logistics_unit_waybills(text,uuid) from public,anon,authenticated;
grant execute on function public.logistics_unit_waybills(text,uuid) to service_role;

-- Row lock makes retries idempotent without a broad uniqueness constraint on
-- legitimate repeated tracking notes.
create or replace function public.append_waybill_logistics_event(
 _waybill_id uuid,_zh text,_en text,_at timestamptz,_ref text,_location text default null
) returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare w waybills%rowtype; sid uuid;
begin
 select * into w from waybills where id=_waybill_id for update;
 if not found or _at is null then return; end if;
 insert into shipments(tracking_no,status) values(w.waybill_no,w.status::text)
 on conflict(tracking_no) do update set status=excluded.status returning id into sid;
 if not exists(select 1 from tracking_events where shipment_id=sid and source_ref=_ref and status_zh=_zh) then
   insert into tracking_events(shipment_id,status_zh,status_en,location_zh,event_time,source,source_ref)
   values(sid,_zh,_en,_location,_at,'admin_action',_ref);
 end if;
end $$;
revoke all on function public.append_waybill_logistics_event(uuid,text,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.append_waybill_logistics_event(uuid,text,text,timestamptz,text,text) to service_role;

create or replace function public.record_waybill_state_tracking() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare zh text; en text;
begin
 if new.status is not distinct from old.status then return new; end if;
 if current_setting('app.logistics_evidence_backfill',true)='on' then return new; end if;
 -- These atomic workflows write their more specific operation events themselves.
 if current_setting('app.bulk_waybill_insert',true)='on' and new.status::text in ('arrived','delivered') then return new; end if;
 zh:=case new.status::text when 'procurement' then '代采购' when 'pending' then '已发货等待入库' when 'received' then '已到达集运仓' when 'storage' then '仓储中' when 'packed' then '已装箱' when 'shipped' then '已发货' when 'arrived' then '已到货' when 'in_transit' then '正在派送' when 'ready_pickup' then '待取货' when 'delivered' then '已派送' when 'cancelled' then '已取消' end;
 en:=case new.status::text when 'packed' then 'Packed' when 'shipped' then 'Shipped' when 'arrived' then 'Arrived' when 'delivered' then 'Delivered' else new.status::text end;
 if zh is not null then
   perform append_waybill_logistics_event(new.id,zh,en,now(),'waybill-state:'||new.id||':'||txid_current());
 end if;
 return new;
end $$;

-- Container and child state changes are committed or rolled back together.
create or replace function public.sync_container_logistics() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare w record; kind text;
begin
 if new.status is not distinct from old.status or new.status::text not in ('shipped','arrived') then return new; end if;
 -- A receiving document confirms only scanned parcels, not the entire batch.
 if tg_table_name='batches' and current_setting('app.confirming_receiving',true)='on' then return new; end if;
 kind:=case tg_table_name when 'batches' then 'batch' when 'cartons' then 'carton' else 'pallet' end;
 for w in select * from logistics_unit_waybills(kind,new.id) order by id loop
   if w.status::text in ('pending','procurement','received','storage','packed')
     or (new.status::text='arrived' and w.status::text='shipped') then
     if new.status::text='shipped' then
       update waybills set status='shipped' where id=w.id and status::text in ('pending','procurement','received','storage','packed');
     else
       update waybills set status='arrived' where id=w.id and status::text in ('pending','procurement','received','storage','packed','shipped');
     end if;
   end if;
 end loop;
 return new;
end $$;
create trigger batch_logistics_children after update of status on batches for each row execute function sync_container_logistics();
create trigger pallet_logistics_children after update of status on pallets for each row execute function sync_container_logistics();
create trigger carton_logistics_children after update of status on cartons for each row execute function sync_container_logistics();

create or replace function public.track_delivery_preparation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare w record;
begin
 if new.status::text<>'pending' then return new; end if;
 if tg_op='UPDATE' then
   if old.status is not distinct from new.status then return new; end if;
 end if;
 for w in select * from logistics_unit_waybills(new.kind::text,new.ref_id) order by id loop
   if w.status::text not in ('delivered','cancelled') then
     perform append_waybill_logistics_event(w.id,'准备派送','Preparing for delivery',now(),'delivery-ready:'||new.id);
   end if;
 end loop;
 return new;
end $$;
create trigger delivery_preparation_tracking after insert or update of status on delivery_queue for each row execute function track_delivery_preparation();

-- Correct only events created by the old automatic mapping; preserve genuine
-- customs clearance events entered by staff or imported from a carrier.
update tracking_events e set status_zh='已到货',status_en='Arrived'
from shipments s where s.id=e.shipment_id and e.status_zh='清关中'
 and e.source='admin_action' and e.source_ref=s.tracking_no;

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
 previous_receiving text := current_setting('app.confirming_receiving',true);
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
 -- Record arrival only for parcels advanced by this receipt; already-arrived
 -- parcels still receive the distinct confirmation event below.
 PERFORM public.append_waybill_logistics_event(w.id,'已到货','Arrived',now(),'receiving-arrival:'||r.id,loc)
 FROM public.waybills w WHERE w.id=ANY(changed);
 INSERT INTO public.shipments(tracking_no,status)
 SELECT waybill_no,'created' FROM public.waybills WHERE id=ANY(ids) ON CONFLICT(tracking_no) DO NOTHING;
 INSERT INTO public.tracking_events(shipment_id,status_zh,status_en,location_zh,location_en,event_time,source,source_ref)
 SELECT s.id,'确认到货','Receipt confirmed at destination warehouse',loc,loc,now(),'admin_action','receiving:'||r.id
 FROM public.waybills w JOIN public.shipments s ON s.tracking_no=w.waybill_no WHERE w.id=ANY(ids) AND w.status::text<>'cancelled';
 PERFORM set_config('app.confirming_receiving','on',true);
 UPDATE public.batches SET status='arrived' WHERE id=b.id AND status::text<>'arrived';
 PERFORM set_config('app.confirming_receiving',coalesce(previous_receiving,''),true);
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

create or replace function public.add_delivery_unit_tracking(_queue_id uuid,_zh text,_location text default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare q delivery_queue%rowtype; w record; ref text;
begin
 if nullif(btrim(_zh),'') is null then raise exception '请填写物流状态'; end if;
 select * into q from delivery_queue where id=_queue_id for update;
 if not found then raise exception '派送记录不存在'; end if;
 ref:='delivery-note:'||q.id||':'||gen_random_uuid();
 for w in select * from logistics_unit_waybills(q.kind::text,q.ref_id) order by id loop
   perform append_waybill_logistics_event(w.id,btrim(_zh),btrim(_zh),now(),ref,_location);
 end loop;
 if not found then raise exception '派送单元内没有运单，未保存轨迹'; end if;
end $$;
revoke all on function public.add_delivery_unit_tracking(uuid,text,text) from public,anon,authenticated;
grant execute on function public.add_delivery_unit_tracking(uuid,text,text) to service_role;

commit;
