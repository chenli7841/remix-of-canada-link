alter table public.wecom_daily_notification_drafts add column if not exists images jsonb not null default '[]'::jsonb;
alter table public.wecom_notify_messages add column if not exists images jsonb not null default '[]'::jsonb;
