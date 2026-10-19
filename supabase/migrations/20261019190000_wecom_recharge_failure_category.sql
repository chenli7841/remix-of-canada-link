begin;
alter table public.wecom_daily_notification_events
  drop constraint if exists wecom_daily_notification_events_category_check;
alter table public.wecom_daily_notification_events
  add constraint wecom_daily_notification_events_category_check
  check (category in ('intake','measurement','batch_price','assisted_payment',
    'batch_shipped','customer_payment','delivery_ready','dispatched','recharge_failed'));
commit;
