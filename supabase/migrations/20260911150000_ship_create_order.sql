-- ship API 建单地基：合作方范围内一次逻辑录单的去重表 + 原子建单函数。
-- 不对 forwarding_orders.domestic_tracking_no 加全局唯一索引（那会影响所有历史
-- 非 API 运单，而且一个国内单号本来就可能对应多条 waybills）；改用一张独立的小表，
-- 唯一约束按"合作方 + 国内单号"这个逻辑录单粒度来，不牵扯其他任何现有表结构。

create table if not exists public.partner_orders (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null,
  domestic_number text not null,       -- Shipper 提交的原始字符串，区分大小写、不去空格
  forwarding_id uuid not null references public.forwarding_orders(id) on delete cascade,
  local_user_id uuid not null references public.profiles(id),
  route_code text not null,
  box_count_known boolean not null,    -- 建单当时走的是哪种模式，PUT/DELETE 需要按同一模式处理
  request_fingerprint text not null,   -- 建单请求关键字段的稳定哈希，用于判断"重试"还是"真冲突"
  created_at timestamptz not null default now()
);
create unique index if not exists idx_partner_orders_domestic
  on public.partner_orders (partner_key, domestic_number);

alter table public.partner_orders enable row level security;
revoke all on public.partner_orders from anon, authenticated;
grant all on public.partner_orders to service_role;

-- Idempotency-Key 去重（通用，供所有写接口用，不只是建单）：同一 partner_key + key
-- 的重试，如果请求指纹一致就回放已存的响应；指纹不同上层判 409 IDEMPOTENCY_CONFLICT。
create table if not exists public.partner_api_idempotency (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  status text not null default 'in_progress', -- in_progress | completed
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists idx_partner_api_idempotency_key
  on public.partner_api_idempotency (partner_key, idempotency_key);

alter table public.partner_api_idempotency enable row level security;
revoke all on public.partner_api_idempotency from anon, authenticated;
grant all on public.partner_api_idempotency to service_role;

-- 原子建单：箱数已知（Shipper 提交真实箱子清单，一箱可含多品）与箱数未知（海运，
-- 复用 place_forwarding 现有"零箱"分支）两种模式共用一个函数，最后都以往
-- partner_orders 插入一行作为"这次逻辑录单是否成功"的原子判定——插入失败
-- （unique_violation）说明国内单号已被抢注，整个异常块内此前的所有插入
-- （forwarding_orders/forwarding_items/waybills）在隐式保存点边界自动整体回滚，
-- 不会留下半张单；按请求指纹判断是重放还是真冲突。
--
-- 故意不加 SECURITY DEFINER：这个函数只授权给 service_role 执行，保持默认的
-- SECURITY INVOKER 让内部对 place_forwarding() 的调用仍以 service_role 身份执行，
-- 这样 place_forwarding 内部 "current_user = 'service_role' AND _target_user_id
-- IS NOT NULL" 的既有系统级调用路径才能正确识别出调用方，不需要改 place_forwarding
-- 本身一个字。
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
  _packages jsonb, -- box_known=true: [{client_package_id, items:[{name,quantity,unit_price_cad,extras}]}]
  _items jsonb,    -- box_known=false: [{name,quantity,unit_price_cad,extras}]（订单级别品项清单，不分箱）
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

  begin -- 建单尝试块：撞唯一约束时整体回滚到这里，不留半张单
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

      -- forwarding_items：按品名把所有箱子里的数量聚合成订单级别申报清单
      -- （跟现有 place_forwarding 语义一致：申报价值按这个算，不是按箱分别算）。
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

      -- 逐箱建 waybills：一个 package = 一箱，items_summary 就是这一箱申报的物品清单
      -- ——这正是"箱数已知"模式要解决的事：允许一箱内有多种商品。
      perform set_config('app.bulk_waybill_insert', 'on', true);
      for v_pkg in select jsonb_array_elements(_packages) loop
        v_box_seq := v_box_seq + 1;
        select jsonb_agg(jsonb_build_object('name', it->>'name', 'quantity', coalesce((it->>'quantity')::numeric, 1)))
          into v_items_summary
          from jsonb_array_elements(coalesce(v_pkg->'items', '[]'::jsonb)) it;
        insert into public.waybills(
          user_id, forwarding_id, shipping_method, status, payment_status, box_no, items_summary
        ) values (
          _local_user_id, v_fo_id, v_route.shipping_method, 'pending', 'unpaid',
          lpad(v_box_seq::text, 3, '0'), coalesce(v_items_summary, '[]'::jsonb)
        );
      end loop;
      perform public.recompute_mark_nos_for_parent(null, v_fo_id);
      perform public.recompute_parent_status(null, v_fo_id);
      perform set_config('app.bulk_waybill_insert', 'off', true);
    else
      -- 箱数未知（海运）：直接复用 place_forwarding 现有"零箱"分支（不给任何物品带
      -- box_count 即可触发），不新增建箱逻辑，跟网页/微信走的是完全同一段既有代码。
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
      -- 理论上不该发生：既然刚才是 unique_violation，说明这一行必然存在。防御性兜底。
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
