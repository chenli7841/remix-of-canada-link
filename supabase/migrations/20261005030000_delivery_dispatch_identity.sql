begin;
set local lock_timeout = '5s';
alter table public.delivery_queue add column if not exists dispatched_by uuid references auth.users(id), add column if not exists dispatched_by_name text, add column if not exists delivery_photo_urls jsonb not null default '[]'::jsonb;
alter table public.waybills add column if not exists dispatched_by uuid references auth.users(id), add column if not exists dispatched_by_name text, add column if not exists dispatched_at timestamptz;
create or replace function public.record_delivery_dispatch() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare actor uuid; actor_name text; wb record; sid uuid;
begin
  if old.status = 'dispatched' then
    new.dispatched_by := old.dispatched_by; new.dispatched_by_name := old.dispatched_by_name; new.dispatched_at := old.dispatched_at;
    return new;
  end if;
  if new.status <> 'dispatched' then return new; end if;
  if old.status <> 'pending' then raise exception '只能确认待派送的记录'; end if;
  actor := coalesce(auth.uid(), new.dispatched_by);
  -- Keep the previous deployed server compatible until the new UI/server is published.
  -- It does not pass an actor; never invent a driver for these legacy writes.
  if actor is null then return new; end if;
  if not coalesce(public.is_staff(actor), false) then raise exception '派送确认需要有效的工作人员账号'; end if;
  select coalesce(nullif(trim(full_name), ''), '工作人员') into actor_name from public.profiles where id = actor;
  actor_name := coalesce(actor_name, '工作人员');
  new.dispatched_by := actor; new.dispatched_by_name := actor_name; new.dispatched_at := now();
  for wb in
    select w.id, w.waybill_no from public.waybills w left join public.cartons c on c.id = w.carton_id
    where ((new.kind = 'waybill' and w.id = new.ref_id) or (new.kind = 'carton' and w.carton_id = new.ref_id)
      or (new.kind = 'pallet' and (w.pallet_id = new.ref_id or c.pallet_id = new.ref_id)))
      and w.status not in ('delivered', 'cancelled')
    order by w.id for update of w
  loop
    -- Overlapping box/pallet selections in the same operation do not duplicate tracks.
    if exists(select 1 from public.waybills where id=wb.id and dispatched_at = new.dispatched_at and dispatched_by = actor) then continue; end if;
    update public.waybills set status='in_transit', dispatched_by=actor, dispatched_by_name=actor_name, dispatched_at=new.dispatched_at where id=wb.id;
    insert into public.shipments(tracking_no,status) values(wb.waybill_no,'in_transit') on conflict(tracking_no) do update set status='in_transit' returning id into sid;
    insert into public.tracking_events(shipment_id,status_zh,status_en,event_time,source,source_ref)
      values(sid,'正在派送 · 派送人员：' || actor_name,'Out for delivery',new.dispatched_at,'admin_action','delivery_queue:' || new.id::text);
    insert into public.admin_action_logs(entity_type,entity_id,action,operator_id,operator_name,note,after)
      values('waybill',wb.id,'delivery_queue.dispatched',actor,actor_name,'确认派送 · 派送人员：' || actor_name,
        jsonb_build_object('dispatched_by_name',actor_name,'dispatched_at',new.dispatched_at,'status','in_transit'));
  end loop;
  insert into public.admin_action_logs(entity_type,entity_id,action,operator_id,operator_name,note,after)
    values('delivery_queue',new.id,'delivery_queue.dispatched',actor,actor_name,'确认派送 · 派送人员：' || actor_name,
      jsonb_build_object('dispatched_by_name',actor_name,'dispatched_at',new.dispatched_at,'code',new.code));
  return new;
end;
$$;
drop trigger if exists delivery_dispatch_identity on public.delivery_queue;
create trigger delivery_dispatch_identity before update on public.delivery_queue for each row execute function public.record_delivery_dispatch();
commit;
