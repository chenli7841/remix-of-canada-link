import type { AppRole } from "@/lib/admin.functions";

export const ROLE_LABEL: Record<AppRole, { zh: string; en: string }> = {
  owner: { zh: "总负责人", en: "Owner" },
  manager: { zh: "主管", en: "Manager" },
  warehouse_cn: { zh: "中国仓库", en: "CN Warehouse" },
  warehouse_ca: { zh: "加拿大仓库", en: "CA Warehouse" },
  driver: { zh: "派送司机", en: "Driver" },
  pickup_point: { zh: "取货点", en: "Pickup Point" },
  sales: { zh: "销售", en: "Sales" },
  support: { zh: "客服", en: "Support" },
  customer: { zh: "客人", en: "Customer" },
};

export const ASSIGNABLE_ROLES: AppRole[] = [
  "owner",
  "manager",
  "warehouse_cn",
  "warehouse_ca",
  "driver",
  "pickup_point",
  "sales",
  "support",
];

// Roles allowed into the /admin console. driver/pickup_point don't have a
// backend console view yet (they'll get their own dedicated page later), so
// they're deliberately excluded here even though they're staff roles.
export const ADMIN_CONSOLE_ROLES: AppRole[] = ["owner", "manager", "warehouse_cn", "warehouse_ca", "sales", "support"];

export const ROLE_COLOR: Record<AppRole, string> = {
  owner: "bg-rose-500/15 text-rose-600 border-rose-500/30",
  manager: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  warehouse_cn: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  warehouse_ca: "bg-teal-500/15 text-teal-600 border-teal-500/30",
  driver: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  pickup_point: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30",
  sales: "bg-violet-500/15 text-violet-600 border-violet-500/30",
  support: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30",
  customer: "bg-muted text-muted-foreground border-border",
};
