-- 手动迁移说明：在 Supabase Dashboard > SQL Editor 中完整执行本文件一次。
-- 本迁移不会发送任何企业微信消息，也不会修改现有消息内容；重复执行是安全的。
-- Separate "submitted to WeCom" from "actually sent by the employee".
begin;

alter table public.wecom_notify_messages
  drop constraint if exists wecom_notify_messages_status_check;

alter table public.wecom_notify_messages
  add constraint wecom_notify_messages_status_check
  check (status in (
    'draft',
    'previewed',
    'sending',
    'submitted',
    'waiting_employee_confirmation',
    'sent',
    'partially_failed',
    'preview_only',
    'failed'
  ));

alter table public.wecom_notify_messages
  add column if not exists submitted_at timestamptz;

alter table public.wecom_notify_message_targets
  drop constraint if exists wecom_notify_message_targets_status_check;

alter table public.wecom_notify_message_targets
  add constraint wecom_notify_message_targets_status_check
  check (status in (
    'pending',
    'submitted',
    'waiting_employee_confirmation',
    'sent',
    'failed',
    'skipped_disabled'
  ));

alter table public.wecom_notify_message_targets
  add column if not exists wecom_msgid text,
  add column if not exists sender_userid text,
  add column if not exists submitted_at timestamptz,
  add column if not exists last_checked_at timestamptz;

create index if not exists idx_wecom_notify_targets_msgid
  on public.wecom_notify_message_targets (wecom_msgid)
  where wecom_msgid is not null;

commit;
