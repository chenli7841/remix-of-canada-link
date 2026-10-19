begin;

-- Counts shrink when invoices are deleted. Keep a durable high-water mark instead.
create table if not exists public.invoice_number_counters (
  date_key text primary key check (date_key ~ '^[0-9]{8}$'),
  last_value bigint not null check (last_value >= 0)
);
alter table public.invoice_number_counters enable row level security;
revoke all on public.invoice_number_counters from public, anon, authenticated;
grant all on public.invoice_number_counters to service_role;

insert into public.invoice_number_counters(date_key,last_value)
select substring(invoice_no from 4 for 8), max(substring(invoice_no from 12)::bigint)
from public.invoices where invoice_no ~ '^INV[0-9]{8}[0-9]{4,}$'
group by substring(invoice_no from 4 for 8)
on conflict(date_key) do update
set last_value=greatest(invoice_number_counters.last_value,excluded.last_value);

create or replace function public.gen_invoice_no_fn() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare ds text; next_value bigint; existing_max bigint;
begin
  if new.invoice_no is not null and new.invoice_no <> '' then return new; end if;
  ds:=to_char(now(),'YYYYMMDD');
  -- Also accounts for explicitly numbered imports since the previous allocation.
  select coalesce(max(substring(invoice_no from 12)::bigint),0) into existing_max
  from public.invoices where invoice_no ~ ('^INV'||ds||'[0-9]{4,}$');
  insert into public.invoice_number_counters as counter(date_key,last_value)
  values(ds,existing_max+1)
  on conflict(date_key) do update
    set last_value=greatest(counter.last_value,excluded.last_value-1)+1
  returning last_value into next_value;
  new.invoice_no:='INV'||ds||lpad(next_value::text,greatest(4,length(next_value::text)),'0');
  return new;
end $$;
commit;
