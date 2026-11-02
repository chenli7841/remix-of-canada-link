-- Narrow repair from verified scan/dispatch logs. Never use migration time as
-- the time of historical packing or shipping.
begin;
set local lock_timeout = '5s';
do $$
declare w waybills%rowtype; packed admin_action_logs%rowtype; shipped admin_action_logs%rowtype;
begin
 select * into w from waybills where id='a5c6e169-5c08-43b7-8791-b52810b4b57b' for update;
 if not found then raise exception 'Repair waybill missing'; end if;
 select * into packed from admin_action_logs where id='31203a56-5676-4778-acf8-b5784625c8e4'
   and action='scan_add_waybill' and after->>'waybill_id'=w.id::text;
 select * into shipped from admin_action_logs where id='79ca700c-56a8-4749-bd20-6df04f256b09'
   and entity_type='batch' and entity_id='5ec4c6bf-cc94-46da-87a1-08741a2398af' and after->>'status'='shipped';
 if packed.id is null or shipped.id is null or packed.created_at>shipped.created_at then
   raise exception 'Missing chronological repair evidence'; end if;
 if not exists(select 1 from logistics_unit_waybills('batch',shipped.entity_id::uuid) x where x.id=w.id) then
   raise exception 'Waybill batch membership changed'; end if;
 perform set_config('app.logistics_evidence_backfill','on',true);
 update waybills set status='shipped' where id=w.id and status::text in ('pending','procurement','received','storage','packed');
 perform set_config('app.logistics_evidence_backfill','',true);
 perform append_waybill_logistics_event(w.id,'已装箱','Packed',packed.created_at,'repair-log:'||packed.id);
 perform append_waybill_logistics_event(w.id,'已发货','Shipped',shipped.created_at,'repair-log:'||shipped.id);
 perform recompute_parent_status(w.order_id,w.forwarding_id);
 if not exists(select 1 from admin_action_logs where entity_type='waybill' and entity_id=w.id::text and action='repair_logistics_20261102') then
   insert into admin_action_logs(entity_type,entity_id,action,note,before,after)
   values('waybill',w.id::text,'repair_logistics_20261102','按原始装箱及批次发货日志补齐轨迹',
     jsonb_build_object('status',w.status),jsonb_build_object('packing_log',packed.id,'shipping_log',shipped.id));
 end if;
end $$;
commit;
