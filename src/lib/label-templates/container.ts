import type { LabelData } from "./types";
import { barcodeSVG } from "./barcode";

/**
 * 容器面单模板（默认）
 * 尺寸：150mm × 100mm 横向
 * 用途：箱号 / 托盘号 / 批次号 标签
 * 包含：容器编号、条码、状态、重量、所属批次/托盘、运输方式、目的地、线路、客户号等
 */
export function containerTemplate(d: LabelData): string {
  const m = d.meta ?? {};
  const titleMap = { carton: "箱号", pallet: "托盘号", batch: "批次号" } as const;
  const title = titleMap[d.entityType as "carton" | "pallet" | "batch"];
  const rows: [string, any][] = [];
  if (m.status) rows.push(["状态", m.status]);
  if (m.weight_kg != null) rows.push(["重量", `${m.weight_kg} kg`]);
  if (m.batch_no) rows.push(["所属批次", m.batch_no]);
  if (m.pallet_no) rows.push(["所属托盘", m.pallet_no]);
  if (m.shipping_method) rows.push(["运输方式", m.shipping_method]);
  if (m.destination_code) rows.push(["目的地", m.destination_code]);
  if (m.route_code) rows.push(["线路", m.route_code]);
  if (m.customer_code) rows.push(["客户号", m.customer_code]);
  if (m.pickup_warehouse) rows.push(["取货点", m.pickup_warehouse]);
  if (m.cargo_type) rows.push(["货物", m.cargo_type]);
  if (m.planned_ship_date) rows.push(["计划发货", m.planned_ship_date]);
  if (m.eta_date) rows.push(["预计到货", m.eta_date]);
  if (m.vessel_no) rows.push(["船号/航空", m.vessel_no]);
  if (m.payment_status) rows.push(["付款", m.payment_status === "paid" ? "已付款" : m.payment_status === "partial" ? "部分付款" : m.payment_status === "empty" ? "—" : "未付款"]);
  if (m.created_at) rows.push(["创建", new Date(m.created_at).toLocaleString("zh-CN", { hour12: false })]);
  const counts = m.counts || {};
  if (counts.waybills != null) rows.push(["运单数", counts.waybills]);
  if (counts.cartons != null) rows.push(["箱数", counts.cartons]);
  if (counts.pallets != null) rows.push(["托盘数", counts.pallets]);
  if (m.notes) rows.push(["备注", m.notes]);
  const markNo = m.mark_no ?? null;

  return `
<div class="label">
  ${markNo ? `<div class="mark">唛头号 · ${markNo}</div>` : ""}
  <div class="grid">
    <div class="left">
      <div class="block">
        <div class="muted">${title}</div>
        <div class="entity">${d.entityNo}</div>
      </div>
      <div class="bc-lg">${barcodeSVG(d.entityNo, 46)}</div>
    </div>
    <div class="right">
      ${rows.map(([k, v]) => `<div class="row"><span class="muted">${k}</span><b class="clip">${v}</b></div>`).join("")}
    </div>
  </div>
</div>`;
}
