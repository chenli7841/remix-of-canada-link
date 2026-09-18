-- 1. batches: persist grand total + breakdown
alter table public.batches
  add column if not exists grand_total_cny numeric not null default 0,
  add column if not exists fee_breakdown jsonb;

-- 2. surcharges (multi-level: waybill / carton / pallet / batch)
do $$ begin
  create type public.surcharge_scope as enum ('waybill','carton','pallet','batch');
exception when duplicate_object then null; end $$;

create table if not exists public.surcharges (
  id uuid primary key default gen_random_uuid(),
  scope public.surcharge_scope not null,
  waybill_id uuid references public.waybills(id) on delete cascade,
  carton_id  uuid references public.cartons(id)  on delete cascade,
  pallet_id  uuid references public.pallets(id)  on delete cascade,
  batch_id   uuid references public.batches(id)  on delete cascade,
  customer_code text,
  amount_cny numeric not null default 0,
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (scope = 'waybill' and waybill_id is not null and carton_id is null and pallet_id is null and batch_id is null) or
    (scope = 'carton'  and carton_id  is not null and waybill_id is null and pallet_id is null and batch_id is null) or
    (scope = 'pallet'  and pallet_id  is not null and waybill_id is null and carton_id is null and batch_id is null) or
    (scope = 'batch'   and batch_id   is not null and waybill_id is null and carton_id is null and pallet_id is null)
  )
);

create index if not exists surcharges_waybill_idx on public.surcharges(waybill_id) where waybill_id is not null;
create index if not exists surcharges_carton_idx  on public.surcharges(carton_id)  where carton_id  is not null;
create index if not exists surcharges_pallet_idx  on public.surcharges(pallet_id)  where pallet_id  is not null;
create index if not exists surcharges_batch_idx   on public.surcharges(batch_id)   where batch_id   is not null;
create index if not exists surcharges_batch_customer_idx on public.surcharges(batch_id, customer_code) where batch_id is not null;

grant select, insert, update, delete on public.surcharges to authenticated;
grant all on public.surcharges to service_role;

alter table public.surcharges enable row level security;

drop policy if exists "staff read surcharges" on public.surcharges;
create policy "staff read surcharges"
  on public.surcharges for select to authenticated
  using (
    public.has_role(auth.uid(), 'owner'::app_role) or
    public.has_role(auth.uid(), 'manager'::app_role) or
    public.has_role(auth.uid(), 'warehouse_cn'::app_role) or
    public.has_role(auth.uid(), 'warehouse_ca'::app_role) or
    public.has_role(auth.uid(), 'sales'::app_role) or
    public.has_role(auth.uid(), 'support'::app_role)
  );

drop policy if exists "staff write surcharges" on public.surcharges;
create policy "staff write surcharges"
  on public.surcharges for all to authenticated
  using (
    public.has_role(auth.uid(), 'owner'::app_role) or
    public.has_role(auth.uid(), 'manager'::app_role) or
    public.has_role(auth.uid(), 'warehouse_cn'::app_role) or
    public.has_role(auth.uid(), 'warehouse_ca'::app_role)
  )
  with check (
    public.has_role(auth.uid(), 'owner'::app_role) or
    public.has_role(auth.uid(), 'manager'::app_role) or
    public.has_role(auth.uid(), 'warehouse_cn'::app_role) or
    public.has_role(auth.uid(), 'warehouse_ca'::app_role)
  );

create or replace function public.tg_surcharges_set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists surcharges_updated_at on public.surcharges;
create trigger surcharges_updated_at before update on public.surcharges
  for each row execute function public.tg_surcharges_set_updated_at();

-- 3. oversize_rules
create table if not exists public.oversize_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shipping_method text,
  route_id uuid references public.shipping_routes(id) on delete cascade,
  max_length_cm numeric,
  max_width_cm numeric,
  max_height_cm numeric,
  max_single_side_cm numeric,
  max_weight_kg numeric,
  max_volume_m3 numeric,
  max_girth_cm numeric,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.oversize_rules to authenticated;
grant all on public.oversize_rules to service_role;

alter table public.oversize_rules enable row level security;

drop policy if exists "staff read oversize" on public.oversize_rules;
create policy "staff read oversize"
  on public.oversize_rules for select to authenticated
  using (
    public.has_role(auth.uid(), 'owner'::app_role) or
    public.has_role(auth.uid(), 'manager'::app_role) or
    public.has_role(auth.uid(), 'warehouse_cn'::app_role) or
    public.has_role(auth.uid(), 'warehouse_ca'::app_role) or
    public.has_role(auth.uid(), 'sales'::app_role) or
    public.has_role(auth.uid(), 'support'::app_role)
  );

drop policy if exists "staff write oversize" on public.oversize_rules;
create policy "staff write oversize"
  on public.oversize_rules for all to authenticated
  using (
    public.has_role(auth.uid(), 'owner'::app_role) or
    public.has_role(auth.uid(), 'manager'::app_role)
  )
  with check (
    public.has_role(auth.uid(), 'owner'::app_role) or
    public.has_role(auth.uid(), 'manager'::app_role)
  );

drop trigger if exists oversize_updated_at on public.oversize_rules;
create trigger oversize_updated_at before update on public.oversize_rules
  for each row execute function public.tg_surcharges_set_updated_at();