// Ignore stale, unpaid forwarding insurance when aggregating. Historical paid
// amounts remain unchanged and require a separate accounting review.
export async function effectiveWaybillInsurance<T extends { forwarding_id?: string | null; payment_status?: string | null; insurance_cad?: number | null }>(admin: any, rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.map(w => w.forwarding_id).filter(Boolean))];
  const choices = new Map<string, boolean>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from("forwarding_orders").select("id,insured").in("id", ids.slice(i, i + 200));
    if (error) throw new Error("无法核对投保状态，请重试");
    for (const fo of data ?? []) choices.set(fo.id, fo.insured === true);
  }
  return rows.map(w => {
    if (!w.forwarding_id || w.payment_status === "paid") return w;
    if (!choices.has(w.forwarding_id)) throw new Error("无法核对关联订单的投保状态");
    return choices.get(w.forwarding_id) ? w : { ...w, insurance_cad: 0 };
  });
}
