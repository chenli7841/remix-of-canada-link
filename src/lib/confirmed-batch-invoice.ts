// Batch confirmation, invoice lines and display all use the same CAD cents.
export function cadCents(value: unknown, label: string): number {
  if (value == null || typeof value === "boolean" || (typeof value === "string" && !value.trim()) || !Number.isFinite(Number(value))) {
    throw new Error(`${label}缺失或无效，不能生成或支付账单`);
  }
  return Math.round(Number(value) * 100);
}

export function buildConfirmedBatchInvoice(snapshot: any) {
  const routes = snapshot.fee_breakdown?.per_route;
  if (!Array.isArray(routes) || !routes.length) throw new Error("缺少批次费用明细，请先补齐数据");
  const fields = [
    ["fee_freight_cad", "运费", "freight_cny"],
    ["fee_customs_cad", "关税", "customs_cny"],
    ["fee_insurance_cad", "保险", "insurance_cny"],
    ["fee_clearance_cad", "清关费", "other_cny"],
    ["fee_surcharge_cad", "附加费", "other_cny"],
    ["fee_delivery_cad", "末端派送费", "other_cny"],
    ["fee_inspection_cad", "检查费", "other_cny"],
    ["fee_discount_cad", "折扣", "other_cny"],
  ];
  const lines: any[] = [];
  for (const route of routes) {
    cadCents(route.chargeable_weight_kg, `${route.route_code ?? "线路"}计费重量`);
    cadCents(route.freight_rate_cad, `${route.route_code ?? "线路"}运费单价`);
    if (Number(route.chargeable_weight_kg)<0 || Number(route.freight_rate_cad)<0) throw new Error("计费重量和线路单价不能为负数");
    let routeTotal = 0;
    for (const [field, label, column] of fields) {
      let cents = cadCents(route[field], `${route.route_code ?? "线路"} ${label}`);
      if (field === "fee_discount_cad") cents = -cents;
      routeTotal += cents;
      // Keep zero-valued fee categories explicit, including uninsured insurance.
      lines.push({ description: `${route.route_code ?? "批次"} · ${label}`, amount_cny: cents / 100,
        freight_cny: 0, customs_cny: 0, insurance_cny: 0, other_cny: 0, [column]: cents / 100,
        meta: { fee_type: label, route_code: route.route_code, currency: "CAD", billing_version: 2, batch_chargeable_weight_kg: snapshot.fee_breakdown.chargeable_weight_kg ?? null,
          ...(field === "fee_freight_cad" ? { freight: { chargeable_weight_kg: Number(route.chargeable_weight_kg), rate_cad_per_kg: Number(route.freight_rate_cad), amount_cad: cents / 100 } } : {}),
        } });
    }
    if (routeTotal !== cadCents(route.subtotal_cad, "线路小计")) throw new Error(`${route.route_code ?? "线路"}费用明细与小计不一致，请核对折扣及附加费`);
  }
  const cents = lines.reduce((sum, l) => sum + cadCents(l.amount_cny, "明细金额"), 0);
  if (cents < 0 || cents !== cadCents(snapshot.subtotal_cad, "批次账单金额")) throw new Error("批次费用明细与总额不一致，不能确认");
  return { lines, total_cad: cents / 100 };
}

export function assertConfirmedInvoice(snapshot: any, invoice: any, expected?: number) {
  if (!snapshot?.confirmed || !invoice || snapshot.fee_breakdown?.invoice_id !== invoice.id || snapshot.fee_breakdown?.billing_version !== 2) {
    throw new Error("缺少已确认且关联的账单，请后台重新确认价格生成账单");
  }
  if (!["unpaid", "overdue", "paid"].includes(invoice.status)) throw new Error("账单状态不可用于结算");
  const amount = cadCents(Number(invoice.total_cny) * Number(invoice.fx_rate), "账单金额");
  if (invoice.total_cny == null || !(Number(invoice.fx_rate) > 0) || amount !== cadCents(snapshot.subtotal_cad, "批次显示金额")) throw new Error("批次显示金额与账单金额不一致，请核对后重新确认");
  if (expected !== undefined && cadCents(expected, "待扣款金额") !== amount) throw new Error("页面金额与已生成账单不一致，请刷新后重试");
  return amount / 100;
}
