// Shared helper for writing to admin_action_logs — the audit trail behind
// /admin/logs (see admin-logs.functions.ts). Every admin-privileged write
// across the app should call this after the write succeeds, so "谁在什么时候
// 改了什么" is always answerable. Several files already had their own local
// copy of this exact shape (orders.functions.ts, admin-customer-view.functions.ts,
// cartons.functions.ts) before this was pulled out — those are untouched to
// avoid churn, this is for every new call site.
export async function recordAdminLog(
  admin: any,
  opts: {
    entity_type: string;
    entity_id: string;
    action: string;
    before?: any;
    after?: any;
    operator_id: string;
    operator_name?: string;
    note?: string;
  },
) {
  try {
    await admin.from("admin_action_logs").insert({
      entity_type: opts.entity_type,
      entity_id: opts.entity_id,
      action: opts.action,
      before: opts.before ?? null,
      after: opts.after ?? null,
      operator_id: opts.operator_id,
      operator_name: opts.operator_name ?? null,
      note: opts.note ?? null,
    });
  } catch {
    // A logging failure should never fail the underlying admin action.
  }
}
