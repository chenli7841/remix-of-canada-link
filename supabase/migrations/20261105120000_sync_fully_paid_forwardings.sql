do $patch$
declare
 d text := pg_get_functiondef('public.settle_batch_customer_txn(jsonb)'::regprocedure);
 anchor text := 'UPDATE public.waybills SET payment_status = ''paid'' WHERE id = ANY(v_wb_ids);';
begin
 if position('sync_fully_paid_forwardings' in d)>0 then return; end if;
 if position(anchor in d)=0 then raise exception 'Unexpected settlement function'; end if;
 execute replace(d,anchor,$body$
 -- sync_fully_paid_forwardings: serialize final payments from separate batches.
 perform 1 from public.forwarding_orders where id=any(v_fwd_ids) order by id for no key update;
 UPDATE public.waybills SET payment_status = 'paid' WHERE id = ANY(v_wb_ids);
 update public.forwarding_orders f set payment_status='paid'
 where f.id=any(v_fwd_ids) and f.user_id=v_user and f.payment_status='unpaid'
 and not exists (select 1 from public.waybills w where w.forwarding_id=f.id and w.payment_status is distinct from 'paid');
$body$);
end $patch$;

with evidence as materialized (
 select distinct l.entity_id::text as waybill_id,i.user_id from public.admin_action_logs l
 join public.invoices i on i.id::text=l.after->>'invoice_id' and i.batch_no=l.after->>'batch_no'
 where l.entity_type='waybill' and l.action='wallet_deduct_paid' and i.type='batch' and i.status='paid' and i.paid_at is not null
), eligible as (
 select f.id from public.forwarding_orders f join public.waybills w on w.forwarding_id=f.id
 left join evidence e on e.waybill_id=w.id::text and e.user_id=f.user_id
 where f.payment_status='unpaid' group by f.id
 having bool_and(w.payment_status is not distinct from 'paid' and e.waybill_id is not null)
), repaired as (
 update public.forwarding_orders f set payment_status='paid' from eligible e where f.id=e.id and f.payment_status='unpaid'
 returning f.customer_code,f.request_no
)
select count(*) as repaired_orders,count(distinct customer_code) as customers,count(*) filter(where request_no='FWHP032982609150000') as example_repaired from repaired;
