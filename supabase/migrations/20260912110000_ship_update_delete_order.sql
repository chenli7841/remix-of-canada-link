-- ship API 改单/删单：跟建单一样，检查和写入必须在同一事务里，不能先在 TypeScript
-- 查询状态、隔一会儿再写表——那样检查和写入之间会留时间窗口，入库扫描可能正好插进来。
-- 两个函数都先对 partner_orders + forwarding_orders 行加锁（FOR UPDATE），再在锁定的
-- 范围内重新核验一次入库事实，核验通过才真正写。

-- 删单：锁定判定跟 GET 的 computeOrderLockState 同一套口径（TypeScript 那边），这里
-- 在事务里、带行锁重新核验一遍。forwarding_items/waybills/partner_orders 都有
-- ON DELETE CASCADE 指向 forwarding_orders，删这一行会自动级联清干净。
create or replace function public.ship_delete_forwarding_order(
  _partner_key text,
  _domestic_number text
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_order record;
  v_fo record;
  v_removed text[];
begin
  select * into v_order from public.partner_orders
    where partner_key = _partner_key and domestic_number = _domestic_number
    for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'PT404';
  end if;

  select * into v_fo from public.forwarding_orders where id = v_order.forwarding_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_order.box_count_known then
    perform 1 from public.waybills where forwarding_id = v_order.forwarding_id and status <> 'pending' for update;
    if found then
      raise exception 'ORDER_LOCKED' using errcode = 'PT409';
    end if;
  else
    if v_fo.intake_at is not null then
      raise exception 'ORDER_LOCKED' using errcode = 'PT409';
    end if;
  end if;

  select coalesce(array_agg(waybill_no), '{}') into v_removed
    from public.waybills where forwarding_id = v_order.forwarding_id;

  delete from public.forwarding_orders where id = v_order.forwarding_id;

  return jsonb_build_object('removed_waybill_numbers', to_jsonb(v_removed));
end;
$$;

revoke all on function public.ship_delete_forwarding_order(text, text) from public, anon, authenticated;
grant execute on function public.ship_delete_forwarding_order(text, text) to service_role;

-- 改单：箱数已知按 clientPackageId 做数组 diff（保留+更新、新增、删除）；箱数未知
-- 整体替换订单级别物品清单，没有箱子概念。不支持把订单从一种箱数模式切到另一种——
-- 那是个更大的结构性变化，本轮不做，遇到就报 422 让上层拒绝。
create or replace function public.ship_update_forwarding_order(
  _partner_key text,
  _domestic_number text,
  _warehouse_code text,
  _note text,
  _recipient jsonb,
  _destination text,
  _box_known boolean,
  _packages jsonb,
  _items jsonb
) returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_order record;
  v_fo record;
  v_agg record;
  v_pkg jsonb;
  v_declared_cad numeric := 0;
  v_unit_cad numeric;
  v_qty numeric;
  v_fx_cad_to_cny numeric := 5.26;
  v_submitted_ids text[];
  v_existing_wb record;
  v_removed text[] := '{}';
  v_items_summary jsonb;
  v_wb_id uuid;
  v_max_box_no int;
begin
  select * into v_order from public.partner_orders
    where partner_key = _partner_key and domestic_number = _domestic_number
    for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'PT404';
  end if;

  select * into v_fo from public.forwarding_orders where id = v_order.forwarding_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND' using errcode = 'PT404';
  end if;

  if v_order.box_count_known <> _box_known then
    raise exception 'switching box-count mode is not supported' using errcode = 'PT422';
  end if;

  if v_order.box_count_known then
    perform 1 from public.waybills where forwarding_id = v_order.forwarding_id and status <> 'pending' for update;
    if found then
      raise exception 'ORDER_LOCKED' using errcode = 'PT409';
    end if;
    if _packages is null or jsonb_array_length(_packages) = 0 then
      raise exception 'order cannot have zero boxes' using errcode = 'PT422';
    end if;
  else
    if v_fo.intake_at is not null then
      raise exception 'ORDER_LOCKED' using errcode = 'PT409';
    end if;
  end if;

  -- 收件地址：直接更新建单时开的那条订单专属地址记录，不牵扯客户的全局默认地址。
  if v_fo.address_id is not null and _recipient is not null then
    update public.addresses set
      recipient = coalesce(_recipient->>'name', recipient),
      phone = coalesce(_recipient->>'phone', phone),
      country = coalesce(_recipient->>'countryCode', country),
      province = coalesce(_recipient->>'province', province),
      city = coalesce(_recipient->>'city', city),
      postal_code = coalesce(_recipient->>'postalCode', postal_code),
      line1 = coalesce(_recipient->>'addressLine1', line1),
      line2 = _recipient->>'addressLine2',
      destination_code = coalesce(_destination, destination_code)
    where id = v_fo.address_id;
  end if;

  update public.forwarding_orders set
    warehouse = coalesce(_warehouse_code, warehouse),
    note = _note
  where id = v_order.forwarding_id;

  if _box_known then
    delete from public.forwarding_items where forwarding_id = v_order.forwarding_id;
    for v_agg in
      select (it->>'name') as name, sum(coalesce((it->>'quantity')::numeric, 1)) as qty,
             max(coalesce((it->>'unit_price_cad')::numeric, 0)) as unit_price_cad
      from jsonb_array_elements(_packages) p, jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) it
      where (it->>'name') is not null and trim(it->>'name') <> ''
      group by (it->>'name')
    loop
      v_unit_cad := coalesce(v_agg.unit_price_cad, 0);
      v_qty := coalesce(v_agg.qty, 1);
      insert into public.forwarding_items(forwarding_id, name, quantity, unit_price_cad, unit_price_cny)
        values (v_order.forwarding_id, v_agg.name, v_qty, v_unit_cad, round(v_unit_cad * v_fx_cad_to_cny, 2));
      v_declared_cad := v_declared_cad + (v_unit_cad * v_qty);
    end loop;
    update public.forwarding_orders set declared_value_cad = round(v_declared_cad, 2) where id = v_order.forwarding_id;

    perform set_config('app.bulk_waybill_insert', 'on', true);

    select coalesce(array_agg(coalesce(p->>'client_package_id', '')), '{}') into v_submitted_ids
      from jsonb_array_elements(_packages) p;

    for v_existing_wb in
      select id, waybill_no from public.waybills
      where forwarding_id = v_order.forwarding_id
        and coalesce(client_package_id, '') <> all(v_submitted_ids)
    loop
      v_removed := array_append(v_removed, v_existing_wb.waybill_no);
    end loop;
    delete from public.waybills
      where forwarding_id = v_order.forwarding_id
        and coalesce(client_package_id, '') <> all(v_submitted_ids);

    for v_pkg in select jsonb_array_elements(_packages) loop
      select jsonb_agg(jsonb_build_object('name', it->>'name', 'quantity', coalesce((it->>'quantity')::numeric, 1)))
        into v_items_summary
        from jsonb_array_elements(coalesce(v_pkg->'items', '[]'::jsonb)) it;

      select id into v_wb_id from public.waybills
        where forwarding_id = v_order.forwarding_id and client_package_id = (v_pkg->>'client_package_id');

      if found then
        update public.waybills set items_summary = coalesce(v_items_summary, '[]'::jsonb) where id = v_wb_id;
      else
        select coalesce(max(box_no::int), 0) into v_max_box_no from public.waybills where forwarding_id = v_order.forwarding_id;
        insert into public.waybills(
          user_id, forwarding_id, shipping_method, status, payment_status, box_no, items_summary, client_package_id
        ) values (
          v_order.local_user_id, v_order.forwarding_id, v_fo.shipping_method, 'pending', 'unpaid',
          lpad((v_max_box_no + 1)::text, 3, '0'), coalesce(v_items_summary, '[]'::jsonb), v_pkg->>'client_package_id'
        );
      end if;
    end loop;

    perform public.recompute_mark_nos_for_parent(null, v_order.forwarding_id);
    perform public.recompute_parent_status(null, v_order.forwarding_id);
    perform set_config('app.bulk_waybill_insert', 'off', true);
  else
    delete from public.forwarding_items where forwarding_id = v_order.forwarding_id;
    for v_pkg in select jsonb_array_elements(coalesce(_items, '[]'::jsonb)) loop
      v_unit_cad := coalesce((v_pkg->>'unit_price_cad')::numeric, 0);
      v_qty := coalesce((v_pkg->>'quantity')::numeric, 1);
      insert into public.forwarding_items(forwarding_id, name, quantity, unit_price_cad, unit_price_cny, extras)
        values (
          v_order.forwarding_id, v_pkg->>'name', v_qty, v_unit_cad, round(v_unit_cad * v_fx_cad_to_cny, 2),
          coalesce(v_pkg->'extras', '{}'::jsonb)
        );
      v_declared_cad := v_declared_cad + (v_unit_cad * v_qty);
    end loop;
    update public.forwarding_orders set declared_value_cad = round(v_declared_cad, 2) where id = v_order.forwarding_id;
  end if;

  return jsonb_build_object('removed_waybill_numbers', to_jsonb(v_removed));
end;
$$;

revoke all on function public.ship_update_forwarding_order(
  text, text, text, text, jsonb, text, boolean, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.ship_update_forwarding_order(
  text, text, text, text, jsonb, text, boolean, jsonb, jsonb
) to service_role;
