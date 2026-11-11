-- 扫码号容错：去空格/不可见字符、全角转半角、统一大写、统一横杠
create or replace function public.scan_normalize(_input text)
returns text language sql immutable parallel safe
set search_path = public, pg_catalog
as $$
  select nullif(
    regexp_replace(
      upper(regexp_replace(
        translate(normalize(coalesce(_input,''), NFKC), E'\u2010\u2011\u2012\u2013\u2014\u2015\u2212\u30FC\uFF0D', '---------'),
        E'[\\s\u200B\u200C\u200D\u2060\uFEFF]+', '', 'g')),
      '^[^A-Z0-9]+|[^A-Z0-9]+$', '', 'g'),
    '');
$$;

-- 只保留字母数字，用于容错比对
create or replace function public.scan_key(_input text)
returns text language sql immutable parallel safe
set search_path = public, pg_catalog
as $$
  select nullif(regexp_replace(coalesce(public.scan_normalize(_input),''), '[^A-Z0-9]', '', 'g'), '');
$$;

create index if not exists waybills_scan_key_idx on public.waybills (public.scan_key(waybill_no));
create index if not exists cartons_scan_key_idx on public.cartons (public.scan_key(carton_no));
create index if not exists pallets_scan_key_idx on public.pallets (public.scan_key(pallet_no));
create index if not exists batches_scan_key_idx on public.batches (public.scan_key(batch_no));
create index if not exists orders_no_scan_key_idx on public.orders (public.scan_key(order_no));
create index if not exists orders_domestic_scan_key_idx on public.orders (public.scan_key(domestic_tracking_no));
create index if not exists fo_no_scan_key_idx on public.forwarding_orders (public.scan_key(request_no));
create index if not exists fo_domestic_scan_key_idx on public.forwarding_orders (public.scan_key(domestic_tracking_no));
create index if not exists delivery_queue_scan_key_idx on public.delivery_queue (public.scan_key(code));

-- 把扫描内容还原成数据库里实际存的单号（先精确，再按字母数字容错）
create or replace function public.resolve_scan_code(_input text)
returns text language plpgsql stable security definer
set search_path = public, pg_catalog
as $$
declare n text := public.scan_normalize(_input); k text; r text;
begin
  if n is null then return null; end if;
  k := public.scan_key(n);
  select waybill_no into r from waybills where waybill_no = n limit 1; if r is not null then return r; end if;
  select carton_no into r from cartons where carton_no = n limit 1; if r is not null then return r; end if;
  select pallet_no into r from pallets where pallet_no = n limit 1; if r is not null then return r; end if;
  select batch_no into r from batches where batch_no = n limit 1; if r is not null then return r; end if;
  select order_no into r from orders where order_no = n limit 1; if r is not null then return r; end if;
  select request_no into r from forwarding_orders where request_no = n limit 1; if r is not null then return r; end if;
  select domestic_tracking_no into r from orders where domestic_tracking_no = n limit 1; if r is not null then return r; end if;
  select domestic_tracking_no into r from forwarding_orders where domestic_tracking_no = n limit 1; if r is not null then return r; end if;
  if k is null then return n; end if;
  select waybill_no into r from waybills where public.scan_key(waybill_no) = k limit 1; if r is not null then return r; end if;
  select carton_no into r from cartons where public.scan_key(carton_no) = k limit 1; if r is not null then return r; end if;
  select pallet_no into r from pallets where public.scan_key(pallet_no) = k limit 1; if r is not null then return r; end if;
  select batch_no into r from batches where public.scan_key(batch_no) = k limit 1; if r is not null then return r; end if;
  select order_no into r from orders where public.scan_key(order_no) = k limit 1; if r is not null then return r; end if;
  select request_no into r from forwarding_orders where public.scan_key(request_no) = k limit 1; if r is not null then return r; end if;
  select domestic_tracking_no into r from orders where public.scan_key(domestic_tracking_no) = k limit 1; if r is not null then return r; end if;
  select domestic_tracking_no into r from forwarding_orders where public.scan_key(domestic_tracking_no) = k limit 1; if r is not null then return r; end if;
  return n;
end $$;
revoke all on function public.resolve_scan_code(text) from public, anon, authenticated;
grant execute on function public.resolve_scan_code(text) to service_role;

CREATE OR REPLACE FUNCTION public.find_by_any_no(_input text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n text; k text; sk text; r jsonb;
BEGIN
  n := COALESCE(public.scan_normalize(_input),'');
  IF n = '' THEN RETURN NULL; END IF;
  k := public.normalize_no(n);
  sk := public.scan_key(n);

  SELECT jsonb_build_object('kind','waybill','id',id,'no',waybill_no,
           'order_id',order_id,'forwarding_id',forwarding_id) INTO r
    FROM public.waybills
   WHERE waybill_no = n OR n = ANY(aliases) OR public.normalize_no(waybill_no) = k
   LIMIT 1;
  IF r IS NOT NULL THEN RETURN r; END IF;

  SELECT jsonb_build_object('kind','order','id',id,'no',order_no) INTO r
    FROM public.orders
   WHERE order_no = n OR n = ANY(aliases) OR public.normalize_no(order_no) = k
   LIMIT 1;
  IF r IS NOT NULL THEN RETURN r; END IF;

  SELECT jsonb_build_object('kind','forwarding','id',id,'no',request_no) INTO r
    FROM public.forwarding_orders
   WHERE request_no = n OR n = ANY(aliases) OR public.normalize_no(request_no) = k
   LIMIT 1;
  IF r IS NOT NULL THEN RETURN r; END IF;

  IF sk IS NULL THEN RETURN NULL; END IF;
  SELECT jsonb_build_object('kind','waybill','id',id,'no',waybill_no,
           'order_id',order_id,'forwarding_id',forwarding_id) INTO r
    FROM public.waybills WHERE public.scan_key(waybill_no) = sk LIMIT 1;
  IF r IS NOT NULL THEN RETURN r; END IF;
  SELECT jsonb_build_object('kind','order','id',id,'no',order_no) INTO r
    FROM public.orders WHERE public.scan_key(order_no) = sk LIMIT 1;
  IF r IS NOT NULL THEN RETURN r; END IF;
  SELECT jsonb_build_object('kind','forwarding','id',id,'no',request_no) INTO r
    FROM public.forwarding_orders WHERE public.scan_key(request_no) = sk LIMIT 1;
  RETURN r;
END $function$;

CREATE OR REPLACE FUNCTION public.driver_load_unit(_actor uuid, _trip uuid, _code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  t public.driver_trips;
  q public.delivery_queue;
  prior public.driver_trip_items;
  n integer;
  matches integer;
  multi boolean := false;
  c text := coalesce(public.scan_key(_code),'');
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
  if c='' then raise exception '空扫描'; end if;

  -- First preserve the normal carton / waybill / pallet code path.
  select count(*), min(id::text)::uuid into matches, qid
    from public.delivery_queue
   where public.scan_key(code)=c and status='pending';

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
       where public.scan_key(f.request_no)=c
          or public.scan_key(f.domestic_tracking_no)=c
      union
      select w.id, 'o:'||o.id::text
        from public.orders o
        join public.waybills w on w.order_id=o.id
       where public.scan_key(o.order_no)=c
          or public.scan_key(o.domestic_tracking_no)=c;

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
end $function$;
