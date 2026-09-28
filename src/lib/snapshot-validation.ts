// Null/blank/non-finite data is missing; numeric zero is a valid stored value.
export function assertSnapshotNumbers(label: string, values: Record<string, unknown>) {
  const missing = Object.entries(values).filter(([, v]) => v == null || (typeof v === "string" && !v.trim()) || typeof v === "boolean" || !Number.isFinite(Number(v)) || Number(v) < 0).map(([k]) => k);
  if (missing.length) throw new Error(`${label}：快照未生成，缺少或无效的数据：${missing.join("、")}。请补齐后重新生成。`);
}

export function assertBatchWeightSnapshot(customer: string, buckets: any[]) {
  const issues = buckets.flatMap(b => (b.weight_orders ?? []).filter((o: any) => o.chargeable_weight_kg == null).map((o: any) => `${o.no ?? o.id} / 运单 ${(o.missing_waybills ?? []).join("、")}（计费重量）`));
  for (const b of buckets) {
    if (!(b.weight_orders?.length) && Number(b.waybill_count ?? 0) + Number(b.carton_count ?? 0) + Number(b.pallet_count ?? 0) > 0) {
      issues.push(`${b.route_code ?? "未指定线路"}（订单关联或计费重量）`);
    }
  }
  if (issues.length) throw new Error(`客户 ${customer}：快照未生成，缺失数据：${[...new Set(issues)].join("、")}。请补齐后重新生成。`);
  for (const b of buckets) assertSnapshotNumbers(`客户 ${customer} / ${b.route_code ?? "未指定线路"}`, {
    小计: b.subtotal_cad, 运费: b.fee_freight_cad, 关税: b.fee_customs_cad,
    保费: b.fee_insurance_cad, 清关费: b.fee_clearance_cad, 附加费: b.fee_surcharge_cad,
  });
}
