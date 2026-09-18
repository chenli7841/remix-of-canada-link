-- API 凭证管理后台导航入口（owner-only，见 docs/ship-api/claude-api-token-admin-page.md）。
-- item_sort_order 追加到「系统管理」组末尾（现有最大值为 13 · 钱包流水），
-- 不需要重排其它行。
INSERT INTO public.admin_nav_items (path, label, icon, group_title, group_sort_order, item_sort_order, roles) VALUES
  ('/admin/api-tokens', 'API 凭证管理', 'KeyRound', '系统管理', 5, 14, ARRAY['owner'])
ON CONFLICT (path) DO NOTHING;
