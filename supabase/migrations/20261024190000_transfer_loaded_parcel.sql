begin;
-- Preserve route structure while removing one physical delivery unit and empty stops.
create or replace function public.driver_route_without_unit(_route jsonb,_id uuid) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare p jsonb; s jsonb; c jsonb; g jsonb; plans jsonb:='[]'; stops jsonb; customers jsonb; groups jsonb; ids jsonb;
begin
 if _route is null then return null; end if;
 for p in select value from jsonb_array_elements(coalesce(_route->'plans','[]')) loop
  stops:='[]';
  for s in select value from jsonb_array_elements(coalesce(p->'stops','[]')) loop
   customers:='[]';
   for c in select value from jsonb_array_elements(coalesce(s->'customers','[]')) loop
    select coalesce(jsonb_agg(value),'[]') into ids from jsonb_array_elements(coalesce(c->'ids','[]')) where value<>to_jsonb(_id::text);
    if jsonb_array_length(ids)=0 then continue; end if;
    groups:='[]';
    for g in select value from jsonb_array_elements(coalesce(c->'groups','[]')) loop
     if g ? 'ids' then
      g:=jsonb_set(g,'{ids}',(select coalesce(jsonb_agg(value),'[]') from jsonb_array_elements(g->'ids') where value<>to_jsonb(_id::text)));
      if jsonb_array_length(g->'ids')=0 then continue; end if;
     end if;
     groups:=groups||jsonb_build_array(g);
    end loop;
    customers:=customers||jsonb_build_array(c||jsonb_build_object('ids',ids,'groups',groups));
   end loop;
   if jsonb_array_length(customers)>0 then stops:=stops||jsonb_build_array(s||jsonb_build_object('customers',customers)); end if;
  end loop;
  if jsonb_array_length(stops)>0 then plans:=plans||jsonb_build_array(p||jsonb_build_object('stops',stops)); end if;
 end loop;
 return _route||jsonb_build_object('plans',plans);
end $$;
revoke all on function public.driver_route_without_unit(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.driver_route_without_unit(jsonb,uuid) to service_role;
create or replace function public.driver_load_unit(_actor uuid,_trip uuid,_code text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
  t public.driver_trips;
  q public.delivery_queue;
  prior public.driver_trip_items;
  n integer;
  matches integer;
  multi boolean := false;
  c text := upper(trim(_code));
  qid uuid;
  old_trip uuid;
begin
  if not coalesce(public.has_role(_actor,'driver'),false) then
    raise exception '仅司机可以扫码上车';
  end if;
  -- Serialize scans; parent trip locks also coordinate dispatch and route generation.
  perform pg_advisory_xact_lock(hashtextextended('driver_load_unit',0));
  select * into t from public.driver_trips where id=_trip and driver_id=_actor;
  if t.id is null then raise exception '上车清单不存在或不属于当前司机'; end if;

  if t.loading_trip_id is not null then raise exception '请在上车趟扫码'; end if;

  -- First preserve the normal carton / waybill / pallet code path.
  select count(*), min(id::text)::uuid into matches, qid
    from public.delivery_queue
   where upper(trim(code))=c and status='pending';

  if matches=0 then
    create temp table if not exists _driver_load_parent_matches(
      waybill_id uuid,
      parent_key text
    ) on commit drop;
    truncate _driver_load_parent_matches;

    insert into _driver_load_parent_matches(waybill_id,parent_key)
      select w.id, 'f:'||f.id::text
        from public.forwarding_orders f
        join public.waybills w on w.forwarding_id=f.id
       where upper(trim(coalesce(f.request_no,'')))=c
          or upper(trim(coalesce(f.domestic_tracking_no,'')))=c
      union
      select w.id, 'o:'||o.id::text
        from public.orders o
        join public.waybills w on w.order_id=o.id
       where upper(trim(coalesce(o.order_no,'')))=c
          or upper(trim(coalesce(o.domestic_tracking_no,'')))=c;

    select exists(
      select 1 from _driver_load_parent_matches
       group by parent_key having count(distinct waybill_id)>1
    ) into multi;

    if multi then
      raise exception '该订单有多个运单，请逐个扫描运单号或箱号';
    end if;

    select count(distinct dq.id), min(dq.id::text)::uuid into matches, qid
      from _driver_load_parent_matches s
      join public.delivery_queue dq
        on dq.kind='waybill'
       and dq.ref_id=s.waybill_id::text
       and dq.status='pending';
  end if;

  if coalesce(matches,0)<>1 then
    raise exception '未找到唯一待派送单位，请核对箱号、运单号、订单号或国内单号';
  end if;

  select trip_id into old_trip from public.driver_trip_items where queue_id=qid;
  perform id from public.driver_trips where id=_trip or id=old_trip order by id for update;
  if not exists(select 1 from public.driver_trips where id=_trip and driver_id=_actor and loading_trip_id is null) then
    raise exception '上车趟已变化，请刷新重试';
  end if;
  select * into q from public.delivery_queue where id=qid for update;
  if q.status is distinct from 'pending' then raise exception '该包裹已派送或已取消，不能转移上车'; end if;
  if q.customer_code is null or trim(q.customer_code)='' then raise exception '该派送单位缺少客户号'; end if;
  select * into prior from public.driver_trip_items where queue_id=q.id;
  if prior.id is not null and prior.trip_id=_trip then
    return jsonb_build_object('sequence',prior.sequence,'duplicate',true,'transferred',false);
  end if;
  select coalesce(max(sequence),0)+1 into n from public.driver_trip_items where trip_id=_trip;
  if prior.id is not null then
    -- Remove only this parcel from old routes; preserve other parcels and their loading numbers.
    update public.driver_trips
      set delivery_unit_ids=array_remove(delivery_unit_ids,q.id),
          route=public.driver_route_without_unit(route,q.id),revision=revision+1
      where loading_trip_id=prior.trip_id and q.id=any(delivery_unit_ids);
    update public.driver_trips set route=public.driver_route_without_unit(route,q.id),revision=revision+1 where id=prior.trip_id;
    update public.driver_trip_items set trip_id=_trip,sequence=n,created_at=now() where id=prior.id;
  else
    insert into public.driver_trip_items(trip_id,queue_id,sequence) values(_trip,q.id,n);
  end if;
  update public.driver_trips set revision=revision+1 where id=_trip;
  insert into public.admin_action_logs(entity_type,entity_id,action,operator_id,note,after)
  values('delivery_queue',q.id::text,'司机扫码上车',_actor,'上车序号 '||n||'（扫码 '||trim(_code)||'）',jsonb_build_object('trip_id',_trip,'sequence',n,'from_trip_id',prior.trip_id,'from_sequence',prior.sequence));
  return jsonb_build_object('sequence',n,'duplicate',false,'transferred',prior.id is not null,'from_trip_id',prior.trip_id,'from_sequence',prior.sequence);
end $$;

revoke all on function public.driver_load_unit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.driver_load_unit(uuid,uuid,text) to service_role;

commit;
