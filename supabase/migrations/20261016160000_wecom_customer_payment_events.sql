-- Customer payment notices use a customer code as source_id, while existing
-- event categories use UUIDs. Text preserves both, including leading zeroes.
begin;

alter table public.wecom_daily_notification_events
  alter column source_id type text using source_id::text;

alter table public.wecom_daily_notification_events
  drop constraint if exists wecom_daily_notification_events_category_check;

alter table public.wecom_daily_notification_events
  add constraint wecom_daily_notification_events_category_check
  check (category in (
    'intake', 'measurement', 'batch_price', 'assisted_payment',
    'batch_shipped', 'customer_payment'
  ));

commit;
