import { loadBatchWaybills } from "./batch-waybills.server";

// Only advance logistics states; retrying a batch action must not undo arrival or delivery.
export async function syncBatchWaybillStatus(admin: any, batchId: string, status: string) {
  if (status !== "shipped" && status !== "arrived") return 0;
  const rows = await loadBatchWaybills(admin, batchId);
  const eligible = ["pending", "procurement", "received", "storage", "packed"];
  if (status === "arrived") eligible.push("shipped");
  const ids = rows.filter(w => eligible.includes(w.status)).map(w => w.id);
  let updated = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin.from("waybills")
      .update({ status }).in("id", ids.slice(i, i + 100))
      .in("status", eligible).select("id");
    if (error) throw new Error(`运单状态同步失败，请重试：${error.message}`);
    updated += data?.length ?? 0;
  }
  // Also repair stale parent summaries on a retry, even when every child is already current.
  const parents = new Map<string, { _order_id: string | null; _forwarding_id: string | null }>();
  for (const w of rows) {
    if (w.order_id) parents.set(`o:${w.order_id}`, { _order_id: w.order_id, _forwarding_id: null });
    if (w.forwarding_id) parents.set(`f:${w.forwarding_id}`, { _order_id: null, _forwarding_id: w.forwarding_id });
  }
  for (const args of parents.values()) {
    const { error } = await admin.rpc("recompute_parent_status", args);
    if (error) throw new Error(`订单状态汇总失败，请重试：${error.message}`);
  }
  return updated;
}
