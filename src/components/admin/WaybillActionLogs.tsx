import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getWaybillActionLogs } from "@/lib/orders.functions";
import { logActionLabel, logDetailsText } from "@/lib/admin-log-labels";
import { fmtDate } from "@/lib/admin-shared";

type Waybill = { id: string; waybill_no: string; created_at?: string };
export function WaybillActionLogs({ waybills }: { waybills: Waybill[] }) {
  const sorted = [...waybills].sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? "") || a.id.localeCompare(b.id));
  if (!sorted.length) return <p className="text-xs text-slate-400">暂无运单操作记录</p>;
  return <div className="space-y-3">{sorted.map((w, i) => <WaybillLogGroup key={w.id} waybill={w} defaultOpen={i === 0} />)}</div>;
}
function WaybillLogGroup({ waybill, defaultOpen }: { waybill: Waybill; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const fetchLogs = useServerFn(getWaybillActionLogs);
  const query = useInfiniteQuery({
    queryKey: ["admin-waybill-action-logs", waybill.id],
    queryFn: ({ pageParam }) => fetchLogs({ data: { waybillId: waybill.id, offset: pageParam } }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => last.hasMore ? pages.length * 50 : undefined,
    enabled: open,
  });
  const logs = query.data?.pages.flatMap(p => p.logs) ?? [];
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="rounded-xl border border-white/10">
    <summary className="cursor-pointer break-all p-3 text-sm font-semibold text-slate-200">{waybill.waybill_no}</summary>
    {open && <div className="max-h-96 space-y-2 overflow-y-auto px-3 pb-3">
      {query.isPending && <p className="text-xs text-slate-400">正在读取操作记录…</p>}
      {query.isError && <p className="text-xs text-rose-400">读取失败<button className="ml-2 underline" onClick={() => query.refetch()}>重试</button></p>}
      {query.isSuccess && !logs.length && <p className="text-xs text-slate-400">该运单暂无操作记录</p>}
      {logs.map((log: any) => <div key={log.id} className="rounded-md border border-white/5 bg-white/[0.02] p-2 text-xs">
        <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-slate-200">{logActionLabel(log.action)}</span><span className="text-slate-400">{fmtDate(log.created_at)}</span></div>
        <div className="break-words text-slate-400">操作人：{log.operator_name ?? "—"}{log.note ? ` · ${log.note}` : ""}</div>
        {(log.before || log.after) && <details className="mt-1"><summary className="cursor-pointer text-slate-400">变更详情</summary><pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-slate-400">{logDetailsText({ before: log.before, after: log.after })}</pre></details>}
      </div>)}
      {query.hasNextPage && <button className="text-xs text-sky-400" disabled={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>{query.isFetchingNextPage ? "正在读取…" : "加载更早记录"}</button>}
    </div>}
  </details>;
}
