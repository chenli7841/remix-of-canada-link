export function summarizeReceivables(invoices: any[], profiles: any[], wallets: any[]) {
  const users = new Map(profiles.map((p) => [p.id, p]));
  const balances = new Map(wallets.map((w) => [w.user_id, Number(w.balance_cad)]));
  const rows = new Map<string, any>();
  for (const invoice of invoices) {
    if (!["unpaid", "overdue"].includes(invoice.status)) continue;
    const rate = Number(invoice.fx_rate);
    if (!(rate > 0) || !Number.isFinite(rate) || !Number.isFinite(Number(invoice.total_cny)))
      throw new Error("待付款账单金额或汇率无效，请检查账单");
    const total = Math.round(Number(invoice.total_cny) * rate * 100);
    const paid = Math.max(
      Math.round(Number(invoice.paid_cad || 0) * 100),
      Math.round(Number(invoice.paid_cny || 0) * rate * 100),
    );
    const due = Math.max(0, total - paid);
    if (!due) continue;
    const profile = users.get(invoice.user_id);
    const row = rows.get(invoice.user_id) ?? {
      user_id: invoice.user_id,
      customer_code: profile?.customer_code ?? "未关联客户号",
      full_name: profile?.full_name ?? "",
      cents: 0,
      batches: new Set<string>(),
      balance_cad: balances.get(invoice.user_id) ?? 0,
    };
    row.cents += due;
    if (invoice.batch_no) row.batches.add(invoice.batch_no);
    rows.set(invoice.user_id, row);
  }
  return [...rows.values()]
    .map((r) => ({
      user_id: r.user_id,
      customer_code: r.customer_code,
      full_name: r.full_name,
      due_cad: r.cents / 100,
      batch_count: r.batches.size,
      balance_cad: r.balance_cad,
    }))
    .sort((a, b) => b.due_cad - a.due_cad || a.customer_code.localeCompare(b.customer_code));
}
export function shippedBatchAges(batches: any[], now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return batches
    .filter((b) => b.status === "shipped" && ["air", "sea"].includes(b.shipping_method))
    .map((b) => {
      const date = b.actual_ship_date || b.planned_ship_date || null;
      const time = date ? Date.parse(String(date).slice(0, 10) + "T00:00:00Z") : NaN;
      const days = Number.isFinite(time)
        ? Math.max(0, Math.floor((Date.parse(today + "T00:00:00Z") - time) / 86400000))
        : null;
      const limit = b.shipping_method === "sea" ? 30 : 12;
      return {
        ...b,
        ship_date: date,
        estimated_date: !b.actual_ship_date,
        days,
        limit,
        overdue: days !== null && days > limit,
      };
    })
    .sort((a, b) => (a.ship_date || "9999").localeCompare(b.ship_date || "9999"));
}
