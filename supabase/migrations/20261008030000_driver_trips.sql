begin;
create table public.driver_trips (
 id uuid primary key default gen_random_uuid(), driver_id uuid not null references auth.users(id),
 driver_name text not null, created_at timestamptz not null default now(),
 revision integer not null default 0, route_revision integer, route jsonb, generated_at timestamptz
);
create table public.driver_trip_items (
 id uuid primary key default gen_random_uuid(), trip_id uuid not null references public.driver_trips(id),
 queue_id uuid not null unique references public.delivery_queue(id), sequence integer not null check(sequence>0),
 created_at timestamptz not null default now(), unique(trip_id,sequence)
);
alter table public.driver_trips enable row level security;
alter table public.driver_trip_items enable row level security;
revoke all on public.driver_trips,public.driver_trip_items from anon,authenticated;
grant all on public.driver_trips,public.driver_trip_items to service_role;
create index on public.driver_trips(driver_id,created_at);

create or replace function public.driver_load_unit(_actor uuid,_trip uuid,_code text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.driver_trips; q public.delivery_queue; prior public.driver_trip_items; n integer; matches integer;
begin
 if not coalesce(public.has_role(_actor,'driver'),false) then raise exception '仅司机可以扫码上车'; end if;
 select * into t from public.driver_trips where id=_trip and driver_id=_actor for update;
 if t.id is null then raise exception '上车清单不存在或不属于当前司机'; end if;
 select count(*) into matches from public.delivery_queue where code=trim(_code) and status='pending';
 if matches<>1 then raise exception '未找到唯一待派送单位，请核对箱号、运单号或托盘号'; end if;
 select * into q from public.delivery_queue where code=trim(_code) and status='pending' for update;
 if q.customer_code is null or trim(q.customer_code)='' then raise exception '该派送单位缺少客户号'; end if;
 select * into prior from public.driver_trip_items where queue_id=q.id;
 if prior.id is not null then
   if prior.trip_id<>_trip then raise exception '该包裹已加入另一趟上车清单，请勿重复装车'; end if;
   return jsonb_build_object('sequence',prior.sequence,'duplicate',true);
 end if;
 select coalesce(max(sequence),0)+1 into n from public.driver_trip_items where trip_id=_trip;
 insert into public.driver_trip_items(trip_id,queue_id,sequence) values(_trip,q.id,n);
 update public.driver_trips set revision=revision+1 where id=_trip;
 insert into public.admin_action_logs(entity_type,entity_id,action,operator_id,note,after)
 values('delivery_queue',q.id::text,'司机扫码上车',_actor,'上车序号 '||n,jsonb_build_object('trip_id',_trip,'sequence',n));
 return jsonb_build_object('sequence',n,'duplicate',false);
end $$;
create or replace function public.driver_dispatch_units(_actor uuid,_trip uuid,_ids uuid[]) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.driver_trips; n integer;
begin
 if not coalesce(public.has_role(_actor,'driver'),false) then raise exception '仅司机可以确认派送'; end if;
 select * into t from public.driver_trips where id=_trip and driver_id=_actor for update;
 if t.id is null then raise exception '派送清单不存在或不属于当前司机'; end if;
 if cardinality(_ids) is null or cardinality(_ids)=0 then raise exception '请勾选派送单位'; end if;
 select count(*) into n from public.driver_trip_items where trip_id=_trip and queue_id=any(_ids);
 if n<>(select count(distinct x) from unnest(_ids) x) then raise exception '所选包裹不属于此趟'; end if;
 perform id from public.delivery_queue where id=any(_ids) order by id for update;
 if exists(select 1 from public.delivery_queue where id=any(_ids) and status not in ('pending','dispatched')) then raise exception '包裹状态已变化，请刷新'; end if;
 update public.delivery_queue set status='dispatched',dispatched_by=_actor where id=any(_ids) and status='pending';
end $$;
revoke all on function public.driver_load_unit(uuid,uuid,text),public.driver_dispatch_units(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.driver_load_unit(uuid,uuid,text),public.driver_dispatch_units(uuid,uuid,uuid[]) to service_role;
commit;
