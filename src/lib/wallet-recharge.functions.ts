import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// 后台「充值申请记录」：只处理 type='recharge' 的钱包流水（EMT / 微信 / 支付宝 / 信用卡 / 其他），
// 不混入消费、批次扣款、后台余额调整。所有状态写入经 wallet_recharge_action RPC（原子 + 审计）。

async function assertManager(supabase: any, userId: string) {
  const [{ data: isOwner }, { data: isManager }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "manager" }),
  ]);
  if (!isOwner && !isManager) throw new Error("Forbidden: owner/manager only");
}

// 备注里塞了 "凭证=<storagePath>" 和 "pid=<id>"，展示时拆出来
function parseNote(note: string | null): { customerNote: string; proofPath: string | null } {
  if (!note) return { customerNote: "", proofPath: null };
  const proof = /凭证=([^\s·]+)/.exec(note)?.[1] ?? null;
  const customerNote = note
    .replace(/凭证=[^\s·]+/g, "")
    .replace(/pid=[A-Za-z0-9_-]+/g, "")
    .replace(/hosted=1/g, "")
    .replace(/^(Email Transfer 充值|OTT Pay(?: 信用卡)? 充值|用户充值) CA\$[\d.]+/, "")
    .replace(/·\s*·/g, "·")
    .replace(/(^[\s·]+|[\s·]+$)/g, "")
    .trim();
  return { customerNote, proofPath: proof };
}

const OTT_CHANNELS = ["wechat", "alipay", "card"];

export const listRechargeApplications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      customerCode?: string | null;
      refNo?: string | null;
      paymentId?: string | null;
      channel?: string | null; // emt | wechat | alipay | card | other | all
      status?: string | null; // pending | completed | failed | cancelled | all
      dateFrom?: string | null;
      dateTo?: string | null;
      page?: number;
      pageSize?: number;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, data.pageSize ?? 50));

    // 客户号筛选 → 先转 user_id
    let userIdFilter: string[] | null = null;
    if (data.customerCode?.trim()) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .ilike("customer_code", `%${data.customerCode.trim()}%`);
      userIdFilter = ((profs ?? []) as any[]).map((p) => p.id);
      if (userIdFilter.length === 0) {
        return { rows: [], page, pageSize, total: 0 };
      }
    }

    let q = supabaseAdmin
      .from("wallet_transactions")
      .select("*", { count: "exact" })
      .eq("type", "recharge")
      .order("created_at", { ascending: false });

    if (userIdFilter) q = q.in("user_id", userIdFilter);
    if (data.refNo?.trim()) q = q.ilike("ref_no", `%${data.refNo.trim()}%`);
    if (data.paymentId?.trim()) q = q.ilike("provider_payment_id", `%${data.paymentId.trim()}%`);
    if (data.channel && data.channel !== "all") {
      if (data.channel === "other") q = q.not("channel", "in", `(emt,wechat,alipay,card)`);
      else q = q.eq("channel", data.channel);
    }
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.dateFrom) q = q.gte("created_at", new Date(`${data.dateFrom}T00:00:00`).toISOString());
    if (data.dateTo) q = q.lte("created_at", new Date(`${data.dateTo}T23:59:59.999`).toISOString());

    const { data: rows, count, error } = await q.range((page - 1) * pageSize, page * pageSize - 1);
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

    const enriched = ((rows ?? []) as any[]).map((r) => {
      const { customerNote, proofPath } = parseNote(r.note);
      return {
        id: r.id,
        created_at: r.created_at,
        user_id: r.user_id,
        customer_code: profMap.get(r.user_id)?.customer_code ?? null,
        customer_name: profMap.get(r.user_id)?.full_name ?? null,
        amount_cad: Number(r.amount_cad ?? 0),
        channel: r.channel ?? null,
        is_ott: OTT_CHANNELS.includes(r.channel ?? ""),
        status: r.status,
        ref_no: r.ref_no ?? null,
        provider_payment_id: r.provider_payment_id ?? null,
        provider_status: r.provider_status ?? null,
        customer_note: customerNote,
        proof_path: proofPath,
        verified_at: r.verified_at ?? null,
        verified_by: r.verified_by ?? null,
        receipt_reason: r.receipt_reason ?? null,
      };
    });

    return { rows: enriched, page, pageSize, total: count ?? 0 };
  });

// EMT「确认到账」：pending → completed（原子），触发器/RPC 加一次余额，不另写调整流水
export const confirmEmtTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { txId: string; reason?: string | null }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { data: res, error } = await (context.supabase as any).rpc("wallet_recharge_action", {
      _payload: { op: "emt_confirm", tx_id: data.txId, reason: data.reason ?? null },
    });
    if (error) throw new Error(error.message);
    if (!res?.ok) {
      throw new Error(res?.reason === "not_pending" || res?.status ? `该记录已不是待处理状态（当前：${res?.status}）` : "确认失败");
    }
    return res as { ok: true; status: string; rows_changed: number };
  });

// 「标记无效」：pending/failed → failed 或 cancelled，不动钱包余额
export const voidTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { txId: string; reason: string; voidStatus?: "failed" | "cancelled" }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    if (!data.reason?.trim()) throw new Error("请填写标记无效的原因");
    const { data: res, error } = await (context.supabase as any).rpc("wallet_recharge_action", {
      _payload: {
        op: "void",
        tx_id: data.txId,
        reason: data.reason.trim(),
        void_status: data.voidStatus ?? "cancelled",
      },
    });
    if (error) throw new Error(error.message);
    if (!res?.ok) throw new Error(`无法作废（当前状态：${res?.status}）`);
    return res as { ok: true; status: string };
  });

// EMT 付款凭证：签名 URL
export const getRechargeProofUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { txId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: tx } = await supabaseAdmin
      .from("wallet_transactions")
      .select("note")
      .eq("id", data.txId)
      .maybeSingle();
    const path = /凭证=([^\s·]+)/.exec((tx as any)?.note ?? "")?.[1];
    if (!path) return { url: null as string | null };
    const { data: signed } = await supabaseAdmin.storage
      .from("payment-proofs")
      .createSignedUrl(path, 60 * 30);
    return { url: signed?.signedUrl ?? null };
  });

// OTT「向 OTT 查询」：调 CMP，全部字段匹配才入账；退款状态单独警告。
// 员工不能直接确认——入账只发生在 CMP 核验通过时。查询逻辑与定时对账共用 verifyOttRecharge。
export const queryOttTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { txId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { verifyOttRecharge } = await import("@/lib/ottpay-reconcile.server");

    const { data: tx } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id, type, status, channel, amount_cad, ref_no, provider_payment_id, note")
      .eq("id", data.txId)
      .maybeSingle();
    if (!tx) throw new Error("找不到该充值记录");
    if ((tx as any).type !== "recharge") throw new Error("非充值流水");
    if (!OTT_CHANNELS.includes((tx as any).channel ?? "")) throw new Error("非 OTT 渠道，无法向 OTT 查询");
    if ((tx as any).status === "completed") return { ok: true, status: "completed", note: "已是已充值状态" };

    const callRpc = async (payload: Record<string, any>) => {
      const { data: r, error } = await (context.supabase as any).rpc("wallet_recharge_action", { _payload: payload });
      if (error) throw new Error(error.message);
      return r;
    };

    const v = await verifyOttRecharge(tx as any);

    if (v.decision === "error") {
      return { ok: false, status: (tx as any).status, error: `OTT 查询失败：${v.error}` };
    }
    if (v.decision === "refund") {
      await callRpc({ op: "ott_record", tx_id: data.txId, provider_status: v.providerStatus, provider_response: v.providerResponse, provider_payment_id: v.providerPaymentId });
      return { ok: false, status: "refund_warning", provider_status: v.providerStatus, warning: v.warning };
    }
    if (v.decision === "settle") {
      const r = await callRpc({
        op: "ott_settle",
        tx_id: data.txId,
        provider_payment_id: v.providerPaymentId,
        provider_status: v.providerStatus,
        provider_response: v.providerResponse,
      });
      return {
        ok: true,
        status: r?.status ?? "completed",
        settled_now: (r?.rows_changed ?? 0) === 1, // 0 = 已被回调/其他请求入账，不重复加余额
        provider_status: v.providerStatus,
      };
    }
    if (v.decision === "mismatch") {
      await callRpc({ op: "ott_record", tx_id: data.txId, provider_status: v.providerStatus, provider_response: v.providerResponse, provider_payment_id: v.providerPaymentId });
      return { ok: false, status: "mismatch", warning: v.warning };
    }
    if (v.decision === "fail") {
      const r = await callRpc({ op: "ott_mark_failed", tx_id: data.txId, provider_status: v.providerStatus, provider_response: v.providerResponse });
      return { ok: true, status: r?.status ?? "failed", provider_status: v.providerStatus };
    }
    // pending
    await callRpc({ op: "ott_record", tx_id: data.txId, provider_status: v.providerStatus, provider_response: v.providerResponse, provider_payment_id: v.providerPaymentId });
    return { ok: false, status: "pending", provider_status: v.providerStatus };
  });
