-- Daily customer-specific WeCom notification source events.
-- Stage 1 records intake only; later stages add measurement, batch price,
-- assisted payment and shipped-batch events to this same ledger.
create table if not exists public.wecom_daily_notification_events (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  customer_code text not null,
  category text not null check (category in (
    'intake', 'measurement', 'batch_price', 'assisted_payment', 'batch_shipped'
  )),
  source_type text not null,
  source_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (category, source_type, source_id)
);

create index if not exists idx_wecom_daily_events_date_customer
  on public.wecom_daily_notification_events (service_date desc, customer_code);

create index if not exists idx_wecom_daily_events_category_date
  on public.wecom_daily_notification_events (category, service_date desc);

alter table public.wecom_daily_notification_events enable row level security;
revoke all on public.wecom_daily_notification_events from anon, authenticated;
grant all on public.wecom_daily_notification_events to service_role;

comment on table public.wecom_daily_notification_events is
  'Customer-specific source events used to compose the 08:00 America/Toronto WeCom daily message.';

