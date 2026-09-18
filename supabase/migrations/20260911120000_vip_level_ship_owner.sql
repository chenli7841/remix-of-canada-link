-- ship API 对接第一步：新增两个客户分级选项，供后续 ship 合作方对接使用。
-- 纯粹增加枚举值，不附加任何业务分支：
--   - ship   （中文显示"ship客户"）：后续 ship 合作方客户首单建档成功时由服务端
--     自动设置（本迁移不涉及那一步，只是先让这个值存在），并会被现有的
--     shipping_routes.visible_vip_levels / blacklist_vip_levels 机制拿来做线路可见性
--     判断——这是有意复用现成机制，不是新建一套线路授权配置。
--   - owner  （中文显示"owner"）：纯选项，不驱动任何现有逻辑。
-- 不改动任何读取/校验这个枚举的代码路径；is_route_visible_to_customer 之类的判断
-- 函数已经是通用实现（按值比对，不关心具体有哪些值），加值本身不需要同步改代码。
ALTER TYPE public.vip_level ADD VALUE IF NOT EXISTS 'ship';
ALTER TYPE public.vip_level ADD VALUE IF NOT EXISTS 'owner';
