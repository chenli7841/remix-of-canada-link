-- Preserve previous settings for audit; confirmed invoices and payments are not repriced.
create table if not exists public.freight_rules_before_v3 (
  id uuid primary key, snapshot jsonb not null, captured_at timestamptz not null default now()
);
alter table public.freight_rules_before_v3 enable row level security;
revoke all on public.freight_rules_before_v3 from anon, authenticated;
insert into public.freight_rules_before_v3(id,snapshot)
select id,to_jsonb(r) from public.freight_rules r on conflict(id) do nothing;

alter table public.cartons add column if not exists billing_mode text;
alter table public.pallets add column if not exists billing_mode text;
-- One-time preservation of existing choices; new containers default to per-waybill.
update public.cartons c set billing_mode=coalesce((select p.fee_scheme_preference::text from public.profiles p where p.customer_code=c.customer_code limit 1),'split') where billing_mode is null;
update public.pallets c set billing_mode=coalesce((select p.fee_scheme_preference::text from public.profiles p where p.customer_code=c.customer_code limit 1),'split') where billing_mode is null;
alter table public.cartons alter column billing_mode set default 'split', alter column billing_mode set not null;
alter table public.pallets alter column billing_mode set default 'split', alter column billing_mode set not null;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.cartons'::regclass and conname='cartons_billing_mode_check') then
    alter table public.cartons add constraint cartons_billing_mode_check check(billing_mode in ('split','merged'));
  end if;
end $$;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.pallets'::regclass and conname='pallets_billing_mode_check') then
    alter table public.pallets add constraint pallets_billing_mode_check check(billing_mode in ('split','merged'));
  end if;
end $$;

create or replace function public.disable_freight_minimum_v3() returns trigger
language plpgsql set search_path=public as $$ begin
  new.min_charge_cad=0; new.min_charge_cny=0;
  new.min_charge_waybill_cad=0; new.min_charge_batch_cad=0;
  return new;
end $$;
drop trigger if exists freight_minimum_disabled_v3 on public.freight_rules;
create trigger freight_minimum_disabled_v3 before insert or update on public.freight_rules
for each row execute function public.disable_freight_minimum_v3();
update public.freight_rules set min_charge_cad=0,min_charge_cny=0,min_charge_waybill_cad=0,min_charge_batch_cad=0;
-- Invalidates unconfirmed summaries only; existing confirmed invoice totals remain frozen.
update public.batches set fees_dirty_at=now();

-- Stored order summaries follow measured leaves, including updates outside the measurement screen.
create or replace function public.sync_measured_order_fees_v3(p_id uuid, p_forwarding boolean)
returns void language plpgsql security definer set search_path=public as $$
declare
  v record; v_snapshot jsonb; v_fx numeric; v_extra numeric;
begin
  if p_id is null then return; end if;
  if p_forwarding then
    select freight_snapshot into v_snapshot from public.forwarding_orders where id=p_id for update;
  else
    select freight_snapshot into v_snapshot from public.orders where id=p_id for update;
  end if;

  select count(*) n, count(freight_cad) priced,
    round(coalesce(sum(freight_cad),0)::numeric,2) freight,
    round(coalesce(sum(duty_cad),0)::numeric,2) duty,
    round(coalesce(sum(insurance_cad),0)::numeric,2) insurance,
    round(coalesce(sum(clearance_cad),0)::numeric,2) clearance,
    coalesce(sum(weight_kg),0) actual,
    coalesce(sum((weight_snapshot->>'volumetric_weight')::numeric),0) volumetric,
    coalesce(sum((weight_snapshot->>'chargeable_weight')::numeric),0) chargeable,
    max(nullif((weight_snapshot->>'fx_rate')::numeric,0)) fx
  into v from public.waybills
  where (p_forwarding and forwarding_id=p_id) or (not p_forwarding and order_id=p_id);
  if v.n<>v.priced then return; end if;
  v_snapshot=coalesce(v_snapshot,'{}'::jsonb);
  v_fx=coalesce(v.fx,nullif((v_snapshot->>'fx_rate')::numeric,0));
  if v_fx is null or v_fx<=0 then return; end if;
  v_extra=coalesce((v_snapshot->>'surcharges_cad')::numeric,0);
  v_snapshot=v_snapshot || jsonb_build_object('source','measured_waybill_v3','freight_cad',v.freight,
    'freight_cny',round(v.freight/v_fx,2),'duty_cad',v.duty,'insurance_cad',v.insurance,
    'clearance_cad',v.clearance,'actual_weight',v.actual,'volumetric_weight',v.volumetric,
    'chargeable_weight',v.chargeable,'total_cad',v.freight+v.duty+v.insurance+v.clearance+v_extra,
    'fx_rate',v_fx,'computed_at',now(),'min_charge_waybill_cad',0);
  if p_forwarding then
    update public.forwarding_orders set freight_snapshot=v_snapshot,fee_cny=round(v.freight/v_fx,2) where id=p_id;
  else
    update public.orders set freight_snapshot=v_snapshot,shipping_cny=round(v.freight/v_fx,2),
      customs_cny=round(v.duty/v_fx,2),insurance_cny=round(v.insurance/v_fx,2) where id=p_id;
  end if;
end $$;
revoke all on function public.sync_measured_order_fees_v3(uuid,boolean) from public,anon,authenticated;

create or replace function public.on_measured_waybill_fees_v3() returns trigger
language plpgsql security definer set search_path=public as $$ begin
  if tg_op<>'DELETE' then
    perform public.sync_measured_order_fees_v3(new.forwarding_id,true);
    perform public.sync_measured_order_fees_v3(new.order_id,false);
  end if;
  if tg_op='DELETE' then
    perform public.sync_measured_order_fees_v3(old.forwarding_id,true);
    perform public.sync_measured_order_fees_v3(old.order_id,false);
  elsif tg_op='UPDATE' then
    if old.forwarding_id is distinct from new.forwarding_id then perform public.sync_measured_order_fees_v3(old.forwarding_id,true); end if;
    if old.order_id is distinct from new.order_id then perform public.sync_measured_order_fees_v3(old.order_id,false); end if;
  end if;
  return coalesce(new,old);
end $$;
revoke all on function public.on_measured_waybill_fees_v3() from public,anon,authenticated;
drop trigger if exists measured_waybill_fees_v3 on public.waybills;
create trigger measured_waybill_fees_v3 after insert or delete or update of freight_cad,duty_cad,insurance_cad,clearance_cad,weight_snapshot,forwarding_id,order_id on public.waybills
for each row execute function public.on_measured_waybill_fees_v3();
notify pgrst, 'reload schema';
