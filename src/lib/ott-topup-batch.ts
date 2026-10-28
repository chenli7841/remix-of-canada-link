export type OttBatchRow = { id: string; ref_no?: string | null; is_ott: boolean; status: string };
export type OttBatchResult = { id: string; reference: string; outcome: "completed" | "failed" | "pending" | "attention"; message: string };

/** Freeze the filtered pending list before any settlement changes pagination. */
export async function collectOttBatchRows(list: (page: number) => Promise<{ rows: OttBatchRow[]; total: number; pageSize: number }>) {
  const rows = new Map<string, OttBatchRow>();
  for (let page = 1; ; page++) {
    const result = await list(page);
    if (!Number.isFinite(result.total) || result.pageSize <= 0) throw new Error("充值列表分页信息无效");
    for (const row of result.rows) if (row.is_ott && row.status === "pending") rows.set(row.id, row);
    if (page * result.pageSize >= result.total || result.rows.length === 0) break;
  }
  return [...rows.values()];
}

/** Query independently, so one gateway error never prevents later records. */
export async function runOttBatch(rows: OttBatchRow[], query: (id: string) => Promise<any>, progress: (done: number, total: number) => void) {
  const results: OttBatchResult[] = [];
  const unique = [...new Map(rows.filter((r) => r.is_ott && r.status === "pending").map((r) => [r.id, r])).values()];
  progress(0, unique.length);
  for (const row of unique) {
    let outcome: OttBatchResult["outcome"] = "attention", message: string;
    try {
      const result = await query(row.id);
      if (result.ok && result.status === "completed") {
        outcome = "completed"; message = result.settled_now ? "核验成功，已入账" : "已入账，未重复充值";
      } else if (result.ok && ["failed", "cancelled"].includes(result.status)) {
        outcome = result.notificationQueued ? "failed" : "attention";
        message = result.notificationQueued ? "已确认不成功，微信通知已加入预发送" : `已确认不成功，通知待重试：${result.notificationError ?? "未确认通知生成"}`;
      } else if (result.status === "pending" && !result.error && !result.warning) {
        outcome = "pending"; message = "OTT 仍在处理，保留待核验";
      } else message = result.error ?? result.warning ?? "结果未确认，保留待核验";
    } catch (error: any) { message = error?.message ?? "查询异常，保留待核验"; }
    results.push({ id: row.id, reference: row.ref_no ?? row.id, outcome, message });
    progress(results.length, unique.length);
  }
  return results;
}
