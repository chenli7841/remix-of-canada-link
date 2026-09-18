alter table public.batches add column if not exists display_name text;
alter table public.cartons add column if not exists display_name text;
alter table public.pallets add column if not exists display_name text;

comment on column public.batches.display_name is 'Optional manually entered batch name';
comment on column public.cartons.display_name is 'Optional manually entered carton name';
comment on column public.pallets.display_name is 'Optional manually entered pallet name';
