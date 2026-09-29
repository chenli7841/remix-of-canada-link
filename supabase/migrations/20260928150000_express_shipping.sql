-- All provider credentials stay in server environment variables. No browser writes.
create table public.express_settings (
  id boolean primary key default true check (id),
  origin jsonb, rule jsonb not null default '{}',
  updated_by uuid references auth.users(id), updated_at timestamptz not null default now()
);
insert into public.express_settings(id) values (true);
create table public.express_quotes (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
  account_key text not null, source jsonb not null, draft jsonb not null, rule jsonb not null,
  rates jsonb not null, coverage text[] not null, links text[] not null,
  owner_id uuid references auth.users(id), context_hash text not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null
);
create table public.express_shipments (
  id uuid primary key default gen_random_uuid(), quote_id uuid not null unique references public.express_quotes(id),
  account_key text not null, user_id uuid not null references auth.users(id), owner_id uuid references auth.users(id),
  source jsonb not null, leg text not null, links text[] not null, draft jsonb not null,
  rate jsonb not null, reference text not null unique, provider_id text,
  status text not null check(status in ('submitting','unknown','created','voided')),
  tracking_numbers jsonb not null default '[]', provider_state text, actual_price jsonb,
  last_error text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(account_key, provider_id)
);
create index express_shipments_links on public.express_shipments using gin(links);
create index express_shipments_owner on public.express_shipments(owner_id, created_at desc);
create table public.express_unit_locks (
  account_key text not null, leg text not null, unit_key text not null,
  shipment_id uuid not null references public.express_shipments(id),
  primary key(account_key, leg, unit_key)
);
create table public.express_labels (
  shipment_id uuid primary key references public.express_shipments(id),
  mime_type text not null, file_name text not null, base64 text not null,
  created_at timestamptz not null default now()
);
alter table public.express_settings enable row level security;
alter table public.express_quotes enable row level security;
alter table public.express_shipments enable row level security;
alter table public.express_unit_locks enable row level security;
alter table public.express_labels enable row level security;
revoke all on public.express_settings, public.express_quotes, public.express_shipments, public.express_unit_locks, public.express_labels from anon, authenticated;
grant all on public.express_settings, public.express_quotes, public.express_shipments, public.express_unit_locks, public.express_labels to service_role;

-- Atomic reservation: overlapping carton/pallet/waybill requests cannot both buy labels.
create function public.reserve_express_shipment(p_quote uuid, p_user uuid, p_rate text)
returns uuid language plpgsql security definer set search_path = public as $$
declare q express_quotes; s uuid := gen_random_uuid(); r jsonb;
begin
  select * into q from express_quotes where id=p_quote for update;
  if q.id is null or q.user_id <> p_user or q.expires_at < now() then
    raise exception '报价不存在或已过期，请重新询价';
  end if;
  select value into r from jsonb_array_elements(q.rates) where value->>'key'=p_rate;
  if r is null then raise exception '无效服务'; end if;
  -- Also detect an already-shipped ancestor when contents changed after that label
  -- was bought. This short transaction-level lock serializes reservation only,
  -- never the remote API request.
  perform pg_advisory_xact_lock(hashtextextended(q.account_key || '/' || (q.draft->>'leg'), 0));
  if exists(select 1 from express_unit_locks where account_key=q.account_key
    and leg=q.draft->>'leg' and unit_key=any(q.links)) then
    raise exception '该货物或所属整箱/整托已有面单，请查看共享发货记录';
  end if;
  insert into express_shipments(id,quote_id,account_key,user_id,owner_id,source,leg,links,draft,rate,reference,status)
  values(s,q.id,q.account_key,p_user,q.owner_id,q.source,q.draft->>'leg',q.links,q.draft,r,'EP-'||replace(s::text,'-',''),'submitting');
  insert into express_unit_locks(account_key,leg,unit_key,shipment_id)
  select q.account_key,q.draft->>'leg',u,s from unnest(q.coverage) u order by u;
  return s;
exception when unique_violation then
  raise exception '该货物或其中的包裹已创建面单或正在处理，请查看共享发货记录';
end $$;
revoke all on function public.reserve_express_shipment(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_express_shipment(uuid,uuid,text) to service_role;

create function public.release_voided_express_shipment(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform id from express_shipments where id=p_id and status='voided' for update;
  if not found then raise exception '仅已确认取消的订单可以释放'; end if;
  delete from express_unit_locks where shipment_id=p_id;
  delete from express_labels where shipment_id=p_id;
end $$;
revoke all on function public.release_voided_express_shipment(uuid) from public,anon,authenticated;
grant execute on function public.release_voided_express_shipment(uuid) to service_role;
