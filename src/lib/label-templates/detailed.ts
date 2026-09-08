import type { LabelData, WaybillEntry } from "./types";
import { barcodeSVG } from "./barcode";

/**
 * 详细面单模板
 * 尺寸：150mm × 100mm 横向
 * 用途：订单 / 集运单 的运单标签（信息更完整）
 * 包含：标准模板所有内容 + 国内单号、运输方式、付款状态、备注、创建时间
 */
export function detailedTemplate(d: LabelData): string {
  const addr = d.address ?? {};
  const u = d.user ?? {};
  const p = d.parent ?? {};
  const recipient = addr.recipient ?? addr.name ?? u.full_name ?? "—";
  const phone = addr.phone ?? u.phone ?? "—";
  const addressLine = [addr.line1 ?? addr.address1, addr.line2, addr.city, addr.province ?? addr.state, addr.postal_code ?? addr.zip, addr.country].filter(Boolean).join(", ") || "—";
  const list = d.waybills?.length ? d.waybills : [{ waybill_no: "—" } as WaybillEntry];
  const xx = String(d.total || list.length).padStart(2, "0");
  const entityLabel = d.entityType === "order" ? "订单" : "集运单";

  const extraRows: [string, any][] = [];
  if (p.domestic_tracking_no) extraRows.push(["国内单号", p.domestic_tracking_no]);
  if (p.shipping_method) extraRows.push(["运输方式", p.shipping_method]);
  if (p.payment_status) extraRows.push(["付款", p.payment_status === "paid" ? "已付款" : p.payment_status === "partial" ? "部分付款" : "未付款"]);
  if (p.note) extraRows.push(["备注", p.note]);
  if (p.created_at) {
    const fmt = new Date(p.created_at).toLocaleString("zh-CN", { hour12: false });
    extraRows.push(["创建", fmt]);
  }

  return list.map((w, i) => {
    const aa = String(i + 1).padStart(2, "0");
    const markNo = w.mark_no ?? p.mark_no ?? null;
    return `
<div class="label detailed">
  ${markNo ? `<div class="mark">唛头号 · ${markNo}</div>` : ""}
  <div class="detailed-grid">
    <div class="detailed-left">
      <div class="block">
        <div class="muted">${entityLabel}</div>
        <div class="bc-lg">${barcodeSVG(d.entityNo || "—", 40)}</div>
      </div>
      <div class="block">
        <div class="muted">运单号 · ${aa}/${xx}</div>
        <div class="bc-lg">${barcodeSVG(w.waybill_no || "—", 40)}</div>
      </div>
      <div class="row"><span class="muted">客户号</span><b class="mono">${u.customer_code ?? "—"}</b></div>
      <div class="row"><span class="muted">重量</span><b>${w.weight_kg ?? "—"} kg</b></div>
      ${extraRows.map(([k, v]) => `<div class="row"><span class="muted">${k}</span><b class="clip">${v}</b></div>`).join("")}
    </div>
    <div class="detailed-right">
      <div class="row"><span class="muted">物品</span><b class="clip">${w.items_name ?? p.items_desc ?? "—"}</b></div>
      <div class="row"><span class="muted">收件人</span><b>${recipient}</b></div>
      <div class="row"><span class="muted">电话</span><b>${phone}</b></div>
      <div class="addr"><div class="muted">地址</div><div class="addr-body">${addressLine}</div></div>
    </div>
  </div>
</div>`;
  }).join("");
}
