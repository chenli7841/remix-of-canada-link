-- 客户归属销售代表：新增员工角色 sales_rep（跟已有的 "销售" sales 角色是两回事——
-- sales 现在对客户视图是不受限的全量访问；sales_rep 只能看自己名下被分配的客户）。
--
-- ALTER TYPE ... ADD VALUE 不能在事务块内跑，这里跟 vip_level 加 ship/owner 时
-- 用的是同一种写法（见 20260911120000_vip_level_ship_owner.sql）。
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'sales_rep';

-- 客户归属哪个销售代表账号；NULL = 未分配。SET NULL 而不是 CASCADE——销售代表账号
-- 被删掉时，客户记录本身绝不能跟着消失，只是变回未分配。
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sales_rep_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_sales_rep_id ON public.profiles(sales_rep_id) WHERE sales_rep_id IS NOT NULL;

-- 客户视图导航项要让 sales_rep 也能进去（否则分配了也看不到），只加这一个角色，
-- 不动这一行原有的其它角色。admin_nav_items 是生产环境实际读的表，
-- DEFAULT_NAV_GROUPS（route.tsx 里的代码兜底）另外单独改。
UPDATE public.admin_nav_items
SET roles = array_append(roles, 'sales_rep')
WHERE path = '/admin/customer-view' AND NOT ('sales_rep' = ANY(roles));
