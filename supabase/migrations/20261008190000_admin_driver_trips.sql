begin;
alter table public.driver_trips add column source text not null default 'scan' check(source in ('scan','admin'));
alter table public.driver_trips add column created_by uuid references auth.users(id);
alter table public.driver_trips add column origin_id uuid;
alter table public.driver_trip_items alter column sequence drop not null;

create or replace function public.admin_assign_delivery_trip(_actor uuid,_id uuid,_driver uuid,_origin uuid,_ids uuid[],_route jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.driver_trips; driver_name_value text; n integer;
begin
 if not coalesce(public.is_staff(_actor),false) then raise exception '没有分配司机派送趟的权限'; end if;
 perform pg_advisory_xact_lock(hashtextextended(_id::text,0));
 select * into t from public.driver_trips where id=_id;
 if t.id is not null then
   if t.created_by is distinct from _actor or t.driver_id<>_driver or t.origin_id is distinct from _origin then raise exception '该生成请求已使用'; end if;
   return t.id;
 end if;
 if not coalesce(public.has_role(_driver,'driver'),false) then raise exception '所选人员没有司机权限'; end if;
 select full_name into driver_name_value from public.profiles where id=_driver;
 if not found then raise exception '司机不存在'; end if;
 if not exists(select 1 from public.app_settings where key='driver-origin:'||_origin::text and value->>'active'='true' and length(trim(value->>'address'))>0) then raise exception '起始点未启用'; end if;
 n := (select count(distinct x) from unnest(_ids) x);
 if n<1 or n>10000 then raise exception '请选择派送单位'; end if;
 perform id from public.delivery_queue where id=any(_ids) order by id for update;
 if (select count(*) from public.delivery_queue where id=any(_ids) and status='pending' and nullif(trim(customer_code),'') is not null)<>n then raise exception '部分派送单位状态已变化，请刷新'; end if;
 if exists(select 1 from public.driver_trip_items where queue_id=any(_ids)) then raise exception '部分包裹已分配到其他趟，请取消这些批次的勾选后重试'; end if;
 insert into public.driver_trips(id,driver_id,driver_name,source,created_by,origin_id,revision,route_revision,route,generated_at)
 values(_id,_driver,coalesce(nullif(driver_name_value,''),'司机'),'admin',_actor,_origin,1,1,_route,now());
 insert into public.driver_trip_items(trip_id,queue_id,sequence) select _id,x,null from (select distinct unnest(_ids) x) q;
 insert into public.admin_action_logs(entity_type,entity_id,action,operator_id,note,after)
 values('driver_trip',_id::text,'生成司机派送趟',_actor,'后台勾选分配，无上车序号',jsonb_build_object('driver_id',_driver,'origin_id',_origin,'units',n));
 return _id;
end $$;
revoke all on function public.admin_assign_delivery_trip(uuid,uuid,uuid,uuid,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.admin_assign_delivery_trip(uuid,uuid,uuid,uuid,uuid[],jsonb) to service_role;
commit;
