import type { LabelData, WaybillEntry } from "./types";
import { barcodeSVG } from "./barcode";

/**
 * 标准面单模板（默认）
 * 尺寸：150mm × 100mm 横向
 * 布局：顶部唛头号黑条 → 集运单条码（整行）→ 运单号·箱号条码（整行）→ 底部左右两栏信息
 */
export function standardTemplate(d: LabelData): string {
  const addr = d.address ?? {};
  const u = d.user ?? {};
  const recipient = addr.recipient ?? addr.name ?? u.full_name ?? "—";
  const phone = addr.phone ?? u.phone ?? "—";
  const addrLine1 = [addr.line1 ?? addr.address1, addr.line2].filter(Boolean).join(", ");
  const addrLine2 = [addr.city, addr.province ?? addr.state, addr.postal_code ?? addr.zip, addr.country].filter(Boolean).join(", ");
  const list = d.waybills?.length ? d.waybills : [{ waybill_no: "—" } as WaybillEntry];
  const xx = String(d.total || list.length).padStart(2, "0");
  const domesticNo = d.domesticTrackingNo ?? (d.parent as any)?.domestic_tracking_no ?? d.entityNo ?? "—";

  return list.map((w, i) => {
    const aa = String(i + 1).padStart(2, "0");
    const markNo = w.mark_no ?? (d.parent as any)?.mark_no ?? null;
    const markText = markNo ?? `${u.customer_code ?? "—"}-${aa}/${xx}`;
    return `
<div class="label std">
  <div class="mark">唛头号 · ${markText}</div>
  <div class="std-bc">
    <div class="muted">国内运单号</div>
    <div class="bc-full">${barcodeSVG(domesticNo || "—", 52)}</div>
  </div>
  <div class="std-bc">
    <div class="muted">运单号 · 箱号 ${aa}/${xx}</div>
    <div class="bc-full">${barcodeSVG(w.waybill_no || "—", 52)}</div>
  </div>
  <div class="std-info">
    <div class="std-col">
      <div class="row"><span class="muted">客户号</span><b class="mono">${u.customer_code ?? "—"}</b></div>
      <div class="row"><span class="muted">计费重量</span><b>${w.chargeable_kg ?? w.weight_kg ?? "—"} kg</b></div>
      <div class="row"><span class="muted">物品</span><b class="clip left">${w.items_name ?? d.parent?.items_desc ?? "—"}</b></div>
    </div>
    <div class="std-col">
      <div class="row"><span class="muted">收件人</span><b>${recipient}</b></div>
      <div class="row"><span class="muted">电话</span><b>${phone}</b></div>
      <div class="addr"><div class="muted">地址</div><div class="addr-body">${addrLine1 || "—"}${addrLine2 ? `<br/>${addrLine2}` : ""}</div></div>
    </div>
  </div>
</div>`;
  }).join("");
}
