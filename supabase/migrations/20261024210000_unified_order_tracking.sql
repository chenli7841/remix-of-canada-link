begin;
create table if not exists public.order_tracking_snapshots (
 kind text not null check(kind in ('order','forwarding')), parent_id uuid not null,
 primary_waybill_id uuid, events jsonb not null default '[]', updated_at timestamptz not null default now(),
 primary key(kind,parent_id)
);
alter table public.order_tracking_snapshots enable row level security;
revoke all on public.order_tracking_snapshots from public,anon,authenticated;
grant all on public.order_tracking_snapshots to service_role;

create or replace function public.order_tracking_view(_kind text,_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare p jsonb; w record; ev jsonb; children jsonb:='[]'; creation jsonb; primary_id uuid; order_no text;
begin
 if _kind='order' then select to_jsonb(o) into p from orders o where id=_id;
 elsif _kind='forwarding' then select to_jsonb(f) into p from forwarding_orders f where id=_id;
 else return null; end if;
 if p is null then return null; end if;
 order_no:=coalesce(p->>'order_no',p->>'request_no');
 creation:=jsonb_build_object('status_zh','订单已生成','status_en','Order created','event_time',p->>'created_at','source','admin_action','source_ref',order_no,'location_zh',p->>'warehouse','location_en',p->>'warehouse');
 select primary_waybill_id into primary_id from order_tracking_snapshots where kind=_kind and parent_id=_id;
 for w in select * from waybills where (_kind='order' and order_id=_id) or (_kind='forwarding' and forwarding_id=_id)
 order by (id=primary_id) desc nulls last,created_at,id loop
  select coalesce(jsonb_agg(e.obj order by e.event_time,e.id),'[]') into ev from (
   select distinct on (t.status_zh,coalesce(t.location_zh,''),date_trunc('minute',t.event_time))
    t.id,t.event_time,jsonb_build_object('id',t.id,'status_zh',t.status_zh,'status_en',t.status_en,'location_zh',t.location_zh,'location_en',t.location_en,'event_time',t.event_time,'source',t.source,'source_ref',t.source_ref) obj
   from tracking_events t join shipments s on s.id=t.shipment_id where s.tracking_no=w.waybill_no
   and t.status_zh not in ('订单已生成','订单已创建') and lower(coalesce(t.status_en,'')) not in ('order created','shipment created')
   order by t.status_zh,coalesce(t.location_zh,''),date_trunc('minute',t.event_time),t.event_time,t.id
  ) e;
  children:=children||jsonb_build_array(jsonb_build_object('id',w.id,'waybill_no',w.waybill_no,'status',w.status,'events',jsonb_build_array(creation)||ev));
 end loop;
 return jsonb_build_object('order_no',order_no,'tracking_no',order_no,'kind',_kind,'shipping_method',p->>'shipping_method','status',coalesce(children->0->>'status',p->>'status'),'created_at',p->>'created_at','waybills',children,'events',coalesce(children->0->'events',jsonb_build_array(creation)));
end $$;
revoke all on function public.order_tracking_view(text,uuid) from public,anon,authenticated;
grant execute on function public.order_tracking_view(text,uuid) to service_role;

create or replace function public.refresh_order_tracking(_kind text,_id uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
 if _id is null then return; end if;
 -- A parent lock serializes first-waybill selection and concurrent event updates.
 if _kind='order' then perform id from orders where id=_id for update;
 else perform id from forwarding_orders where id=_id for update; end if;
 v:=order_tracking_view(_kind,_id);
 if v is null then return; end if;
 insert into order_tracking_snapshots(kind,parent_id,primary_waybill_id,events)
 values(_kind,_id,(v->'waybills'->0->>'id')::uuid,v->'events')
 on conflict(kind,parent_id) do update set primary_waybill_id=excluded.primary_waybill_id,events=excluded.events,updated_at=now();
end $$;
revoke all on function public.refresh_order_tracking(text,uuid) from public,anon,authenticated;
grant execute on function public.refresh_order_tracking(text,uuid) to service_role;

create or replace function public.sync_order_tracking_snapshot() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare w record; sid uuid;
begin
 if tg_table_name='tracking_events' then
  sid:=case when tg_op='DELETE' then old.shipment_id else new.shipment_id end;
  for w in select wb.order_id,wb.forwarding_id from waybills wb join shipments s on s.tracking_no=wb.waybill_no where s.id=sid loop
   perform refresh_order_tracking('order',w.order_id); perform refresh_order_tracking('forwarding',w.forwarding_id);
  end loop;
 elsif tg_table_name='waybills' then
  if tg_op<>'INSERT' then perform refresh_order_tracking('order',old.order_id);perform refresh_order_tracking('forwarding',old.forwarding_id);end if;
  if tg_op<>'DELETE' then perform refresh_order_tracking('order',new.order_id);perform refresh_order_tracking('forwarding',new.forwarding_id);end if;
 else
  perform refresh_order_tracking(case when tg_table_name='orders' then 'order' else 'forwarding' end,new.id);
 end if;
 return null;
end $$;
create trigger unified_tracking_event_snapshot after insert or update or delete on tracking_events for each row execute function sync_order_tracking_snapshot();
create trigger unified_tracking_waybill_snapshot after insert or update of order_id,forwarding_id,waybill_no or delete on waybills for each row execute function sync_order_tracking_snapshot();
create trigger unified_tracking_order_created after insert on orders for each row execute function sync_order_tracking_snapshot();
create trigger unified_tracking_forwarding_created after insert on forwarding_orders for each row execute function sync_order_tracking_snapshot();

create or replace function public.track_order_by_any_no(_input text) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare n text:=upper(trim(coalesce(_input,''))); candidates jsonb; hit jsonb;
begin
 if length(n)<3 or length(n)>200 then return null; end if;
 with parents as (
  select 'order' kind,o.id,to_jsonb(o) p from orders o union all select 'forwarding',f.id,to_jsonb(f) from forwarding_orders f
 ), matches as (
  select distinct p.kind,p.id from parents p where exists (
   select 1 from unnest(array[p.p->>'order_no',p.p->>'request_no',p.p->>'domestic_tracking_no',p.p->>'intl_tracking_no',p.p->>'tracking_no']) x where upper(trim(x))=n
  ) or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(p.p->'aliases')='array' then p.p->'aliases' else '[]'::jsonb end) a where upper(trim(a))=n)
  or exists(select 1 from waybills w where ((p.kind='order' and w.order_id=p.id) or (p.kind='forwarding' and w.forwarding_id=p.id))
    and (upper(w.waybill_no)=n or upper(w.intl_tracking_no)=n or n=any(w.aliases)))
 ) select jsonb_agg(jsonb_build_object('kind',kind,'id',id)) into candidates from matches;
 if candidates is null then return null; end if;
 if jsonb_array_length(candidates)>1 then raise exception '该单号关联多个订单，请使用完整订单号查询'; end if;
 hit:=candidates->0;return order_tracking_view(hit->>'kind',(hit->>'id')::uuid);
end $$;
revoke all on function public.track_order_by_any_no(text) from public;
grant execute on function public.track_order_by_any_no(text) to anon,authenticated,service_role;

-- Every actual waybill state transition writes a public event in the same transaction.
create or replace function public.record_waybill_state_tracking() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare sid uuid; zh text; en text;
begin
 if new.status is not distinct from old.status then return new; end if;
 zh:=case new.status::text when 'procurement' then '代采购' when 'pending' then '已发货等待入库' when 'received' then '已到达集运仓' when 'storage' then '仓储中' when 'packed' then '已打包' when 'shipped' then '已发出' when 'arrived' then '清关中' when 'in_transit' then '正在派送' when 'ready_pickup' then '待取货' when 'delivered' then '已完成' when 'cancelled' then '已取消' else null end;
 en:=case new.status::text when 'procurement' then 'Procurement' when 'pending' then 'Awaiting warehouse receipt' when 'received' then 'Received at warehouse' when 'storage' then 'In storage' when 'packed' then 'Packed' when 'shipped' then 'Shipped' when 'arrived' then 'Customs clearance' when 'in_transit' then 'Out for delivery' when 'ready_pickup' then 'Ready for pickup' when 'delivered' then 'Delivered' when 'cancelled' then 'Cancelled' else null end;
 if zh is null then return new; end if;
 insert into shipments(tracking_no,status) values(new.waybill_no,new.status::text) on conflict(tracking_no) do update set status=excluded.status returning id into sid;
 insert into tracking_events(shipment_id,status_zh,status_en,event_time,source,source_ref) values(sid,zh,en,now(),'admin_action',new.waybill_no);
 return new;
end $$;
create trigger unified_waybill_state_event after update of status on waybills for each row execute function record_waybill_state_tracking();

-- Persist the earliest existing waybill once; never invent historical transport timestamps.
do $$ declare p record;begin
 for p in select 'order' kind,id from orders union all select 'forwarding',id from forwarding_orders loop
  perform refresh_order_tracking(p.kind,p.id);
 end loop;
end $$;
commit;
