-- One editable pre-send message per customer and Toronto service date.
-- Source events continuously update sections/rendered_content until the daily
-- task is submitted. edited_content is reserved for the admin review UI.
create table if not exists public.wecom_daily_notification_drafts (
  id uuid primary key default gen_random_uuid(),
  service_date date not null,
  customer_code text not null,
  sections jsonb not null default '{}'::jsonb,
  rendered_content text not null default '',
  edited_content text,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'sent', 'partially_failed', 'failed')),
  message_id uuid references public.wecom_notify_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  sent_at timestamptz,
  unique (service_date, customer_code)
);

create index if not exists idx_wecom_daily_drafts_date_status
  on public.wecom_daily_notification_drafts (service_date desc, status);

alter table public.wecom_daily_notification_drafts enable row level security;
revoke all on public.wecom_daily_notification_drafts from anon, authenticated;
grant all on public.wecom_daily_notification_drafts to service_role;

comment on table public.wecom_daily_notification_drafts is
  'Editable customer-specific pre-send messages composed throughout each Toronto service day.';

