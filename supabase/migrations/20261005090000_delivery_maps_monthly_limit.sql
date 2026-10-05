begin;

-- Reserve a slot before any outbound request. Failed requests also consume a
-- slot; this deliberately fails closed rather than guessing provider billing.
create table if not exists public.delivery_maps_monthly_usage (
  month date primary key,
  used integer not null default 0 check (used between 0 and 1000)
);
alter table public.delivery_maps_monthly_usage enable row level security;
revoke all on public.delivery_maps_monthly_usage from anon, authenticated;
grant select, insert, update on public.delivery_maps_monthly_usage to service_role;

create or replace function public.reserve_delivery_maps_call()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_month date := date_trunc('month', now() at time zone 'UTC')::date;
  used_count integer;
begin
  insert into public.delivery_maps_monthly_usage(month, used)
  values (current_month, 1)
  on conflict (month) do update
  set used = delivery_maps_monthly_usage.used + 1
  where delivery_maps_monthly_usage.used < 1000
  returning used into used_count;
  if used_count is null then
    raise exception 'DELIVERY_MAPS_MONTHLY_LIMIT';
  end if;
  return used_count;
end;
$$;
revoke all on function public.reserve_delivery_maps_call() from public, anon, authenticated;
grant execute on function public.reserve_delivery_maps_call() to service_role;

commit;
