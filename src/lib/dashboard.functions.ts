import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { computeWalletLedgerSummary } from "@/lib/wallet-ledger.functions";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden: staff only");
}

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 钱包流水金额较敏感，概览小卡片只对 owner / manager 显示（与 /admin/wallet-ledger
    // 页面的权限口径一致），其它职能角色（仓库/客服/销售）看不到这部分。
    const [{ data: isOwner }, { data: isManager }] = await Promise.all([
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "owner" }),
      context.supabase.rpc("has_role", { _user_id: context.userId, _role: "manager" }),
    ]);
    const canSeeWallet = !!isOwner || !!isManager;

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();
    const sevenAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

    const [
      ordersTodayR, waybillsTodayR, inTransitR, pendingIntakeR,
      unpaidInvR, monthRevR, detainedR, usersR,
      recentLogsR, waybillsTrendR, routeDistR,
      walletRecharge, walletSpend,
    ] = await Promise.all([
      supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).gte("created_at", todayISO),
      supabaseAdmin.from("waybills").select("id", { count: "exact", head: true }).gte("created_at", todayISO),
      supabaseAdmin.from("waybills").select("id", { count: "exact", head: true }).in("status", ["shipped", "in_transit"]),
      supabaseAdmin.from("waybills").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabaseAdmin.from("invoices").select("total_cny").in("status", ["unpaid", "overdue"]),
      supabaseAdmin.from("invoices").select("paid_cny, fx_rate").eq("status", "paid").gte("paid_at", monthStart),
      supabaseAdmin.from("detained_packages").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("admin_action_logs").select("*").order("created_at", { ascending: false }).limit(10),
      supabaseAdmin.from("waybills").select("created_at, status").gte("created_at", sevenAgo),
      supabaseAdmin.from("waybills").select("shipping_method").gte("created_at", new Date(Date.now() - 30 * 86400000).toISOString()),
      // 本月钱包流水（充值/扣款分开、按渠道分组），供概览小卡片使用 —— 与
      // /admin/wallet-ledger 页面共用同一份聚合逻辑，口径保持一致。
      canSeeWallet ? computeWalletLedgerSummary(supabaseAdmin, "recharge", monthStart, null) : null,
      canSeeWallet ? computeWalletLedgerSummary(supabaseAdmin, "spend", monthStart, null) : null,
    ]);

    const unpaidTotal = (unpaidInvR.data ?? []).reduce((s: number, r: any) => s + Number(r.total_cny || 0), 0);
    const monthRevCAD = (monthRevR.data ?? []).reduce((s: number, r: any) => s + Number(r.paid_cny || 0) * Number(r.fx_rate || 0.19), 0);

    // Build 7-day trend
    const days: { date: string; orders: number; waybills: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      days.push({ date: d.toISOString().slice(5, 10), orders: 0, waybills: 0 });
    }
    for (const w of waybillsTrendR.data ?? []) {
      const k = new Date(w.created_at).toISOString().slice(5, 10);
      const day = days.find(d => d.date === k);
      if (day) day.waybills++;
    }

    // Route distribution
    const dist: Record<string, number> = {};
    for (const w of routeDistR.data ?? []) {
      const k = w.shipping_method || "unknown";
      dist[k] = (dist[k] ?? 0) + 1;
    }

    return {
      kpi: {
        ordersToday: ordersTodayR.count ?? 0,
        waybillsToday: waybillsTodayR.count ?? 0,
        inTransit: inTransitR.count ?? 0,
        pendingIntake: pendingIntakeR.count ?? 0,
        unpaidCNY: +unpaidTotal.toFixed(2),
        monthRevenueCAD: +monthRevCAD.toFixed(2),
        detained: detainedR.count ?? 0,
        users: usersR.count ?? 0,
      },
      trend: days,
      routeDistribution: Object.entries(dist).map(([name, value]) => ({ name, value })),
      recentLogs: recentLogsR.data ?? [],
      walletLedger: canSeeWallet ? { month_recharge: walletRecharge!, month_spend: walletSpend! } : null,
    };
  });
