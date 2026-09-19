-- EPLUS 群发通知（企业微信客户群发，独立应用 AgentId 1000005）。
-- 跟现有「微信客服 AI」（wechat_kf_* 那一整套）完全独立：单独的凭证、单独的表，
-- 互不调用、互不影响。本阶段只在测试域名验证；真实发送前必须先完成企业微信应用
-- 授权 + 可信出口 IP 白名单联调，服务端用 WECOM_ENABLED（默认 false）总开关兜底，
-- 见 src/lib/wecom-notify/config.server.ts。

-- access_token 缓存，跟 wechat_kf_token 同样的套路，但是独立一张表 / 独立凭证。
create table if not exists public.wecom_notify_token (
  id text primary key default 'notify',
  access_token text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- 从企业微信「客户群」接口同步回来的群基础信息。
create table if not exists public.wecom_notify_groups (
  chat_id text primary key,
  name text not null default '',
  owner_userid text,
  member_count int not null default 0,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 客户 ↔ 专属群绑定，一个客户对应一个专属群（1:1，两边都加唯一约束）。
create table if not exists public.wecom_notify_bindings (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,
  chat_id text not null unique references public.wecom_notify_groups(chat_id) on delete cascade,
  bound_by uuid references public.profiles(id),
  bound_at timestamptz not null default now()
);

-- 一次群发任务。真正调用企业微信发送之前会一直停在 draft/previewed；
-- WECOM_ENABLED=false 时点"发送"只会落成 preview_only，绝不冒充已发送。
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

-- 群发任务按客户展开后的逐条目标：预览阶段用它展示"发给谁、发什么内容"，
-- 真正发送后用它记录每一条的送达状态。
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

-- 只有 service_role 能碰这些表——全部通过后台 owner-only 的 server function 走
-- supabaseAdmin 读写，RLS 打开但不加策略 = 对 anon/authenticated 全部拒绝，
-- 跟 partner_api_tokens 是同一个套路。
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

-- 群发通知后台导航入口（owner-only）。系统管理组现有最大 item_sort_order 为 14
-- （API 凭证管理），这里追加到 15，不需要重排其它行。
insert into public.admin_nav_items (path, label, icon, group_title, group_sort_order, item_sort_order, roles) values
  ('/admin/wecom-notify', '群发通知', 'Megaphone', '系统管理', 5, 15, array['owner'])
on conflict (path) do nothing;
