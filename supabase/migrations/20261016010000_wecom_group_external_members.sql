-- 企业微信群中的外部联系人。企业微信不会向应用开放客户的真实微信号，
-- userid 字段在外部联系人场景中是 external_userid，可用于稳定识别和绑定。
create table if not exists public.wecom_notify_group_members (
  chat_id text not null references public.wecom_notify_groups(chat_id) on delete cascade,
  external_userid text not null,
  display_name text not null default '',
  synced_at timestamptz not null default now(),
  primary key (chat_id, external_userid)
);

create index if not exists idx_wecom_notify_group_members_external_userid
  on public.wecom_notify_group_members (external_userid);

alter table public.wecom_notify_group_members enable row level security;
revoke all on public.wecom_notify_group_members from anon, authenticated;
grant all on public.wecom_notify_group_members to service_role;
