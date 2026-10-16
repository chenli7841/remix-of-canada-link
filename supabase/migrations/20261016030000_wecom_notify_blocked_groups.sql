-- 企业微信群永久屏蔽：屏蔽后不进入新任务，也不会从旧草稿中实际发送。
begin;

alter table public.wecom_notify_groups
  add column if not exists is_blocked boolean not null default false,
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_by uuid references public.profiles(id);

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
    'skipped_disabled',
    'skipped_blocked'
  ));

commit;
