create table if not exists public.wecom_notify_token (
  id text primary key default 'notify',
  access_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.wecom_notify_groups (
  chat_id text primary key,
  name text not null default '',
  owner_userid text,
  member_count int not null default 0,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.wecom_notify_bindings (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,
  chat_id text not null unique references public.wecom_notify_groups(chat_id) on delete cascade,
  bound_by uuid references public.profiles(id),
  bound_at timestamptz not null default now()
);

create table if not exists public.wecom_notify_messages (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  content_template text not null,
  target_scope text not null default 'selected' check (target_scope in ('all_bound', 'selected')),
  target_customer_codes text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'previewed', 'sending', 'sent', 'preview_only', 'failed')),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  send_result jsonb
);

create table if not exists public.wecom_notify_message_targets (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.wecom_notify_messages(id) on delete cascade,
  customer_code text not null,
  chat_id text not null,
  rendered_content text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'skipped_disabled')),
  error text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_wecom_notify_message_targets_message_id
  on public.wecom_notify_message_targets (message_id);

alter table public.wecom_notify_token enable row level security;
alter table public.wecom_notify_groups enable row level security;
alter table public.wecom_notify_bindings enable row level security;
alter table public.wecom_notify_messages enable row level security;
alter table public.wecom_notify_message_targets enable row level security;

revoke all on public.wecom_notify_token, public.wecom_notify_groups, public.wecom_notify_bindings,
  public.wecom_notify_messages, public.wecom_notify_message_targets
  from anon, authenticated;
grant all on public.wecom_notify_token, public.wecom_notify_groups, public.wecom_notify_bindings,
  public.wecom_notify_messages, public.wecom_notify_message_targets
  to service_role;

insert into public.admin_nav_items (path, label, icon, group_title, group_sort_order, item_sort_order, roles) values
  ('/admin/wecom-notify', '群发通知', 'Megaphone', '系统管理', 5, 15, array['owner'])
on conflict (path) do nothing;