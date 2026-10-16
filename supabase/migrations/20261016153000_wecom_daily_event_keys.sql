-- Intake is deduplicated for the lifetime of a waybill, while measurement can
-- be revised repeatedly during one send date and sent again on a later date.
alter table public.wecom_daily_notification_events
  add column if not exists event_key text;

update public.wecom_daily_notification_events
set event_key = category || ':' || source_type || ':' || source_id::text
where event_key is null;

alter table public.wecom_daily_notification_events
  alter column event_key set not null;

alter table public.wecom_daily_notification_events
  drop constraint if exists wecom_daily_notification_events_category_source_type_source_id_key;

create unique index if not exists wecom_daily_notification_events_event_key_key
  on public.wecom_daily_notification_events (event_key);

