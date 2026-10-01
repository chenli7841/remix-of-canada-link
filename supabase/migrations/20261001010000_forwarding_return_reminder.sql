begin;
alter table public.forwarding_orders add column if not exists return_reminder boolean not null default false;
comment on column public.forwarding_orders.return_reminder is '退运提醒：入库、装箱、装托和加入批次时检查，随容器逐级提示，人工关闭前持续生效';
commit;
