create or replace function public.admin_list_users(
  _search text default null,
  _role app_role default null,
  _vip vip_level default null,
  _unpaid_only boolean default false,
  _limit int default 10,
  _offset int default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _total int;
  _rows jsonb;
  _s text := nullif(trim(coalesce(_search, '')), '');
begin
  with base as (
    select p.id
    from profiles p
    where (_s is null
        or p.email ilike '%' || _s || '%'
        or p.full_name ilike '%' || _s || '%'
        or p.customer_code ilike '%' || _s || '%'
        or p.phone ilike '%' || _s || '%')
      and (_role is null or exists (select 1 from user_roles ur where ur.user_id = p.id and ur.role = _role))
      and (_vip is null or p.vip_level = _vip)
      and (not coalesce(_unpaid_only, false) or exists (
            select 1 from invoices i where i.user_id = p.id and i.status in ('unpaid','overdue')))
  )
  select count(*) into _total from base;

  with base as (
    select p.*,
      coalesce((
        select min(case ur.role
          when 'owner' then 0 when 'manager' then 1 when 'warehouse_cn' then 2
          when 'warehouse_ca' then 3 when 'driver' then 4 when 'pickup_point' then 5
          when 'sales' then 6 when 'support' then 7 else 8 end)
        from user_roles ur where ur.user_id = p.id), 8) as rnk
    from profiles p
    where (_s is null
        or p.email ilike '%' || _s || '%'
        or p.full_name ilike '%' || _s || '%'
        or p.customer_code ilike '%' || _s || '%'
        or p.phone ilike '%' || _s || '%')
      and (_role is null or exists (select 1 from user_roles ur where ur.user_id = p.id and ur.role = _role))
      and (_vip is null or p.vip_level = _vip)
      and (not coalesce(_unpaid_only, false) or exists (
            select 1 from invoices i where i.user_id = p.id and i.status in ('unpaid','overdue')))
    order by rnk asc, (p.customer_code is null) asc, p.customer_code asc
    limit greatest(1, coalesce(_limit, 10))
    offset greatest(0, coalesce(_offset, 0))
  )
  select coalesce(jsonb_agg(x order by x_rnk, x_code_null, x_code), '[]'::jsonb)
  into _rows
  from (
    select b.rnk as x_rnk, (b.customer_code is null) as x_code_null, b.customer_code as x_code,
      jsonb_build_object(
        'id', b.id,
        'email', b.email,
        'full_name', b.full_name,
        'phone', b.phone,
        'customer_code', b.customer_code,
        'created_at', b.created_at,
        'vip_level', coalesce(b.vip_level::text, 'normal'),
        'points', coalesce(b.points, 0),
        'is_blacklisted', coalesce(b.is_blacklisted, false),
        'blacklist_reason', b.blacklist_reason,
        'roles', coalesce((select jsonb_agg(ur.role::text) from user_roles ur where ur.user_id = b.id), '[]'::jsonb),
        'wallet', jsonb_build_object('balance_cad', coalesce((select w.balance_cad from wallets w where w.user_id = b.id), 0)),
        'unpaid', (
          select jsonb_build_object('count', count(*), 'amount_cny', coalesce(sum(greatest(0, coalesce(i.total_cny,0) - coalesce(i.paid_cny,0))), 0))
          from invoices i where i.user_id = b.id and i.status in ('unpaid','overdue')
        )
      ) as x
    from base b
  ) s;

  return jsonb_build_object('users', _rows, 'total', _total);
end;
$$;

revoke all on function public.admin_list_users(text, app_role, vip_level, boolean, int, int) from public, anon, authenticated;
grant execute on function public.admin_list_users(text, app_role, vip_level, boolean, int, int) to service_role;