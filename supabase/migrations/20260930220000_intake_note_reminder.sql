begin;
alter table public.orders add column if not exists intake_reminder boolean not null default false;
alter table public.forwarding_orders add column if not exists intake_reminder boolean not null default false;
commit;
