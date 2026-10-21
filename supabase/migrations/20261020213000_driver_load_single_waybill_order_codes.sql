-- A delivery unit can always be loaded with its own queue code. Additionally,
-- when an order contains exactly one waybill, accept either the parent order
-- number or domestic tracking number. Multi-waybill orders must still be
-- scanned one physical unit at a time to prevent loading the wrong parcel.
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
begin
  if not coalesce(public.has_role(_actor,'driver'),false) then
    raise exception '仅司机可以扫码上车';
  end if;
  select * into t from public.driver_trips where id=_trip and driver_id=_actor for update;
  if t.id is null then raise exception '上车清单不存在或不属于当前司机'; end if;

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

  select * into q from public.delivery_queue where id=qid for update;
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
  values('delivery_queue',q.id::text,'司机扫码上车',_actor,'上车序号 '||n||'（扫码 '||trim(_code)||'）',jsonb_build_object('trip_id',_trip,'sequence',n));
  return jsonb_build_object('sequence',n,'duplicate',false);
end $$;

revoke all on function public.driver_load_unit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.driver_load_unit(uuid,uuid,text) to service_role;
