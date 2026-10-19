-- Run after migration. Only temporary rows are created; every counter change rolls back.
begin;
create temp table invoice_number_test(invoice_no text unique) on commit drop;
create trigger test_number before insert on invoice_number_test
for each row execute function public.gen_invoice_no_fn();
do $$
declare a text; b text; c text; ds text:=to_char(now(),'YYYYMMDD');
begin
  insert into invoice_number_test default values returning invoice_no into a;
  insert into invoice_number_test default values returning invoice_no into b;
  if a=b or exists(select 1 from public.invoices where invoice_no in (a,b)) then
    raise exception 'new numbers collided';
  end if;
  delete from invoice_number_test where invoice_no=b;
  insert into invoice_number_test default values returning invoice_no into c;
  if substring(c from 12)::bigint <= substring(b from 12)::bigint then
    raise exception 'deleted number reused';
  end if;
  insert into invoice_number_test values('EXPLICIT-TEST');
  update public.invoice_number_counters set last_value=greatest(last_value,9999) where date_key=ds;
  insert into invoice_number_test default values returning invoice_no into c;
  if substring(c from 12)::bigint<10000 then raise exception 'suffix truncated'; end if;
end $$;
select 'PASS: unique allocation, deletion, explicit numbers, five-digit suffix' as result;
rollback;
