begin;
alter table public.forwarding_orders add column if not exists address_snapshot jsonb;
alter table public.delivery_queue add column if not exists address_snapshot jsonb;

create or replace function public.delivery_address_snapshot(_user uuid,_address uuid default null)
returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce((select jsonb_build_object('recipient',a.recipient,'phone',a.phone,'line1',a.line1,'line2',a.line2,'city',a.city,'province',a.province,'country',a.country,'postal_code',a.postal_code,'destination_code',a.destination_code) from addresses a where a.user_id=_user and (_address is null or a.id=_address) order by a.is_default desc,a.created_at,a.id limit 1),
 (select jsonb_build_object('recipient',p.full_name,'phone',coalesce(p.reg_phone,p.phone),'line1',p.reg_address,'line2','','city',p.reg_city,'province',p.reg_province,'country',p.reg_country,'postal_code',p.reg_postal_code) from profiles p where p.id=_user),'{}'::jsonb)
$$;
revoke all on function public.delivery_address_snapshot(uuid,uuid) from public,anon,authenticated;

create or replace function public.capture_forwarding_address_snapshot()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='INSERT' then new.address_snapshot:=coalesce(new.address_snapshot,public.delivery_address_snapshot(new.user_id,new.address_id));
 elsif old.address_snapshot is not null and not public.is_staff(auth.uid()) and auth.role() is distinct from 'service_role' then new.address_snapshot:=old.address_snapshot;
 end if;
 return new;
end $$;
drop trigger if exists capture_forwarding_address_snapshot on public.forwarding_orders;
create trigger capture_forwarding_address_snapshot before insert or update on public.forwarding_orders for each row execute function public.capture_forwarding_address_snapshot();
update public.forwarding_orders set address_snapshot=public.delivery_address_snapshot(user_id,address_id) where address_snapshot is null;

create or replace function public.capture_delivery_queue_address_snapshot()
returns trigger language plpgsql security definer set search_path=public as $$
declare snap jsonb; uid uuid;
begin
 if new.address_snapshot is not null then return new; end if;
 uid:=coalesce(new.customer_user_id,(select id from profiles where customer_code=new.customer_code limit 1));
 if new.kind='carton' then select address_snapshot into snap from cartons where id=new.ref_id;
 elsif new.kind='pallet' then select address_snapshot into snap from pallets where id=new.ref_id;
 elsif new.kind='waybill' then
 select coalesce(o.address_snapshot,f.address_snapshot) into snap from waybills w left join orders o on o.id=w.order_id left join forwarding_orders f on f.id=w.forwarding_id where w.id=new.ref_id;
 end if;
 new.address_snapshot:=coalesce(nullif(snap,'{}'::jsonb),public.delivery_address_snapshot(uid));
 return new;
end $$;
drop trigger if exists capture_delivery_queue_address_snapshot on public.delivery_queue;
create trigger capture_delivery_queue_address_snapshot before insert on public.delivery_queue for each row execute function public.capture_delivery_queue_address_snapshot();
-- Freeze exactly the address currently displayed for existing units. Preserve saved
-- trip addresses where available; do not silently reroute historical shipments.
update public.delivery_queue q set address_snapshot=public.delivery_address_snapshot(coalesce(q.customer_user_id,(select id from profiles where customer_code=q.customer_code limit 1))) where address_snapshot is null;
with saved as (
 select distinct on (qid.value) qid.value as queue_id,c.value as customer
 from driver_trips t cross join lateral jsonb_array_elements(t.route->'plans') p
 cross join lateral jsonb_array_elements(p.value->'stops') s
 cross join lateral jsonb_array_elements(s.value->'customers') c
 cross join lateral jsonb_array_elements_text(c.value->'ids') qid
 order by qid.value,t.generated_at desc nulls last,t.created_at desc
)
update public.delivery_queue q set address_snapshot=q.address_snapshot||coalesce(saved.customer#>'{groups,0,editable_address}','{}'::jsonb)||jsonb_build_object('formatted_address',saved.customer->>'address','phone',coalesce(saved.customer->>'phone',q.address_snapshot->>'phone')) from saved where q.id::text=saved.queue_id and coalesce(saved.customer->>'address','')<>'';

create or replace function public.update_delivery_unit_address(_actor uuid,_ids uuid[],_expected jsonb,_address jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare n integer; uid uuid; bid uuid;
begin
 if not public.is_staff(_actor) or (auth.role() is distinct from 'service_role' and auth.uid() is distinct from _actor) then raise exception 'Forbidden'; end if;
 if coalesce(cardinality(_ids),0)=0 or cardinality(_ids)>10000 then raise exception '请选择派送单元'; end if;
 if coalesce(trim(_address->>'line1'),'')='' then raise exception '请填写详细地址'; end if;
 perform 1 from delivery_queue where id=any(_ids) order by id for update;
 select count(*) into n from delivery_queue where id=any(_ids) and status='pending' and address_snapshot is not distinct from (_expected->id::text);
 if n<>cardinality(_ids) then raise exception '派送地址或状态已变化，请刷新列表后重试'; end if;
 update delivery_queue set address_snapshot=(coalesce(address_snapshot,'{}'::jsonb)-'formatted_address')||_address,updated_at=now() where id=any(_ids);
 insert into admin_action_logs(entity_type,entity_id,action,operator_id,before,after,note) values('delivery_queue',_ids[1]::text,'修改本次派送地址',_actor,_expected,jsonb_build_object('ids',_ids,'address',_address),'同步关联上车/派送趟显示；不修改地址簿和原订单');
 return jsonb_build_object('ok',true,'count',n);
end $$;
revoke all on function public.update_delivery_unit_address(uuid,uuid[],jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.update_delivery_unit_address(uuid,uuid[],jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
