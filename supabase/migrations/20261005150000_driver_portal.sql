begin;
set local lock_timeout = '5s';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('delivery-proofs','delivery-proofs',false,6291456,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

create table if not exists public.delivery_proof_photos (
  id uuid primary key,
  batch_id uuid not null references public.batches(id),
  customer_code text not null,
  storage_path text not null unique,
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.delivery_proof_photos enable row level security;
revoke all on public.delivery_proof_photos from anon, authenticated;
grant select,insert,delete on public.delivery_proof_photos to service_role;
create index if not exists delivery_proofs_customer_batch on public.delivery_proof_photos(customer_code,batch_id);

-- Only the authenticated server endpoint may call this transaction. No amount,
-- wallet owner, driver identity or queue IDs are accepted from the browser.
create or replace function public.driver_delivery_action(
  _actor uuid, _batch uuid, _customer text, _action text,
  _note text default '', _expected_cad numeric default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  target_user uuid; amount numeric; fx numeric; fee numeric; balance numeric;
  reference text; affected integer; actor_name text;
begin
  if not coalesce(public.has_role(_actor,'driver'),false) then raise exception '仅派送司机可以操作'; end if;
  if _action not in ('deduct','dispatch','note') then raise exception '不支持的操作'; end if;
  if _customer !~ '^[0-9]{5}$' or length(coalesce(_note,'')) > 2000 then raise exception '客户号或备注无效'; end if;
  perform pg_advisory_xact_lock(hashtextextended('driver:'||_batch::text||':'||_customer,0));
  select id into target_user from public.profiles where customer_code=_customer;
  if target_user is null then raise exception '客户不存在'; end if;
  select coalesce(nullif(trim(full_name),''),'派送司机') into actor_name from public.profiles where id=_actor;
  perform id from public.delivery_queue where source_batch_id=_batch and customer_code=_customer
    and status='pending' order by id for update;
  if not found then raise exception '该客户批次已不在待派送列表，请刷新'; end if;
  if exists(select 1 from public.delivery_queue where source_batch_id=_batch and customer_code=_customer
    and status='pending' and customer_user_id is not null and customer_user_id<>target_user) then
    raise exception '客户归属不一致，请联系管理员';
  end if;
  if _action='note' then
    insert into public.batch_customer_notes(batch_id,customer_code,note,updated_by,updated_at)
      values(_batch,_customer,trim(coalesce(_note,'')),_actor,now())
      on conflict(batch_id,customer_code) do update set note=excluded.note,updated_by=_actor,updated_at=now();
  elsif _action='dispatch' then
    update public.delivery_queue set status='dispatched',dispatched_by=_actor
      where source_batch_id=_batch and customer_code=_customer and status='pending';
    get diagnostics affected=row_count;
  else
    reference := 'delivery-extra:'||_batch::text||':'||_customer;
    if exists(select 1 from public.wallet_transactions where ref_no=reference and status='completed') then
      return jsonb_build_object('ok',true,'alreadyPaid',true);
    end if;
    select extra_fee_cny into fee from public.batch_customer_notes
      where batch_id=_batch and customer_code=_customer for update;
    if coalesce(fee,0)<=0 then raise exception '没有需要扣款的额外费用'; end if;
    select case when (value->>'cny_per_cad')::numeric>0 then round(1/(value->>'cny_per_cad')::numeric,6) else 0.19 end
      into fx from public.app_settings where key='fx_rate';
    amount:=round(fee*coalesce(fx,0.19),2);
    if _expected_cad is null or amount<>_expected_cad then raise exception '费用或汇率已改变，请刷新后确认'; end if;
    select balance_cad into balance from public.wallets where user_id=target_user for update;
    if balance is null or balance<amount then raise exception '客户余额不足，请联系管理员处理'; end if;
    begin
      insert into public.wallet_transactions(user_id,type,amount_cad,status,channel,ref_no,note)
        values(target_user,'spend',amount,'completed','admin',reference,
          '司机扣取派送额外费用 · 客户 '||_customer||' · 批次 '||_batch::text);
    exception when unique_violation then
      if exists(select 1 from public.wallet_transactions where ref_no=reference and status='completed') then
        return jsonb_build_object('ok',true,'alreadyPaid',true);
      end if;
      raise;
    end;
  end if;
  insert into public.admin_action_logs(entity_type,entity_id,action,operator_id,operator_name,note,after)
    values('batch',_batch,case _action when 'deduct' then '司机扣取额外费用' when 'dispatch' then '司机确认派送' else '司机修改结算备注' end,
      _actor,actor_name,'客户 '||_customer,
      jsonb_build_object('customer_code',_customer,'amount_cad',amount,'note',case when _action='note' then trim(_note) else null end,'count',affected));
  return jsonb_build_object('ok',true,'alreadyPaid',false);
end $$;
revoke all on function public.driver_delivery_action(uuid,uuid,text,text,text,numeric) from public,anon,authenticated;
grant execute on function public.driver_delivery_action(uuid,uuid,text,text,text,numeric) to service_role;
commit;
