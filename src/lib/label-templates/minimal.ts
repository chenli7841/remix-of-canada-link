import type { LabelData, WaybillEntry } from "./types";
import { barcodeSVG } from "./barcode";

/**
 * 极简面单模板
 * 尺寸：150mm × 100mm 横向
 * 用途：订单 / 集运单 的运单标签（仅保留核心信息）
 * 包含：运单号条码、客户号、目的地、重量
 */
export function minimalTemplate(d: LabelData): string {
  const u = d.user ?? {};
  const p = d.parent ?? {};
  const list = d.waybills?.length ? d.waybills : [{ waybill_no: "—" } as WaybillEntry];

  return list.map((w) => `
<div class="label minimal">
  <div class="minimal-header">
    <div class="minimal-route">${p.route_code ?? "—"}</div>
    <div class="minimal-dest">${p.destination_code ?? "—"}</div>
  </div>
  <div class="minimal-body">
    <div class="bc-xl">${barcodeSVG(w.waybill_no || "—", 70)}</div>
    <div class="minimal-meta">
      <div><span class="muted">客户号</span><b class="mono">${u.customer_code ?? "—"}</b></div>
      <div><span class="muted">重量</span><b>${w.weight_kg ?? "—"} kg</b></div>
    </div>
  </div>
</div>`).join("");
}
