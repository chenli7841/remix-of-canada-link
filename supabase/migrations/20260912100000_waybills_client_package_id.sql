-- ship API 需要把 Shipper 提交的 clientPackageId 稳定存住，查询/修改时才能把箱号
-- 跟 Shipper 自己的箱标识对应回去。items_summary 的物品数组格式不能动（其他消费方
-- 按 {name,quantity} 读取），所以这里加一个最小的专用列，只给箱数已知的 ship API
-- 建单场景用，其余所有现有运单/箱号一律为 null，不影响任何既有查询和页面。
alter table public.waybills add column if not exists client_package_id text;

create or replace function public.ship_create_forwarding_order(
  _partner_key text,
  _domestic_number text,
  _local_user_id uuid,
  _route_code text,
  _warehouse_code text,
  _address_id uuid,
  _note text,
  _insured boolean,
  _box_known boolean,
  _packages jsonb,
  _items jsonb,
  _request_fingerprint text
) returns jsonb
language plpgsql
set search_path = public
set statement_timeout to '30s'
as $$
declare
  v_route record;
  v_cust text;
  v_fo_id uuid;
  v_req_no text;
  v_replayed boolean := false;
  v_pkg jsonb;
  v_agg record;
  v_box_seq int := 0;
  v_items_summary jsonb;
  v_declared_cad numeric := 0;
  v_unit_cad numeric;
  v_qty numeric;
  v_fx_cad_to_cny numeric := 5.26;
  v_existing record;
  v_place_result jsonb;
begin
  if _warehouse_code is null or trim(_warehouse_code) = '' then
    raise exception 'warehouseCode is required' using errcode = 'PT422';
  end if;

  select * into v_route from public.shipping_routes where code = _route_code and is_active = true;
  if not found then
    raise exception 'ROUTE_NOT_FOUND' using errcode = 'PT404';
  end if;
  select customer_code into v_cust from public.profiles where id = _local_user_id;

  begin
    if _box_known then
      insert into public.forwarding_orders(
        user_id, warehouse, shipping_method, route_code, destination_code,
        route_id, address_id, customer_code, domestic_tracking_no,
        status, payment_status, note, items_desc, insured
      ) values (
        _local_user_id, _warehouse_code, v_route.shipping_method, v_route.code, v_route.destination_code,
        v_route.id, _address_id, v_cust, _domestic_number,
        'pending', 'unpaid', _note,
        (select string_agg(distinct (it->>'name'), ', ')
           from jsonb_array_elements(_packages) p, jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) it),
        coalesce(_insured, false)
      ) returning id, request_no into v_fo_id, v_req_no;

      for v_agg in
        select
          (it->>'name') as name,
          sum(coalesce((it->>'quantity')::numeric, 1)) as qty,
          max(coalesce((it->>'unit_price_cad')::numeric, 0)) as unit_price_cad
        from jsonb_array_elements(_packages) p, jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) it
        where (it->>'name') is not null and trim(it->>'name') <> ''
        group by (it->>'name')
      loop
        v_unit_cad := coalesce(v_agg.unit_price_cad, 0);
        v_qty := coalesce(v_agg.qty, 1);
        insert into public.forwarding_items(forwarding_id, name, quantity, unit_price_cad, unit_price_cny)
          values (v_fo_id, v_agg.name, v_qty, v_unit_cad, round(v_unit_cad * v_fx_cad_to_cny, 2));
        v_declared_cad := v_declared_cad + (v_unit_cad * v_qty);
      end loop;

      update public.forwarding_orders set declared_value_cad = round(v_declared_cad, 2) where id = v_fo_id;

      perform set_config('app.bulk_waybill_insert', 'on', true);
      for v_pkg in select jsonb_array_elements(_packages) loop
        v_box_seq := v_box_seq + 1;
        select jsonb_agg(jsonb_build_object('name', it->>'name', 'quantity', coalesce((it->>'quantity')::numeric, 1)))
          into v_items_summary
          from jsonb_array_elements(coalesce(v_pkg->'items', '[]'::jsonb)) it;
        insert into public.waybills(
          user_id, forwarding_id, shipping_method, status, payment_status, box_no, items_summary, client_package_id
        ) values (
          _local_user_id, v_fo_id, v_route.shipping_method, 'pending', 'unpaid',
          lpad(v_box_seq::text, 3, '0'), coalesce(v_items_summary, '[]'::jsonb), v_pkg->>'client_package_id'
        );
      end loop;
      perform public.recompute_mark_nos_for_parent(null, v_fo_id);
      perform public.recompute_parent_status(null, v_fo_id);
      perform set_config('app.bulk_waybill_insert', 'off', true);
    else
      v_place_result := public.place_forwarding(
        jsonb_build_object(
          'warehouse', _warehouse_code,
          'route_code', _route_code,
          'address_id', _address_id,
          'domestic_tracking_no', _domestic_number,
          'note', _note,
          'insured', coalesce(_insured, false),
          'items', coalesce(_items, '[]'::jsonb)
        ),
        _local_user_id
      );
      v_fo_id := (v_place_result->>'id')::uuid;
    end if;

    insert into public.partner_orders(
      partner_key, domestic_number, forwarding_id, local_user_id, route_code, box_count_known, request_fingerprint
    ) values (
      _partner_key, _domestic_number, v_fo_id, _local_user_id, _route_code, _box_known, _request_fingerprint
    );
  exception when unique_violation then
    select * into v_existing from public.partner_orders
      where partner_key = _partner_key and domestic_number = _domestic_number;
    if not found then
      raise exception 'DOMESTIC_NUMBER_CONFLICT' using errcode = 'PT409';
    end if;
    if v_existing.request_fingerprint = _request_fingerprint then
      v_replayed := true;
      v_fo_id := v_existing.forwarding_id;
    else
      raise exception 'DOMESTIC_NUMBER_CONFLICT' using errcode = 'PT409';
    end if;
  end;

  return jsonb_build_object('forwarding_id', v_fo_id, 'replayed', v_replayed);
end;
$$;

revoke all on function public.ship_create_forwarding_order(
  text, text, uuid, text, text, uuid, text, boolean, boolean, jsonb, jsonb, text
) from public, anon, authenticated;
grant execute on function public.ship_create_forwarding_order(
  text, text, uuid, text, text, uuid, text, boolean, boolean, jsonb, jsonb, text
) to service_role;
