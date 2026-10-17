-- Keep the daily WeCom event ledger compatible with every notification
-- category currently produced by the application.
begin;

alter table public.wecom_daily_notification_events
  alter column source_id type text using source_id::text;

alter table public.wecom_daily_notification_events
  drop constraint if exists wecom_daily_notification_events_category_check;

alter table public.wecom_daily_notification_events
  add constraint wecom_daily_notification_events_category_check
  check (category in (
    'intake',
    'measurement',
    'batch_price',
    'assisted_payment',
    'batch_shipped',
    'customer_payment',
    'delivery_ready',
    'dispatched'
  ));

commit;
