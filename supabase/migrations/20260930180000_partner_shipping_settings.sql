create table public.partner_shipping_settings (
 section text primary key check(section in ('general','transport','warehouses')),
 value jsonb not null,
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
alter table public.partner_shipping_settings enable row level security;
revoke all on public.partner_shipping_settings from anon,authenticated;
grant all on public.partner_shipping_settings to service_role;
