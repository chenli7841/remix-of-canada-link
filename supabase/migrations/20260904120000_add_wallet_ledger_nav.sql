-- 钱包流水（充值/扣款流水，按渠道与日期筛选）后台导航入口。
-- item_sort_order 是整数列，追加到「系统管理」组末尾（现有最大值为 12 · 菜单权限设置），
-- 不需要重排其它行。
INSERT INTO public.admin_nav_items (path, label, icon, group_title, group_sort_order, item_sort_order, roles) VALUES
  ('/admin/wallet-ledger', '钱包流水', 'Wallet', '系统管理', 5, 13, ARRAY['owner','manager'])
ON CONFLICT (path) DO NOTHING;
