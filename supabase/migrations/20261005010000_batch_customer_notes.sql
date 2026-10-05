begin;
create table if not exists public.batch_customer_notes (
  batch_id uuid not null references public.batches(id) on delete cascade,
  customer_code text not null,
  note text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (batch_id, customer_code)
);
alter table public.batch_customer_notes enable row level security;
grant all on public.batch_customer_notes to service_role;
commit;
