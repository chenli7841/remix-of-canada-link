// OTT Pay 充值核验（服务端共享逻辑）。供后台「向 OTT 查询」按钮与定时对账路由复用，
// 保证两条路径用完全一致的匹配规则。只读 CMP、给出裁决，不写库。

const SENSITIVE = /(token|app[_-]?key|sign[_-]?key|secret|password|api[_-]?key|authorization|access[_-]?key)/i;

export function sanitizeOtt(v: any, depth = 0): any {
  if (v == null || depth > 6) return v;
  if (Array.isArray(v)) return v.map((x) => sanitizeOtt(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, any> = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = SENSITIVE.test(k) ? "[redacted]" : sanitizeOtt(val, depth + 1);
    }
    return out;
  }
  return v;
}

export type OttTx = {
  id: string;
  ref_no: string | null;
  amount_cad: number | string | null;
  provider_payment_id: string | null;
  note: string | null;
};

export type OttDecision =
  | { decision: "settle"; providerStatus: string; providerPaymentId: string | null; providerResponse: any }
  | { decision: "fail"; providerStatus: string; providerPaymentId: string | null; providerResponse: any }
  | { decision: "pending"; providerStatus: string; providerPaymentId: string | null; providerResponse: any }
  | { decision: "mismatch"; providerStatus: string; providerPaymentId: string | null; providerResponse: any; warning: string }
  | { decision: "refund"; providerStatus: string; providerPaymentId: string | null; providerResponse: any; warning: string }
  | { decision: "error"; error: string };

const REFUND_STATES = new Set(["fully_refunded", "partial_refunded", "fully_reversal"]);
const FAIL_STATES = new Set(["orderclosed", "failure", "failed", "expired", "rejected", "reversed", "revoked", "cancelled"]);

export async function verifyOttRecharge(tx: OttTx): Promise<OttDecision> {
  const { ottPost } = await import("@/lib/ottpay.server");
  const localPid = tx.provider_payment_id || /pid=([A-Za-z0-9_-]+)/.exec(tx.note ?? "")?.[1] || null;
  const localRef = tx.ref_no ?? "";
  const localAmt = Number(tx.amount_cad ?? 0);

  let cmp: any;
  try {
    cmp = localPid
      ? await ottPost("/api/v1/payment/status-query", { paymentId: localPid })
      : await ottPost("/api/v1/payment/status-query-by-reference", { reference: localRef });
  } catch (e: any) {
    return { decision: "error", error: e?.message ?? String(e) };
  }

  const sane = sanitizeOtt(cmp);
  const pStatus = String(cmp?.paymentStatus ?? cmp?.payment_status ?? "").toLowerCase();
  const stateCode = String(cmp?.stateCode ?? cmp?.state_code ?? "");
  const cmpPid = String(cmp?.paymentId ?? cmp?.payment_id ?? cmp?.orderId ?? cmp?.order_id ?? "");
  const cmpRef = String(
    cmp?.reference ?? cmp?.remark ?? cmp?.remarks ?? cmp?.merchantOrderNo ?? cmp?.merchant_order_no ?? "",
  );
  const cmpAmt = Number(cmp?.totalAmount ?? cmp?.total_amount ?? cmp?.amount ?? 0) / 100;
  const provStatus = pStatus || stateCode;

  if (REFUND_STATES.has(pStatus) || ["P00004", "P00005", "P00009", "P00012", "P00016"].includes(stateCode)) {
    return {
      decision: "refund",
      providerStatus: provStatus,
      providerPaymentId: cmpPid || localPid,
      providerResponse: sane,
      warning: "该笔已发生退款 / 冲正，不能按充值入账，请走退款对账流程",
    };
  }

  // CMP also uses "success" for refund/void operations; prefer its specific state code.
  const success = stateCode ? stateCode === "P00003" && (!pStatus || pStatus === "success") : pStatus === "success";
  const pidMatch = !localPid || (!!cmpPid && cmpPid === localPid);
  const refMatch = cmpRef ? cmpRef === localRef : !!localPid;
  const amtMatch = Number.isFinite(cmpAmt) && cmpAmt > 0 && Number.isFinite(localAmt) && localAmt > 0
    && Math.round(cmpAmt * 100) === Math.round(localAmt * 100);

  if (success && pidMatch && refMatch && amtMatch) {
    return { decision: "settle", providerStatus: provStatus, providerPaymentId: cmpPid || localPid, providerResponse: sane };
  }
  if (success) {
    return {
      decision: "mismatch",
      providerStatus: provStatus,
      providerPaymentId: cmpPid || null,
      providerResponse: sane,
      warning: `CMP 显示成功但信息不匹配：Payment ID ${pidMatch ? "✓" : "✗"} · 参考号 ${refMatch ? "✓" : "✗"} · 金额 ${amtMatch ? "✓" : "✗"}（CMP CA$${cmpAmt.toFixed(2)} / 本地 CA$${localAmt.toFixed(2)}）`,
    };
  }
  if (FAIL_STATES.has(pStatus)) {
    return { decision: "fail", providerStatus: provStatus, providerPaymentId: cmpPid || localPid, providerResponse: sane };
  }
  // init / authorized / processing / 未知 → 保持“正在充值”
  return { decision: "pending", providerStatus: provStatus, providerPaymentId: cmpPid || localPid, providerResponse: sane };
}
