import { weightTotal } from "./batch-weight-snapshot";

// Use the same saved billing totals as the customer bill, including all routes.
export function deliveryWeightsByCustomer(rows: any[], excluded = new Set<string>(), only?: Set<string>) {
  const groups = new Map<string, any[]>();
  for (const row of rows) {
    const code = row.customer_code as string | null;
    if (!code || excluded.has(code) || (only && !only.has(code))) continue;
    groups.set(code, [...(groups.get(code) ?? []), row]);
  }
  return new Map([...groups].map(([code, parts]) => {
    const weight = weightTotal(parts);
    if (weight == null) throw new Error(`客户 ${code} 缺少有效的总计费重量，请先刷新计费重量快照后重试`);
    return [code, { weight, hadDelivery: parts.some(p => Number(p.fee_delivery_cad ?? 0) > 0) }];
  }));
}
