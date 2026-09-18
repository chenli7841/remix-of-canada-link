import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { VipLevel } from "@/lib/vip-levels";
import { recordAdminLog } from "@/lib/admin-log";

export type AppRole =
  | "owner"
  | "manager"
  | "warehouse_cn"
  | "warehouse_ca"
  | "driver"
  | "pickup_point"
  | "sales"
  | "sales_rep"
  | "support"
  | "customer";

// Sort priority for the user list: staff roles first (owner highest), plain
// customers last. A user's rank is the best (lowest-index) role they hold;
// no roles at all sorts alongside "customer".
const ROLE_SORT_ORDER: AppRole[] = [
  "owner",
  "manager",
  "warehouse_cn",
  "warehouse_ca",
  "driver",
  "pickup_point",
  "sales",
  "sales_rep",
  "support",
  "customer",
];
function roleRank(roles: AppRole[]): number {
  if (roles.length === 0) return ROLE_SORT_ORDER.length - 1; // no role => treat like a customer
  return Math.min(...roles.map((r) => ROLE_SORT_ORDER.indexOf(r)).map((i) => (i < 0 ? ROLE_SORT_ORDER.length : i)));
}

async function assertStaff(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_staff", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}
async function assertOwner(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "owner" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: owner only");
}
async function getCallerLevel(supabase: any, userId: string): Promise<"owner" | "manager" | "none"> {
  const [{ data: isOwner }, { data: isManager }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "manager" }),
  ]);
  if (isOwner) return "owner";
  if (isManager) return "manager";
  return "none";
}

export const getMyRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { roles: (data ?? []).map((r: any) => r.role as AppRole) };
  });

export const listUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      search?: string;
      role?: AppRole | "all";
      vipLevel?: VipLevel | "all";
      unpaidOnly?: boolean;
      page?: number;
      pageSize?: number;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, data.pageSize ?? 25));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Sorting (staff first, then customer_code), filtering, paging and the
    // per-row wallet / unpaid-invoice aggregates all happen in one database
    // call — fetching every profile into JS was the main slow path here.
    const { data: res, error } = await supabaseAdmin.rpc("admin_list_users", {
      _search: data.search?.trim() || null,
      _role: data.role && data.role !== "all" ? data.role : null,
      _vip: data.vipLevel && data.vipLevel !== "all" ? data.vipLevel : null,
      _unpaid_only: !!data.unpaidOnly,
      _limit: pageSize,
      _offset: (page - 1) * pageSize,
    } as any);
    if (error) throw new Error(error.message);

    const payload = (res ?? {}) as { users?: any[]; total?: number };
    const payloadUsers = payload.users ?? [];
    const userIds = payloadUsers.map((u: any) => u.id).filter(Boolean);
    const unpaidByUser = new Map<string, { count: number; amount_cad: number }>();
    if (userIds.length) {
      const { data: invoices, error: invoiceError } = await supabaseAdmin
        .from("invoices")
        .select("user_id, total_cny, paid_cny, paid_cad, fx_rate, status")
        .in("user_id", userIds)
        .in("status", ["unpaid", "overdue"]);
      if (invoiceError) throw new Error(invoiceError.message);
      for (const inv of (invoices ?? []) as any[]) {
        const fx = Number(inv.fx_rate ?? 0.19);
        const totalCad = Number(inv.total_cny ?? 0) * fx;
        const paidCad = Number(inv.paid_cad ?? 0) > 0 ? Number(inv.paid_cad) : Number(inv.paid_cny ?? 0) * fx;
        const current = unpaidByUser.get(inv.user_id) ?? { count: 0, amount_cad: 0 };
        current.count += 1;
        current.amount_cad += Math.max(0, totalCad - paidCad);
        unpaidByUser.set(inv.user_id, current);
      }
    }
    return {
      users: payloadUsers.map((u: any) => ({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        phone: u.phone,
        customer_code: u.customer_code,
        created_at: u.created_at,
        vip_level: (u.vip_level ?? "normal") as VipLevel,
        points: Number(u.points ?? 0),
        is_blacklisted: !!u.is_blacklisted,
        blacklist_reason: u.blacklist_reason ?? null,
        roles: (u.roles ?? []) as AppRole[],
        wallet: { balance_cad: Number(u.wallet?.balance_cad ?? 0) },
        unpaid: {
          count: unpaidByUser.get(u.id)?.count ?? 0,
          amount_cad: +(unpaidByUser.get(u.id)?.amount_cad ?? 0).toFixed(2),
        },
      })),
      total: Number(payload.total ?? 0),
      page,
      pageSize,
    };
  });

export const getUserDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [
      { data: profile },
      { data: roles },
      { data: wallet },
      { count: ordersCount },
      { data: unpaidInvoices },
      { data: unpaidOrders },
      { data: unpaidForwardings },
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("*").eq("id", data.userId).maybeSingle(),
      supabaseAdmin.from("user_roles").select("role").eq("user_id", data.userId),
      supabaseAdmin.from("wallets").select("balance_cad").eq("user_id", data.userId).maybeSingle(),
      supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).eq("user_id", data.userId),
      supabaseAdmin
        .from("invoices")
        .select("id, invoice_no, total_cny, paid_cny, paid_cad, fx_rate, status, due_date, created_at")
        .eq("user_id", data.userId)
        .in("status", ["unpaid", "overdue"])
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("orders")
        .select("id, order_no, total_cny, status, payment_status, created_at")
        .eq("user_id", data.userId)
        .neq("payment_status", "paid")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("forwarding_orders")
        .select("id, status, created_at")
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (!profile) throw new Error("User not found");
    const unpaidAmountCad = (unpaidInvoices ?? []).reduce((sum: number, inv: any) => {
      const fx = Number(inv.fx_rate ?? 0.19);
      const totalCad = Number(inv.total_cny ?? 0) * fx;
      const paidCad = Number(inv.paid_cad ?? 0) > 0 ? Number(inv.paid_cad) : Number(inv.paid_cny ?? 0) * fx;
      return sum + Math.max(0, totalCad - paidCad);
    }, 0);
    return {
      profile,
      roles: (roles ?? []).map((r: any) => r.role as AppRole),
      wallet: wallet ?? { balance_cad: 0 },
      ordersCount: ordersCount ?? 0,
      unpaidInvoices: unpaidInvoices ?? [],
      unpaidOrders: unpaidOrders ?? [],
      unpaidForwardings: unpaidForwardings ?? [],
      unpaidAmountCad: +unpaidAmountCad.toFixed(2),
    };
  });

export const setUserVipAndPoints = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; vipLevel?: VipLevel; points?: number; pointsDelta?: number }) => d)
  .handler(async ({ data, context }) => {
    const level = await getCallerLevel(context.supabase, context.userId);
    if (level === "none") throw new Error("Forbidden: owner or manager only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = {};
    if (data.vipLevel) patch.vip_level = data.vipLevel;
    if (typeof data.points === "number") patch.points = Math.max(0, Math.floor(data.points));
    if (typeof data.pointsDelta === "number" && data.pointsDelta !== 0) {
      const { data: cur } = await supabaseAdmin.from("profiles").select("points").eq("id", data.userId).maybeSingle();
      patch.points = Math.max(0, Number(cur?.points ?? 0) + Math.floor(data.pointsDelta));
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("id", data.userId);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "user",
      entity_id: data.userId,
      action: "set_vip_points",
      after: patch,
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const setUserFeeScheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; scheme: "merged" | "split" }) => d)
  .handler(async ({ data, context }) => {
    const level = await getCallerLevel(context.supabase, context.userId);
    if (level === "none") throw new Error("Forbidden: owner or manager only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.scheme !== "merged" && data.scheme !== "split") throw new Error("Invalid scheme");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ fee_scheme_preference: data.scheme })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "user",
      entity_id: data.userId,
      action: "set_fee_scheme",
      after: { scheme: data.scheme },
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const setUserBlacklist = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; blacklisted: boolean; reason?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const level = await getCallerLevel(context.supabase, context.userId);
    if (level === "none") throw new Error("Forbidden: owner or manager only");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.userId === context.userId) throw new Error("不能将自己加入黑名单");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({
        is_blacklisted: !!data.blacklisted,
        blacklist_reason: data.blacklisted ? (data.reason ?? null) : null,
      })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "user",
      entity_id: data.userId,
      action: data.blacklisted ? "blacklist" : "unblacklist",
      after: { reason: data.reason ?? null },
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const adjustUserWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; mode: "delta" | "set"; amount: number; note?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const level = await getCallerLevel(context.supabase, context.userId);
    if (level === "none") throw new Error("Forbidden: owner or manager only");
    if (!Number.isFinite(data.amount)) throw new Error("金额无效");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existing } = await supabaseAdmin
      .from("wallets")
      .select("balance_cad")
      .eq("user_id", data.userId)
      .maybeSingle();
    const cur = Number(existing?.balance_cad ?? 0);
    const next = data.mode === "set" ? Number(data.amount) : cur + Number(data.amount);
    const delta = next - cur;

    // type "adjust" is in the trigger's credit list, so amount_cad (positive
    // or negative) is applied to wallets.balance_cad directly — no manual
    // balance write needed, avoiding double-applying the delta.
    const { error: terr } = await supabaseAdmin.from("wallet_transactions").insert({
      user_id: data.userId,
      type: "adjust",
      amount_cad: delta,
      status: "completed",
      channel: "admin",
      note: data.note ?? (data.mode === "set" ? "管理员设置余额" : "管理员手动调整"),
    } as any);
    if (terr) throw new Error(terr.message);

    // Admin log
    try {
      await supabaseAdmin.from("admin_action_logs").insert({
        entity_type: "wallet",
        entity_id: data.userId,
        action: data.mode === "set" ? "wallet.set" : "wallet.adjust",
        after: { before: cur, after: next, delta },
        operator_id: context.userId,
        note: data.note ?? null,
      });
    } catch {
      /* ignore log failure */
    }

    return { ok: true, balance_cad: next };
  });

export const setUserRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; roles: AppRole[] }) => d)
  .handler(async ({ data, context }) => {
    const level = await getCallerLevel(context.supabase, context.userId);
    if (level === "none") throw new Error("Forbidden: owner or manager only");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Read target's current roles to enforce manager restrictions
    const { data: existing } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", data.userId);
    const currentRoles = new Set<AppRole>((existing ?? []).map((r: any) => r.role));
    const desiredRoles = new Set<AppRole>(data.roles);

    if (level === "manager") {
      // Managers cannot manage owners or grant/revoke owner role
      if (currentRoles.has("owner")) throw new Error("Managers cannot modify an owner's roles.");
      if (desiredRoles.has("owner") !== currentRoles.has("owner")) {
        throw new Error("Managers cannot assign or revoke the 'owner' role.");
      }
      // Managers cannot promote/demote other managers (only owners can)
      if (desiredRoles.has("manager") !== currentRoles.has("manager")) {
        throw new Error("Only the owner can assign or revoke the 'manager' role.");
      }
    }

    if (data.userId === context.userId && currentRoles.has("owner") && !desiredRoles.has("owner")) {
      throw new Error("You cannot remove the 'owner' role from yourself.");
    }

    const desired = Array.from(new Set([...data.roles, "customer"])) as AppRole[];
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId);
    const rows = desired.map((role) => ({ user_id: data.userId, role }));
    const { error } = await supabaseAdmin.from("user_roles").insert(rows);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "user",
      entity_id: data.userId,
      action: "set_roles",
      before: { roles: Array.from(currentRoles) },
      after: { roles: desired },
      operator_id: context.userId,
    });
    return { ok: true, roles: desired };
  });

export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [users, orders, forwardings, staff] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("orders").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("forwarding_orders").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("user_roles").select("user_id").neq("role", "customer"),
    ]);
    const staffIds = new Set((staff.data ?? []).map((r: any) => r.user_id));
    return {
      usersCount: users.count ?? 0,
      ordersCount: orders.count ?? 0,
      forwardingCount: forwardings.count ?? 0,
      staffCount: staffIds.size,
    };
  });
