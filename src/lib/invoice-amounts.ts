// New CAD invoices have fx_rate=1; legacy CNY invoices retain their saved conversion rate.
// Never use today's application exchange rate to display an existing invoice.
export function invoiceAmountsCad(invoice: {
  total_cny: unknown;
  fx_rate: unknown;
  paid_cny?: unknown;
  paid_cad?: unknown;
}) {
  const rate = Number(invoice.fx_rate);
  const total = Number(invoice.total_cny);
  const paidCny = Number(invoice.paid_cny ?? 0);
  const paidCad = Number(invoice.paid_cad ?? 0);
  if (invoice.total_cny == null || !(rate > 0) || ![rate, total, paidCny, paidCad].every(Number.isFinite)) {
    throw new Error("账单金额或已保存汇率无效，请联系管理员核对");
  }
  const totalCents = Math.round(total * rate * 100);
  // These fields describe the same payment in two currencies, not two payments.
  const paidCents = Math.max(Math.round(paidCny * rate * 100), Math.round(paidCad * 100));
  return { total: totalCents / 100, paid: paidCents / 100, due: Math.max(0, totalCents - paidCents) / 100 };
}
