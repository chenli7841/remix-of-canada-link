-- Admin sidebar navigation becomes owner-configurable: which roles can see
-- each item, which category (group) it lives in, and the display order of
-- both groups and items within them. Written/read only by server code
-- (service role) — RLS is enabled with no policies, so it's unreachable via
-- anon/authenticated; the admin layout fetches it through a staff-gated
-- server function, and edits go through an owner-gated one.
CREATE TABLE IF NOT EXISTS public.admin_nav_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path text NOT NULL UNIQUE,
  label text NOT NULL,
  icon text NOT NULL,
  group_title text NOT NULL DEFAULT '',
  group_sort_order integer NOT NULL DEFAULT 0,
  item_sort_order integer NOT NULL DEFAULT 0,
  roles text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_nav_items ENABLE ROW LEVEL SECURITY;

-- Seed with the nav exactly as it existed before this became configurable,
-- so nothing changes for anyone until an owner edits it.
INSERT INTO public.admin_nav_items (path, label, icon, group_title, group_sort_order, item_sort_order, roles) VALUES
  ('/admin', '运营概览', 'LayoutDashboard', '', 0, 0, ARRAY['owner','manager','warehouse_cn','warehouse_ca','sales','support']),

  ('/admin/intake-scan', '入库扫描', 'ScanLine', '发货仓库操作', 1, 0, ARRAY['owner','manager','warehouse_cn','support']),
  ('/admin/measure', '量尺称重', 'Ruler', '发货仓库操作', 1, 1, ARRAY['owner','manager','warehouse_cn','support']),
  ('/admin/detained', '滞留单号', 'AlertTriangle', '发货仓库操作', 1, 2, ARRAY['owner','manager','warehouse_cn','support']),
  ('/admin/cartons', '箱号管理', 'Package', '发货仓库操作', 1, 3, ARRAY['owner','manager','warehouse_cn','support']),
  ('/admin/pallets', '托盘管理', 'Layers', '发货仓库操作', 1, 4, ARRAY['owner','manager','warehouse_cn','support']),
  ('/admin/batches', '批次管理', 'Truck', '发货仓库操作', 1, 5, ARRAY['owner','manager','warehouse_cn','support']),

  ('/admin/receivings', '收货管理', 'PackageCheck', '收货仓库操作', 2, 0, ARRAY['owner','manager','warehouse_ca','support']),
  ('/admin/delivery-queue', '待派送列表', 'Truck', '收货仓库操作', 2, 1, ARRAY['owner','manager','warehouse_ca','support']),
  ('/admin/waybills', '集运单到货 / 派送', 'Truck', '收货仓库操作', 2, 2, ARRAY['owner','manager','warehouse_ca','support']),

  ('/admin/orders', '电商订单', 'ShoppingBag', '订单 / 集运单查询', 3, 0, ARRAY['owner','manager','warehouse_cn','warehouse_ca','support']),
  ('/admin/forwardings', '集运订单', 'Boxes', '订单 / 集运单查询', 3, 1, ARRAY['owner','manager','warehouse_cn','warehouse_ca','support']),
  ('/admin/history', '历史记录', 'History', '订单 / 集运单查询', 3, 2, ARRAY['owner','manager','warehouse_cn','warehouse_ca','support']),
  ('/admin/invoices', '账单管理', 'FileText', '订单 / 集运单查询', 3, 3, ARRAY['owner','manager','warehouse_cn','warehouse_ca','support']),

  ('/admin/shop', '电商概览', 'ShoppingBag', '电商管理', 4, 0, ARRAY['owner','manager','sales']),
  ('/admin/shop/orders', '电商订单', 'ShoppingBag', '电商管理', 4, 1, ARRAY['owner','manager','sales']),
  ('/admin/shop/orders/procurement', '代采购列表', 'Truck', '电商管理', 4, 2, ARRAY['owner','manager','sales']),
  ('/admin/shop/products', '商品管理', 'Package', '电商管理', 4, 3, ARRAY['owner','manager','sales']),
  ('/admin/shop/categories', '商品分类', 'Tag', '电商管理', 4, 4, ARRAY['owner','manager','sales']),
  ('/admin/shop/inventory', '库存流水', 'Boxes', '电商管理', 4, 5, ARRAY['owner','manager','sales']),
  ('/admin/shop/coupons', '优惠券', 'Tag', '电商管理', 4, 6, ARRAY['owner','manager','sales']),
  ('/admin/shop/banners', 'Banner 装修', 'Image', '电商管理', 4, 7, ARRAY['owner','manager','sales']),
  ('/admin/shop/articles', '文章管理', 'FileText', '电商管理', 4, 8, ARRAY['owner','manager','sales']),

  ('/admin/customer-view', '客户视图', 'UserSearch', '系统管理', 5, 0, ARRAY['owner']),
  ('/admin/users', '用户管理', 'Users', '系统管理', 5, 1, ARRAY['owner','manager']),
  ('/admin/messages', '留言信息', 'Mail', '系统管理', 5, 2, ARRAY['owner','manager']),
  ('/admin/logs', '操作日志', 'History', '系统管理', 5, 3, ARRAY['owner','manager']),
  ('/admin/system', '系统设置', 'Settings', '系统管理', 5, 4, ARRAY['owner','manager']),
  ('/admin/warehouses', '仓库管理', 'Warehouse', '系统管理', 5, 5, ARRAY['owner','manager']),
  ('/admin/routes', '线路 / 运费', 'Route', '系统管理', 5, 6, ARRAY['owner','manager']),
  ('/admin/cargo-types', '货物类型', 'Tag', '系统管理', 5, 7, ARRAY['owner','manager']),
  ('/admin/destinations', '目的地', 'MapPin', '系统管理', 5, 8, ARRAY['owner','manager']),
  ('/admin/tracking-presets', '轨迹预设', 'Settings', '系统管理', 5, 9, ARRAY['owner','manager']),
  ('/admin/oversize-rules', '超大件规则', 'Ruler', '系统管理', 5, 10, ARRAY['owner','manager']),
  ('/admin/hs-codes', 'HS 编码库', 'BookText', '系统管理', 5, 11, ARRAY['owner','manager']),
  ('/admin/nav-settings', '菜单权限设置', 'ShieldCheck', '系统管理', 5, 12, ARRAY['owner'])
ON CONFLICT (path) DO NOTHING;
