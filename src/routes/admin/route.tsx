import { createFileRoute, Link, Outlet, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyRoles, type AppRole } from "@/lib/admin.functions";
import { listNavItems } from "@/lib/admin-nav.functions";
import { ROLE_LABEL, ROLE_COLOR, ADMIN_CONSOLE_ROLES } from "@/lib/admin-roles";
import { useAuth } from "@/lib/auth";
import { useCompanyInfo } from "@/lib/company";
import {
  LayoutDashboard,
  Users,
  Boxes,
  Truck,
  Route as RouteIcon,
  Warehouse,
  Settings as SettingsIcon,
  LogOut,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Loader2,
  Package,
  Layers,
  Tag,
  MapPin,
  ScanLine,
  AlertTriangle,
  FileText,
  History,
  Ruler,
  ShoppingBag,
  Image as ImageIcon,
  BookText,
  PackageCheck,
  Mail,
  UserSearch,
  Bot,
  Wallet,
} from "lucide-react";

export const Route = createFileRoute("/admin")({
  ssr: false,
  head: () => ({
    meta: [{ title: "管理后台 / Admin — SinoCargo" }, { name: "robots", content: "noindex,nofollow" }],
  }),
  beforeLoad: async ({ location }) => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/admin-login", search: { redirect: location.href } });
    }
  },
  component: AdminLayout,
});

// `roles` on an item overrides its group's roles for that one link — used
// to lock down a single sensitive item (e.g. 客户视图: owner-only) inside an
// otherwise owner+manager group without splitting it into its own group.
type NavItem = { to: string; label: string; icon: any; soon?: boolean; roles?: AppRole[] };
type NavGroup = { title: string; items: NavItem[]; roles: AppRole[] };

const OWNER_MANAGER: AppRole[] = ["owner", "manager"];

// Icon lookup for admin_nav_items.icon (a plain string in the DB) — must
// cover every icon name used by DEFAULT_NAV_GROUPS below and by anything an
// owner picks in the nav settings page.
const NAV_ICONS: Record<string, any> = {
  LayoutDashboard,
  Users,
  Boxes,
  Truck,
  Route: RouteIcon,
  Warehouse,
  Settings: SettingsIcon,
  Package,
  Layers,
  Tag,
  MapPin,
  ScanLine,
  AlertTriangle,
  FileText,
  History,
  Ruler,
  ShoppingBag,
  Image: ImageIcon,
  BookText,
  PackageCheck,
  Mail,
  UserSearch,
  ShieldCheck,
  Bot,
  Wallet,
};

// Fallback only — used before admin_nav_items has loaded (or if it's ever
// empty, e.g. a fresh environment where the seed migration hasn't run).
// The real, owner-editable source of truth is the admin_nav_items table;
// see src/routes/admin/nav-settings.tsx.
const DEFAULT_NAV_GROUPS: NavGroup[] = [
  {
    title: "",
    roles: ADMIN_CONSOLE_ROLES,
    items: [{ to: "/admin", label: "运营概览", icon: LayoutDashboard }],
  },
  {
    title: "发货仓库操作",
    roles: [...OWNER_MANAGER, "warehouse_cn", "support"],
    items: [
      { to: "/admin/intake-scan", label: "入库扫描", icon: ScanLine },
      { to: "/admin/measure", label: "量尺称重", icon: Ruler },
      { to: "/admin/detained", label: "滞留单号", icon: AlertTriangle },
      { to: "/admin/cartons", label: "箱号管理", icon: Package },
      { to: "/admin/pallets", label: "托盘管理", icon: Layers },
      { to: "/admin/batches", label: "批次管理", icon: Truck },
    ],
  },
  {
    title: "收货仓库操作",
    roles: [...OWNER_MANAGER, "warehouse_ca", "support"],
    items: [
      { to: "/admin/receivings", label: "收货管理", icon: PackageCheck },
      { to: "/admin/delivery-queue", label: "待派送列表", icon: Truck },
      { to: "/admin/waybills", label: "集运单到货 / 派送", icon: Truck },
    ],
  },
  {
    title: "订单 / 集运单查询",
    roles: [...OWNER_MANAGER, "warehouse_cn", "warehouse_ca", "support"],
    items: [
      { to: "/admin/orders", label: "电商订单", icon: ShoppingBag },
      { to: "/admin/forwardings", label: "集运订单", icon: Boxes },
      { to: "/admin/waybills", label: "运单列表", icon: Truck },
      { to: "/admin/history", label: "历史记录", icon: History },
      { to: "/admin/invoices", label: "账单管理", icon: FileText },
    ],
  },
  {
    title: "电商管理",
    roles: [...OWNER_MANAGER, "sales"],
    items: [
      { to: "/admin/shop", label: "电商概览", icon: ShoppingBag },
      { to: "/admin/shop/orders", label: "电商订单", icon: ShoppingBag },
      { to: "/admin/shop/orders/procurement", label: "代采购列表", icon: Truck },
      { to: "/admin/shop/products", label: "商品管理", icon: Package },
      { to: "/admin/shop/categories", label: "商品分类", icon: Tag },
      { to: "/admin/shop/inventory", label: "库存流水", icon: Boxes },
      { to: "/admin/shop/coupons", label: "优惠券", icon: Tag },
      { to: "/admin/shop/banners", label: "Banner 装修", icon: ImageIcon },
      { to: "/admin/shop/articles", label: "文章管理", icon: FileText },
    ],
  },
  {
    title: "系统管理",
    roles: OWNER_MANAGER,
    items: [
      {
        to: "/admin/customer-view",
        label: "客户视图",
        icon: UserSearch,
        roles: ["owner", "warehouse_cn", "warehouse_ca", "support", "sales"],
      },
      { to: "/admin/users", label: "用户管理", icon: Users },
      { to: "/admin/messages", label: "留言信息", icon: Mail },
      { to: "/admin/logs", label: "操作日志", icon: History },
      { to: "/admin/wechat-ai-records", label: "AI 客服记录", icon: Bot },
      { to: "/admin/system", label: "系统设置", icon: SettingsIcon },
      { to: "/admin/warehouses", label: "仓库管理", icon: Warehouse },
      { to: "/admin/routes", label: "线路 / 运费", icon: RouteIcon },
      { to: "/admin/cargo-types", label: "货物类型", icon: Tag },
      { to: "/admin/destinations", label: "目的地", icon: MapPin },
      { to: "/admin/tracking-presets", label: "轨迹预设", icon: SettingsIcon },
      { to: "/admin/oversize-rules", label: "超大件规则", icon: Ruler },
      { to: "/admin/hs-codes", label: "HS 编码库", icon: BookText },
      { to: "/admin/nav-settings", label: "菜单权限设置", icon: ShieldCheck, roles: ["owner"] },
      { to: "/admin/wallet-ledger", label: "钱包流水", icon: Wallet },
    ],
  },
];

function AdminLayout() {
  const { user, signOut } = useAuth();
  const company = useCompanyInfo();
  const navigate = useNavigate();
  const fetchRoles = useServerFn(getMyRoles);
  const fetchNavItems = useServerFn(listNavItems);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Roles and the nav config barely change during a session — cache them for
  // the whole session so every admin page navigation stops re-fetching them.
  const rolesQ = useQuery({
    queryKey: ["my-roles"],
    queryFn: () => fetchRoles(),
    enabled: !!user,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
  const navQ = useQuery({
    queryKey: ["admin-nav-items"],
    queryFn: () => fetchNavItems(),
    enabled: !!user,
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });

  const roles = rolesQ.data?.roles ?? [];
  const hasConsoleAccess = roles.some((r) => ADMIN_CONSOLE_ROLES.includes(r));
  const isForbidden = !rolesQ.isLoading && rolesQ.isSuccess && !hasConsoleAccess;

  // admin_nav_items is the real source of truth (owner-editable via
  // /admin/nav-settings); DEFAULT_NAV_GROUPS only covers the gap before it's
  // loaded, or a fresh environment where the seed migration hasn't run yet.
  const navGroups: NavGroup[] = useMemo(() => {
    const rows = navQ.data?.items ?? [];
    if (rows.length === 0) return DEFAULT_NAV_GROUPS;
    const byTitle = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = byTitle.get(r.group_title) ?? [];
      arr.push(r);
      byTitle.set(r.group_title, arr);
    }
    return Array.from(byTitle.entries())
      .map(([title, rowsInGroup]) => ({
        title,
        sort: rowsInGroup[0]?.group_sort_order ?? 0,
        roles: [] as AppRole[], // vestigial: every item below carries its own roles
        items: rowsInGroup
          .slice()
          .sort((a, b) => a.item_sort_order - b.item_sort_order)
          .map((r) => ({
            to: r.path,
            label: r.label,
            icon: NAV_ICONS[r.icon] ?? Package,
            roles: r.roles as AppRole[],
          })),
      }))
      .sort((a, b) => a.sort - b.sort);
  }, [navQ.data]);

  const isItemAllowed = (group: NavGroup, item: NavItem) => (item.roles ?? group.roles).some((r) => roles.includes(r));
  const visibleGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((it) => isItemAllowed(g, it)) }))
    .filter((g) => g.items.length > 0);
  const allowedPaths = visibleGroups.flatMap((g) => g.items.map((i) => i.to));
  // "/admin" (dashboard) is a leaf, not a prefix — every other admin route also
  // starts with "/admin/", so it must only ever match exactly.
  const pathAllowed = (p: string) =>
    p === "/admin" ? pathname === "/admin" : pathname === p || pathname.startsWith(p + "/");
  const isPageRestricted = hasConsoleAccess && pathname !== "/admin/forbidden" && !allowedPaths.some(pathAllowed);

  useEffect(() => {
    if (isForbidden && pathname !== "/admin/forbidden") {
      navigate({ to: "/admin/forbidden", search: { reason: "no-role" } });
      return;
    }
    if (isPageRestricted) {
      navigate({ to: "/admin/forbidden", search: { reason: "page" } });
    }
  }, [isForbidden, isPageRestricted, pathname, navigate]);

  if (rolesQ.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-ink-soft" />
      </div>
    );
  }
  if (rolesQ.isError) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6 text-center">
        <div>
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-destructive" />
          <div className="font-display text-lg font-bold">无法加载权限</div>
          <div className="mt-1 text-sm text-ink-soft">{(rolesQ.error as Error).message}</div>
        </div>
      </div>
    );
  }
  if (!hasConsoleAccess) return <Outlet />;

  return (
    <div className="flex min-h-screen w-full bg-[#0B1220] text-slate-100">
      {/* Sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-white/5 bg-[#0A0F1A] md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-white/5 px-4">
          {company.logo_url ? (
            <img src={company.logo_url} alt={company.name} className="h-7 w-7 shrink-0 rounded-md object-cover" />
          ) : (
            <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-gradient-to-br from-brand to-cta font-display text-xs font-bold text-white">
              {(company.name || "SC").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate text-sm font-bold leading-tight">{company.name}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400">Admin Console</div>
          </div>
        </div>
        <nav className="flex-1 space-y-2 overflow-y-auto p-2">
          {visibleGroups.map((group, gi) => (
            <div key={gi}>
              {group.title && (
                <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {group.title}
                </div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item: NavItem) => {
                  const active =
                    item.to === "/admin"
                      ? pathname === "/admin"
                      : pathname === item.to || pathname.startsWith(item.to + "/");
                  const cls = [
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition",
                    active ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/5 hover:text-white",
                    item.soon ? "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-slate-300" : "",
                  ].join(" ");
                  const inner = (
                    <>
                      <item.icon className="h-4 w-4" />
                      <span className="flex-1">{item.label}</span>
                      {item.soon && <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase">Soon</span>}
                    </>
                  );
                  if (item.soon)
                    return (
                      <div key={`${gi}-${item.to}-${item.label}`} className={cls} title="即将上线">
                        {inner}
                      </div>
                    );
                  return (
                    <Link key={`${gi}-${item.to}-${item.label}`} to={item.to as any} className={cls}>
                      {inner}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-white/5 p-3 text-[11px] text-slate-500">v1 · Stage A</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex h-14 items-center gap-3 border-b border-white/5 bg-[#0A0F1A] px-4">
          <div className="md:hidden font-display text-sm font-bold">{company.name} Admin</div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden flex-wrap items-center gap-1 sm:flex">
              {roles
                .filter((r) => r !== "customer")
                .slice(0, 3)
                .map((r) => (
                  <span
                    key={r}
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${ROLE_COLOR[r]}`}
                  >
                    {ROLE_LABEL[r].zh}
                  </span>
                ))}
            </div>
            <div className="text-xs text-slate-400">{user?.email}</div>
            <Link
              to="/account"
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5"
            >
              <ExternalLink className="h-3 w-3" />
              前台
            </Link>
            <button
              onClick={async () => {
                await signOut();
                navigate({ to: "/admin-login" });
              }}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5"
            >
              <LogOut className="h-3 w-3" />
              退出
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 bg-[#0B1220] text-slate-100">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
