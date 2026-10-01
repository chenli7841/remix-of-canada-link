begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Serialize claims across both parent order tables, including concurrent API calls.
-- Historical duplicates retain all owners until corrected; no order is reassigned.
lock table public.forwarding_orders, public.orders in share row exclusive mode;
create table public.domestic_tracking_claims (
  tracking_no text primary key,
  owners text[] not null
);
alter table public.domestic_tracking_claims enable row level security;
revoke all on public.domestic_tracking_claims from public, anon, authenticated;

insert into public.domestic_tracking_claims(tracking_no, owners)
select tracking_no, array_agg(owner order by owner)
from (
  select nullif(upper(btrim(domestic_tracking_no)), '') tracking_no,
    'forwarding_orders:' || id::text owner from public.forwarding_orders
  union all
  select nullif(upper(btrim(domestic_tracking_no)), ''),
    'orders:' || id::text from public.orders
) existing where tracking_no is not null group by tracking_no;

create function public.enforce_domestic_tracking_claim() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  old_key text;
  new_key text;
  owner_key text;
  claimed text;
begin
  if TG_OP <> 'INSERT' then
    old_key := nullif(upper(btrim(OLD.domestic_tracking_no)), '');
    owner_key := TG_TABLE_NAME || ':' || OLD.id::text;
  end if;
  if TG_OP <> 'DELETE' then
    new_key := nullif(upper(btrim(NEW.domestic_tracking_no)), '');
    owner_key := TG_TABLE_NAME || ':' || NEW.id::text;
  end if;
  if TG_OP = 'UPDATE' and NEW.id is distinct from OLD.id then
    raise exception '订单 ID 不允许修改';
  end if;
  -- Other edits to existing duplicate orders must remain possible.
  if TG_OP = 'UPDATE' and new_key is not distinct from old_key then
    return NEW;
  end if;
  if new_key is not null then
    insert into public.domestic_tracking_claims as c(tracking_no, owners)
    values(new_key, array[owner_key])
    on conflict(tracking_no) do update set owners = excluded.owners
      where cardinality(c.owners) = 0 or c.owners = excluded.owners
    returning tracking_no into claimed;
    if claimed is null then
      raise exception using errcode = '23505',
        message = '国内单号已被其他订单使用，请核对后重试',
        constraint = 'domestic_tracking_global_unique';
    end if;
  end if;
  if old_key is not null then
    update public.domestic_tracking_claims
      set owners = array_remove(owners, owner_key) where tracking_no = old_key;
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end;
$$;
revoke all on function public.enforce_domestic_tracking_claim() from public, anon, authenticated;
create trigger domestic_tracking_claim before insert or update or delete
on public.forwarding_orders for each row execute function public.enforce_domestic_tracking_claim();
create trigger domestic_tracking_claim before insert or update or delete
on public.orders for each row execute function public.enforce_domestic_tracking_claim();

alter table public.forwarding_orders
  add column created_by uuid,
  add column creation_source text,
  add column creator_name text;
comment on column public.forwarding_orders.created_by is '实际创建人 auth.uid()；历史或系统接口未提供用户身份时为空，不能用归属客户代填';

create function public.capture_forwarding_creator() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if TG_OP = 'UPDATE' then
    NEW.created_by := OLD.created_by;
    NEW.creation_source := OLD.creation_source;
    NEW.creator_name := OLD.creator_name;
    return NEW;
  end if;
  NEW.created_by := auth.uid();
  NEW.creator_name := null;
  if NEW.created_by is null then
    NEW.creation_source := 'system_api';
  else
    NEW.creation_source := case when public.is_staff(NEW.created_by)
      then 'staff' else 'customer' end;
    select coalesce(nullif(full_name, ''), email, id::text) into NEW.creator_name
      from public.profiles where id = NEW.created_by;
  end if;
  return NEW;
end;
$$;
revoke all on function public.capture_forwarding_creator() from public, anon, authenticated;
create trigger capture_forwarding_creator before insert or update
on public.forwarding_orders for each row execute function public.capture_forwarding_creator();

create function public.audit_forwarding_creation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.admin_action_logs(entity_type, entity_id, action, after,
    operator_id, operator_name, note)
  values ('forwarding', NEW.id, 'create_forwarding',
    jsonb_build_object('request_no', NEW.request_no, 'creation_source', NEW.creation_source,
      'owner_user_id', NEW.user_id, 'created_by', NEW.created_by),
    NEW.created_by, coalesce(NEW.creator_name, '系统／接口'), '创建集运单');
  return NEW;
end;
$$;
revoke all on function public.audit_forwarding_creation() from public, anon, authenticated;
create trigger audit_forwarding_creation after insert on public.forwarding_orders
for each row execute function public.audit_forwarding_creation();
commit;
