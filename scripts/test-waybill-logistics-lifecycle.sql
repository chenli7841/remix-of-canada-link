-- Execute after the lifecycle migration inside the SAME transaction, then roll back.
do $$
declare wid uuid:='a5c6e169-5c08-43b7-8791-b52810b4b57b'; sid uuid; n integer;
begin
 if not exists(select 1 from logistics_unit_waybills('batch','5ec4c6bf-cc94-46da-87a1-08741a2398af') where id=wid) then
   raise exception 'Nested carton missing from batch'; end if;
 update waybills set status='storage' where id=wid;
 update waybills set status='packed' where id=wid;
 update waybills set status='shipped' where id=wid;
 update waybills set status='arrived' where id=wid;
 select s.id into sid from shipments s join waybills w on w.waybill_no=s.tracking_no where w.id=wid;
 select count(*) into n from tracking_events where shipment_id=sid and event_time=transaction_timestamp() and status_zh in ('已装箱','已发货','已到货');
 if n<>3 then raise exception 'Expected 3 lifecycle nodes, got %',n; end if;
 perform append_waybill_logistics_event(wid,'测试重试','Test retry',now(),'lifecycle-test');
 perform append_waybill_logistics_event(wid,'测试重试','Test retry',now(),'lifecycle-test');
 if (select count(*) from tracking_events where shipment_id=sid and source_ref='lifecycle-test')<>1 then raise exception 'Duplicate retry event'; end if;
 perform set_config('app.bulk_waybill_insert','on',true);
 update waybills set status='delivered' where id=wid;
 perform set_config('app.bulk_waybill_insert','',true);
 if exists(select 1 from tracking_events where shipment_id=sid and event_time=transaction_timestamp() and status_zh='已派送') then raise exception 'Duplicate completion trigger'; end if;
 update pallets set status='open' where id='94913241-9dc5-4e9a-a882-7574194594d9';
 update pallets set status='shipped' where id='94913241-9dc5-4e9a-a882-7574194594d9';
 if (select status::text from waybills where id=wid)<>'delivered' then raise exception 'Delivered parcel regressed'; end if;
 if has_function_privilege('anon','public.add_delivery_unit_tracking(uuid,text,text)','execute') then raise exception 'Public mutation permission'; end if;
end $$;
select 'lifecycle tests passed; rollback follows' as result;
