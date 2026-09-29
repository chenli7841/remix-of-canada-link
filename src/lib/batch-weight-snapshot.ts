export function savedChargeableWeight(w: any): number | null {
  const value = w.weight_snapshot?.chargeable_weight;
  if (value == null || (typeof value === "string" && !value.trim()) || typeof value === "boolean") return null;
  const n = Number(value);
  // A pre-measurement zero snapshot must not hide a later positive measurement.
  if (n === 0 && (Number(w.weight_kg) > 0 || Number(w.length_cm) * Number(w.width_cm) * Number(w.height_cm) > 0)) return null;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function weightTotal(rows: any[]): number | null {
  const values = rows.map(r => savedChargeableWeight({ weight_snapshot: { chargeable_weight: r.chargeable_weight_kg } }));
  if (!values.length || values.some(v => v == null)) return null;
  return +values.reduce<number>((sum, v) => sum + v!, 0).toFixed(3);
}

// Merged freight uses max(sum(actual), sum(volume)/divisor), not sum of
// individually billable weights. Consume the very snapshot that priced freight.
export function billingWeight(scheme: string, orders: any[], freightSnapshot?: any): number | null {
  return scheme === "merged"
    ? savedChargeableWeight({ weight_snapshot: freightSnapshot })
    : weightTotal(orders);
}

// One order can span several route buckets; merge its stored subtotals once.
export function mergeWeightOrders(rows: any[]): any[] {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const key = `${row.kind}:${row.id}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()].map(parts => ({
    ...parts[0],
    missing_waybills: [...new Set(parts.flatMap(p => p.missing_waybills ?? []))],
    chargeable_weight_kg: weightTotal(parts),
    payment_status: parts.every(p => p.payment_status === "paid") ? "paid" : "unpaid",
  }));
}

export function buildWeightOrders(waybills: any[], orders: Map<string, any>, forwardings: Map<string, any>): any[] {
  return mergeWeightOrders([...new Map(waybills.map(w => [w.id, w])).values()].map(w => {
    const parent = orders.get(w.order_id) ?? forwardings.get(w.forwarding_id);
    return {
      kind: w.order_id ? "order" : "forwarding",
      id: w.order_id ?? w.forwarding_id ?? w.id,
      no: parent?.order_no ?? parent?.request_no ?? w.waybill_no,
      status: parent?.status ?? w.status,
      tracking_no: w.intl_tracking_no ?? null,
      payment_status: w.payment_status,
      chargeable_weight_kg: savedChargeableWeight(w),
      missing_waybills: savedChargeableWeight(w) == null ? [w.waybill_no ?? w.id] : [],
    };
  }));
}
