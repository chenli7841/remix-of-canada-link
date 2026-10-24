-- Run against a test database or in the SQL editor. All parcel changes are rolled back.
begin;
savepoint transfer_test;
do $$
declare src record; dest record; r jsonb; original_seq integer; before_dest integer;
begin
 select i.*,q.code,t.driver_id into src from driver_trip_items i join driver_trips t on t.id=i.trip_id join delivery_queue q on q.id=i.queue_id where q.status='pending' and t.loading_trip_id is null and (select count(*) from delivery_queue d where upper(trim(d.code))=upper(trim(q.code)) and d.status='pending')=1 order by i.id limit 1;
 if src.id is null then raise exception 'No test source'; end if;
 select * into dest from driver_trips where id<>src.trip_id and loading_trip_id is null and public.has_role(driver_id,'driver') order by id limit 1;
 if dest.id is null then raise exception 'No test destination'; end if;
 select coalesce(max(sequence),0)+1 into before_dest from driver_trip_items where trip_id=dest.id;
 r:=public.driver_load_unit(dest.driver_id,dest.id,src.code);
 if not (r->>'transferred')::boolean or (r->>'sequence')::integer<>before_dest then raise exception 'Transfer result invalid'; end if;
 if not exists(select 1 from driver_trip_items where queue_id=src.queue_id and trip_id=dest.id and sequence=before_dest) then raise exception 'Target missing'; end if;
 if exists(select 1 from driver_trip_items where queue_id=src.queue_id and trip_id=src.trip_id) then raise exception 'Source retains parcel'; end if;
 if exists(select 1 from driver_trips where loading_trip_id=src.trip_id and (src.queue_id=any(delivery_unit_ids) or route::text like '%'||src.queue_id::text||'%')) then raise exception 'Old route retains parcel'; end if;
 r:=public.driver_load_unit(dest.driver_id,dest.id,src.code);
 if not (r->>'duplicate')::boolean or (r->>'sequence')::integer<>before_dest then raise exception 'Repeated scan changed sequence'; end if;
 select code into src.code from delivery_queue q where status='dispatched' and not exists(select 1 from delivery_queue x where upper(trim(x.code))=upper(trim(q.code)) and x.status='pending') limit 1;
 if src.code is null then raise exception 'No delivered test parcel'; end if;
 begin
  perform public.driver_load_unit(src.driver_id,src.trip_id,src.code);
  raise exception using errcode='ZX001',message='Delivered parcel was moved';
 exception when sqlstate 'ZX001' then raise; when others then null;
 end;
end $$;
rollback to transfer_test;
rollback;
select 'PASS: transfer, sequence, old route removal, repeated scan, delivered rejection; test data rolled back' as result;
