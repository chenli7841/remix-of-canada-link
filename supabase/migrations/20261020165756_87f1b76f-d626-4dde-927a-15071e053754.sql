create or replace function public.driver_load_unit(_actor uuid,_trip uuid,_code text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare t public.driver_trips; q public.delivery_queue; prior public.driver_trip_items; n integer; matches integer; multi boolean; c text:=upper(trim(_code)); qid uuid;
begin
 if not coalesce(public.has_role(_actor,'driver'),false) then raise exception '仅司机可以扫码上车'; end if;
 select * into t from public.driver_trips where id=_trip and driver_id=_actor for update;
 if t.id is null then raise exception '上车清单不存在或不属于当前司机'; end if;
 select count(*) into matches from public.delivery_queue where code=trim(_code) and status='pending';
 if matches=1 then
   select id into qid from public.delivery_queue where code=trim(_code) and status='pending';
 elsif matches=0 then
   create temp table if not exists _dl_src(wid uuid, sid text) on commit drop;
   delete from _dl_src;
   insert into _dl_src
     select w.id, 'f:'||f.id::text from public.forwarding_orders f join public.waybills w on w.forwarding_id=f.id
      where upper(f.domestic_tracking_no)=c or upper(f.tracking_no)=c or upper(f.request_no)=c
         or exists(select 1 from unnest(coalesce(f.aliases,'{}'::text[])) a where upper(a)=c)
     union
     select w.id, 'o:'||o.id::text from public.orders o join public.waybills w on w.order_id=o.id
      where upper(o.order_no)=c or upper(o.domestic_tracking_no)=c;
   select exists(select 1 from _dl_src group by sid having count(distinct wid)>1) into multi;
   select count(distinct dq.id), min(dq.id::text)::uuid into matches, qid
     from _dl_src s join (select sid from _dl_src group by sid having count(distinct wid)=1) one on one.sid=s.sid
     join public.delivery_queue dq on dq.kind='waybill' and dq.ref_id=s.wid::text and dq.status='pending';
   if coalesce(matches,0)=0 and multi then raise exception '该订单有多个运单，请逐个扫描运单号或箱号'; end if;
   if coalesce(matches,0)<>1 then raise exception '未找到唯一待派送单位，请核对箱号、运单号、托盘号或国内单号'; end if;
 else
   raise exception '未找到唯一待派送单位，请核对箱号、运单号或托盘号';
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