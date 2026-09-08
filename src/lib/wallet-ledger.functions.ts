import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// 钱包流水（后台）：把 wallet_transactions 分成「充值流水」与「扣款流水」两类，
// 并按渠道分组供筛选/统计——充值区分 EMT / 微信支付宝 / 信用卡；扣款区分 钱包余额 /
// EMT / 现金 / 后台调整。金额敏感，仅 owner / manager 可查看。
async function assertManager(supabase: any, userId: string) {
  const [{ data: isOwner }, { data: isManager }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "manager" }),
  ]);
  if (!isOwner && !isManager) throw new Error("Forbidden: owner/manager only");
}

export type LedgerKind = "recharge" | "spend";

// type='adjust' 既可能是管理员加钱也可能是扣钱（amount_cad 正负号区分），按符号
// 归入对应的一侧；'recharge'/'spend' 语义已经明确。
function applyKindFilter(q: any, kind: LedgerKind) {
  return kind === "recharge"
    ? q.or("type.eq.recharge,and(type.eq.adjust,amount_cad.gt.0)")
    : q.or("type.eq.spend,and(type.eq.adjust,amount_cad.lt.0)");
}

const CHANNEL_GROUPS: Record<LedgerKind, Record<string, string[]>> = {
  recharge: { emt: ["emt"], wechat_alipay: ["wechat", "alipay"], card: ["card"] },
  spend: { wallet: ["wallet"], emt: ["emt"], cash: ["cash"], admin: ["admin"] },
};

export const LEDGER_CHANNEL_LABEL: Record<LedgerKind, Record<string, string>> = {
  recharge: { emt: "EMT", wechat_alipay: "微信/支付宝", card: "信用卡", other: "其他" },
  spend: { wallet: "钱包余额", emt: "EMT", cash: "现金", admin: "后台调整", other: "其他" },
};

function channelGroupOf(kind: LedgerKind, channel: string | null): string {
  const groups = CHANNEL_GROUPS[kind];
  for (const [key, list] of Object.entries(groups)) if (channel && list.includes(channel)) return key;
  return "other";
}

// 共享的汇总逻辑：按渠道分组统计已完成流水的笔数/金额。供后台流水页与运营概览
// 小卡片复用（概览那边直接调用这个纯函数，而不是走 listWalletLedger 的 RPC 包装）。
export async function computeWalletLedgerSummary(
  admin: any,
  kind: LedgerKind,
  dateFromISO: string | null,
  dateToISO: string | null,
) {
  let q = applyKindFilter(admin.from("wallet_transactions").select("channel, amount_cad, status"), kind);
  if (dateFromISO) q = q.gte("created_at", dateFromISO);
  if (dateToISO) q = q.lte("created_at", dateToISO);
  const { data: aggRows, error } = await q.limit(20000);
  if (error) throw new Error(error.message);

  const byChannel = new Map<string, { count: number; amount_cad: number }>();
  let totalCount = 0,
    totalAmount = 0;
  for (const r of (aggRows ?? []) as any[]) {
    if (r.status !== "completed") continue;
    const key = channelGroupOf(kind, r.channel ?? null);
    const cur = byChannel.get(key) ?? { count: 0, amount_cad: 0 };
    const amt = Math.abs(Number(r.amount_cad ?? 0));
    cur.count++;
    cur.amount_cad += amt;
    byChannel.set(key, cur);
    totalCount++;
    totalAmount += amt;
  }
  const labels = LEDGER_CHANNEL_LABEL[kind];
  const by_channel = Object.keys(labels)
    .filter((k) => k !== "other" || (byChannel.get("other")?.count ?? 0) > 0)
    .map((key) => ({
      key,
      label: labels[key],
      count: byChannel.get(key)?.count ?? 0,
      amount_cad: +(byChannel.get(key)?.amount_cad ?? 0).toFixed(2),
    }));

  return { total_count: totalCount, total_amount_cad: +totalAmount.toFixed(2), by_channel };
}

export const listWalletLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      kind: LedgerKind;
      channelGroup?: string | null; // "all" 或 CHANNEL_GROUPS[kind] 的 key
      dateFrom?: string | null; // YYYY-MM-DD，含当天
      dateTo?: string | null; // YYYY-MM-DD，含当天
      status?: string | null; // "all" | "completed" | "pending" | "failed"
      page?: number;
      pageSize?: number;
      summaryOnly?: boolean; // 只要汇总（用于运营概览小卡片），不取分页明细
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const kind = data.kind;
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, data.pageSize ?? 50));
    const dateFromISO = data.dateFrom ? new Date(`${data.dateFrom}T00:00:00`).toISOString() : null;
    const dateToISO = data.dateTo ? new Date(`${data.dateTo}T23:59:59.999`).toISOString() : null;

    function withFilters(q: any) {
      q = applyKindFilter(q, kind);
      if (dateFromISO) q = q.gte("created_at", dateFromISO);
      if (dateToISO) q = q.lte("created_at", dateToISO);
      if (data.status && data.status !== "all") q = q.eq("status", data.status);
      return q;
    }

    const summary = await computeWalletLedgerSummary(supabaseAdmin, kind, dateFromISO, dateToISO);
    if (data.summaryOnly) return { rows: [], page, pageSize, page_count: 0, summary };

    // ---- 分页明细 ----
    let rowsQ = withFilters(supabaseAdmin.from("wallet_transactions").select("*", { count: "exact" }));
    if (data.channelGroup && data.channelGroup !== "all") {
      const list = CHANNEL_GROUPS[kind][data.channelGroup] ?? [];
      if (list.length) rowsQ = rowsQ.in("channel", list);
    }
    rowsQ = rowsQ.order("created_at", { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1);
    const { data: rows, count, error } = await rowsQ;
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set(((rows ?? []) as any[]).map((r) => r.user_id).filter(Boolean)));
    const profMap = new Map<string, { customer_code: string | null; full_name: string | null }>();
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, customer_code, full_name")
        .in("id", userIds);
      for (const p of (profs ?? []) as any[])
        profMap.set(p.id, { customer_code: p.customer_code ?? null, full_name: p.full_name ?? null });
    }
    const enriched = ((rows ?? []) as any[]).map((r) => ({ ...r, customer: profMap.get(r.user_id) ?? null }));

    return { rows: enriched, page, pageSize, page_count: count ?? 0, summary };
  });
