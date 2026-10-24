-- Run after the migration; all test mutations are rolled back.
begin;

do $$
declare f record; w record; result jsonb; by_wb jsonb; cached jsonb; sid uuid; first_id uuid; events_before int;
begin
 select fo.* into f from forwarding_orders fo where (select count(*) from waybills where forwarding_id=fo.id)>1 order by fo.created_at limit 1;
 if f.id is null then raise exception 'No multi-waybill test fixture'; end if;
 result:=track_order_by_any_no(f.request_no);
 first_id:=(result->'waybills'->0->>'id')::uuid;
 if first_id is null then raise exception 'Missing waybills'; end if;
 for w in select * from waybills where forwarding_id=f.id loop
  by_wb:=track_order_by_any_no(w.waybill_no);
  if by_wb->>'order_no'<>f.request_no then raise exception 'Wrong parent';end if;
  if by_wb->'waybills'->0->>'id'<>first_id::text then raise exception 'Unstable first waybill';end if;
 end loop;
 if result->'events'->0->>'status_zh'<>'订单已生成' then raise exception 'Missing order creation';end if;
 if (result->'events'->0->>'event_time')::timestamptz<>f.created_at then raise exception 'Wrong creation time';end if;
 if (select count(*) from jsonb_array_elements(result->'events') x where x->>'status_zh'='订单已生成')<>1 then raise exception 'Duplicate creation';end if;
 select events into cached from order_tracking_snapshots where kind='forwarding' and parent_id=f.id;
 if cached<>result->'events' then raise exception 'Snapshot mismatch';end if;
 select * into w from waybills where id=first_id;
 insert into shipments(tracking_no) values(w.waybill_no) on conflict(tracking_no) do update set tracking_no=excluded.tracking_no returning id into sid;
 insert into tracking_events(shipment_id,status_zh,status_en,event_time,source) values(sid,'统一轨迹测试','Unified tracking test',now(),'admin_action');
 select events into cached from order_tracking_snapshots where kind='forwarding' and parent_id=f.id;
 if not exists(select 1 from jsonb_array_elements(cached) x where x->>'status_zh'='统一轨迹测试') then raise exception 'Event was not synchronized';end if;
 update waybills set status=case when status='storage' then 'packed'::waybill_status else 'storage'::waybill_status end where id=w.id;
 if not exists(select 1 from tracking_events where shipment_id=sid and event_time>=transaction_timestamp() and status_zh in ('仓储中','已打包')) then raise exception 'Status event missing';end if;
 if track_order_by_any_no('NONEXISTENT-UNIFIED-TRACKING-TEST') is not null then raise exception 'Unknown number found';end if;
 if has_function_privilege('anon','public.order_tracking_view(text,uuid)','execute') then raise exception 'Private function exposed';end if;
 if not has_function_privilege('anon','public.track_order_by_any_no(text)','execute') then raise exception 'Public lookup inaccessible';end if;
end $$;

rollback;
