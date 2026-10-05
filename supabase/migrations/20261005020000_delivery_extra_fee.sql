begin;
alter table public.batch_customer_notes add column if not exists extra_fee_cny numeric(12,2) check (extra_fee_cny >= 0);
commit;
