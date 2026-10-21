begin;
alter table public.driver_trips add column if not exists loading_trip_id uuid references public.driver_trips(id);
alter table public.driver_trips add column if not exists delivery_unit_ids uuid[];
create index if not exists driver_trips_loading_trip on public.driver_trips(loading_trip_id);
create or replace function public.create_driver_delivery_run(_actor uuid,_id uuid,_loading uuid,_ids uuid[],_route jsonb,_revision integer)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.driver_trips; existing public.driver_trips; n integer;
begin
 select * into t from public.driver_trips where id=_loading for update;
 if t.id is null or t.loading_trip_id is not null then raise exception '上车趟不存在'; end if;
 if t.driver_id<>_actor and not exists(select 1 from public.user_roles where user_id=_actor and role in ('owner','manager','warehouse_cn','warehouse_ca')) then raise exception '无权操作此上车趟'; end if;
 select * into existing from public.driver_trips where id=_id;
 if existing.id is not null then
  if existing.loading_trip_id=_loading and existing.delivery_unit_ids @> _ids and existing.delivery_unit_ids <@ _ids then return _id; end if;
  raise exception '生成请求已使用';
 end if;
 if t.revision<>_revision then raise exception '上车清单已变化，请刷新重试'; end if;
 if coalesce(cardinality(_ids),0)=0 then raise exception '请勾选包裹'; end if;
 perform 1 from public.delivery_queue where id=any(_ids) order by id for update;
 select count(*) into n from public.driver_trip_items i join public.delivery_queue q on q.id=i.queue_id where i.trip_id=_loading and q.id=any(_ids) and q.status='pending';
 if n<>cardinality(_ids) then raise exception '部分包裹不属于此上车趟或已派送，请刷新'; end if;
 if exists(select 1 from public.driver_trips r where r.loading_trip_id=_loading and r.delivery_unit_ids && _ids) then raise exception '部分包裹已生成派送趟，请勿重复生成'; end if;
 insert into public.driver_trips(id,driver_id,driver_name,created_by,loading_trip_id,delivery_unit_ids,route,revision,route_revision,generated_at)
 values(_id,t.driver_id,t.driver_name,_actor,_loading,_ids,_route,0,0,now());
 insert into public.admin_action_logs(entity_type,entity_id,action,operator_id,after) values('driver_trip',_id::text,'从上车趟生成派送趟',_actor,jsonb_build_object('loading_trip_id',_loading,'queue_ids',_ids));
 return _id;
end $$;
revoke all on function public.create_driver_delivery_run(uuid,uuid,uuid,uuid[],jsonb,integer) from public,anon,authenticated;
grant execute on function public.create_driver_delivery_run(uuid,uuid,uuid,uuid[],jsonb,integer) to service_role;
commit;

