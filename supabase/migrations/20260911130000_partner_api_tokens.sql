-- ship API 鉴权地基：合作方 API 凭证表。
-- 独立于现有微信 Basic Auth / 网页 Cookie 登录 / MCP OAuth，只给 /api/partners/v1/*
-- 这条新增的接口线用。不存明文 token，只存哈希（sha256 hex），校验时把请求头里的
-- token 现算哈希去比对——数据库泄露也拿不到可用凭证。
create table if not exists public.partner_api_tokens (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null,               -- 合作方标识，本轮固定 'ship'；预留给未来其他合作方
  name text,                               -- 人类可读标签，例如 "ship 生产环境业务凭证"
  token_hash text not null unique,         -- sha256(token) 的十六进制串
  scopes text[] not null default '{}',     -- routes:read / orders:read / orders:write /
                                            -- customers:write / orders:fees:read
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles(id),
  last_used_at timestamptz
);

create index if not exists idx_partner_api_tokens_partner_key on public.partner_api_tokens (partner_key);

-- 只有 service_role 能碰这张表——校验 token 走 supabaseAdmin（service_role），
-- 从不通过带用户会话的客户端读写；RLS 打开但不加任何策略 = 对 anon/authenticated 全部拒绝。
alter table public.partner_api_tokens enable row level security;

revoke all on public.partner_api_tokens from anon, authenticated;
grant all on public.partner_api_tokens to service_role;
