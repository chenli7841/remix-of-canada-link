begin;
create or replace function public.capture_order_address_snapshot()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 new.address_snapshot:=coalesce(new.address_snapshot,public.delivery_address_snapshot(new.user_id));
 return new;
end $$;
drop trigger if exists capture_order_address_snapshot on public.orders;
create trigger capture_order_address_snapshot before insert on public.orders for each row execute function public.capture_order_address_snapshot();
update public.orders set address_snapshot=public.delivery_address_snapshot(user_id) where address_snapshot is null;
commit;
