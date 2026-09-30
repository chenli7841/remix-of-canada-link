create table public.partner_quote_routes (
 id uuid primary key default gen_random_uuid(), code text not null unique,
 config jsonb not null, updated_at timestamptz not null default now(), updated_by uuid references auth.users(id)
);
create table public.partner_quote_snapshots (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
 route_id uuid not null references public.partner_quote_routes(id),input jsonb not null,
 route_snapshot jsonb not null,result jsonb not null,created_at timestamptz not null default now(),expires_at timestamptz not null
);
create index partner_quote_snapshots_user on public.partner_quote_snapshots(user_id,created_at desc);
alter table public.partner_quote_routes enable row level security;
alter table public.partner_quote_snapshots enable row level security;
revoke all on public.partner_quote_routes,public.partner_quote_snapshots from anon,authenticated;
grant all on public.partner_quote_routes,public.partner_quote_snapshots to service_role;
