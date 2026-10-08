begin;
set local lock_timeout = '5s';

-- Both events are saved atomically. The second business event is timestamped
-- 30 seconds later; no browser timer or delayed network request is required.
create or replace function public.write_delivery_completion_events(
  entity text, entity_id_value uuid, tracking text, actor uuid, actor_name text,
  dispatched_time timestamptz, queue_id uuid
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare sid uuid; step integer; event_time_value timestamptz; label text;
begin
  if nullif(trim(tracking),'') is not null then
    insert into public.shipments(tracking_no,status) values(tracking,'delivered')
      on conflict(tracking_no) do update set status='delivered' returning id into sid;
  end if;
  for step in 0..1 loop
    event_time_value := dispatched_time + step * interval '30 seconds';
    label := case when step=0 then '已派送' else '已完成' end;
    insert into public.admin_action_logs(entity_type,entity_id,action,operator_id,operator_name,note,after,created_at)
    values(entity,entity_id_value::text,case when step=0 then 'delivery_queue.dispatched' else 'delivery_queue.completed' end,
      actor,actor_name,label || ' · 派送人员：' || actor_name,
      jsonb_build_object('status',case when step=0 then 'dispatched' else 'delivered' end,
        'dispatched_by_name',actor_name,'dispatched_at',dispatched_time),event_time_value);
    if sid is not null then
      insert into public.tracking_events(shipment_id,status_zh,status_en,event_time,source,source_ref)
      values(sid,label,case when step=0 then 'Dispatched' else 'Completed' end,event_time_value,
        'admin_action','delivery_queue:' || queue_id::text);
    end if;
  end loop;
end;
$$;
revoke all on function public.write_delivery_completion_events(text,uuid,text,uuid,text,timestamptz,uuid) from public,anon,authenticated;

create or replace function public.record_delivery_dispatch() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid; actor_name text; wb record; parent record;
  ids uuid[]; fids uuid[]; oids uuid[];
  previous_bulk text := current_setting('app.bulk_waybill_insert',true);
begin
  if old.status='dispatched' then
    new.dispatched_by:=old.dispatched_by; new.dispatched_by_name:=old.dispatched_by_name; new.dispatched_at:=old.dispatched_at;
    return new;
  end if;
  if new.status<>'dispatched' then return new; end if;
  if old.status<>'pending' then raise exception '只能确认待派送的记录'; end if;
  actor:=coalesce(auth.uid(),new.dispatched_by);
  if actor is null or not coalesce(public.is_staff(actor),false) then
    raise exception '派送确认需要有效的工作人员账号';
  end if;
  select coalesce(nullif(trim(full_name),''),'工作人员') into actor_name from public.profiles where id=actor;
  actor_name:=coalesce(actor_name,'工作人员');
  new.dispatched_by:=actor; new.dispatched_by_name:=actor_name; new.dispatched_at:=now();
  select coalesce(array_agg(w.id),array[]::uuid[]),array_agg(distinct w.forwarding_id),array_agg(distinct w.order_id)
    into ids,fids,oids
    from public.waybills w left join public.cartons c on c.id=w.carton_id
    where (new.kind='waybill' and w.id=new.ref_id) or (new.kind='carton' and w.carton_id=new.ref_id)
      or (new.kind='pallet' and (w.pallet_id=new.ref_id or c.pallet_id=new.ref_id));
  -- Serialize completion of siblings, including siblings in different batches.
  perform id from public.forwarding_orders where id=any(fids) order by id for update;
  perform id from public.orders where id=any(oids) order by id for update;
  perform set_config('app.bulk_waybill_insert','on',true);
  for wb in select id,waybill_no from public.waybills where id=any(ids)
    and status::text not in ('delivered','cancelled') order by id for update
  loop
    update public.waybills set status='delivered',dispatched_by=actor,dispatched_by_name=actor_name,
      dispatched_at=new.dispatched_at where id=wb.id;
    perform public.write_delivery_completion_events('waybill',wb.id,wb.waybill_no,actor,actor_name,new.dispatched_at,new.id);
  end loop;
  -- A parent with parcels still awaiting delivery must remain open.
  for parent in select f.id,f.request_no from public.forwarding_orders f where f.id=any(fids)
    and f.status not in ('delivered','cancelled')
    and exists(select 1 from public.waybills w where w.forwarding_id=f.id and w.status::text='delivered')
    and not exists(select 1 from public.waybills w where w.forwarding_id=f.id and w.status::text not in ('delivered','cancelled'))
  loop
    update public.forwarding_orders set status='delivered' where id=parent.id;
    perform public.write_delivery_completion_events('forwarding',parent.id,parent.request_no,actor,actor_name,new.dispatched_at,new.id);
  end loop;
  for parent in select o.id,o.order_no from public.orders o where o.id=any(oids)
    and o.status::text not in ('delivered','cancelled')
    and exists(select 1 from public.waybills w where w.order_id=o.id and w.status::text='delivered')
    and not exists(select 1 from public.waybills w where w.order_id=o.id and w.status::text not in ('delivered','cancelled'))
  loop
    update public.orders set status='delivered' where id=parent.id;
    perform public.write_delivery_completion_events('order',parent.id,parent.order_no,actor,actor_name,new.dispatched_at,new.id);
  end loop;
  perform set_config('app.bulk_waybill_insert',coalesce(previous_bulk,''),true);
  perform public.write_delivery_completion_events('delivery_queue',new.id,null,actor,actor_name,new.dispatched_at,new.id);
  return new;
end;
$$;
commit;
