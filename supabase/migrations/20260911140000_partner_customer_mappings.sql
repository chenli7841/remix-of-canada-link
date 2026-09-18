-- ship API 客户身份映射：合作方自己的客户 ID <-> 本地 profiles.id。
-- 只存映射关系，不复制姓名/邮箱/订单/费用（那些就活在 profiles/orders 自己身上）。
-- 结算/销售账户归属这一轮不做，留给后续扣款端口功能一起设计（见
-- docs/ship-api/system-change-guide-v3.md 第 3 节的 v3 修订）。
create table if not exists public.partner_customer_mappings (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null,               -- 合作方标识，本轮固定 'ship'
  external_customer_id text not null,      -- 合作方那边的客户唯一 ID
  local_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 同一合作方下，一个外部客户号只能对应一条本地档案；反过来，一条本地档案在同一个
-- 合作方下也只能被一个外部客户号占用——防止并发建档产生第二条映射，也防止误把
-- 两个外部客户号错误地指向同一个本地人。
create unique index if not exists idx_partner_customer_mappings_external
  on public.partner_customer_mappings (partner_key, external_customer_id);
create unique index if not exists idx_partner_customer_mappings_local
  on public.partner_customer_mappings (partner_key, local_user_id);

alter table public.partner_customer_mappings enable row level security;
revoke all on public.partner_customer_mappings from anon, authenticated;
grant all on public.partner_customer_mappings to service_role;
