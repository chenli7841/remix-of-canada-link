import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listAdminLogs, logFacets } from "@/lib/admin-logs.functions";
import { Pagination } from "@/components/admin/Pagination";
import { History, Loader2, Download } from "lucide-react";

export const Route = createFileRoute("/admin/logs")({ component: LogsPage });

function LogsPage() {
  const fetchList = useServerFn(listAdminLogs);
  const fetchFacets = useServerFn(logFacets);
  const [page, setPage] = useState(1);
  const [entity_type, setEntity] = useState("");
  const [action, setAction] = useState("");
  const [q, setQ] = useState(""); const [qIn, setQIn] = useState("");
  const [dateFrom, setDateFrom] = useState(""); const [dateTo, setDateTo] = useState("");
  const pageSize = 20;

  const listQ = useQuery({
    queryKey: ["admin-logs", { page, entity_type, action, q, dateFrom, dateTo }],
    queryFn: () => fetchList({ data: {
      page, pageSize,
      entity_type: entity_type || undefined, action: action || undefined,
      q: q || undefined, date_from: dateFrom || undefined, date_to: dateTo || undefined,
    } }),
  });
  const facetsQ = useQuery({ queryKey: ["log-facets"], queryFn: () => fetchFacets(), staleTime: 60_000 });

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;

  const exportCSV = () => {
    const rows = [["时间", "操作人", "类型", "动作", "实体ID", "备注"]];
    for (const l of items) rows.push([
      new Date(l.created_at).toLocaleString("zh-CN"),
      l.operator_name ?? "", l.entity_type, l.action, l.entity_id, l.note ?? "",
    ]);
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `admin-logs-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
            <History className="h-5 w-5 text-blue-400"/>操作日志
          </h1>
          <p className="mt-1 text-sm text-slate-400">共 {total} 条 · 仅当前页可导出</p>
        </div>
        <button onClick={exportCSV} className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-2 text-sm hover:bg-white/5">
          <Download className="h-4 w-4"/>导出 CSV
        </button>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); setQ(qIn.trim()); setPage(1); }}
        className="mb-4 flex flex-wrap gap-2 text-sm">
        <select value={entity_type} onChange={(e) => { setEntity(e.target.value); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 [&>option]:bg-[#0E1626]">
          <option value="">全部类型</option>
          {(facetsQ.data?.types ?? []).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 [&>option]:bg-[#0E1626]">
          <option value="">全部动作</option>
          {(facetsQ.data?.actions ?? []).map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5"/>
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5"/>
        <input value={qIn} onChange={(e) => setQIn(e.target.value)} placeholder="操作人 / 备注 / 实体ID"
          className="w-64 rounded-md border border-white/10 bg-white/5 px-2 py-1.5"/>
        <button className="rounded-md bg-brand px-3 py-1.5 font-semibold text-white hover:bg-brand/90">搜索</button>
      </form>

      <div className="overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2.5">时间</th>
              <th className="px-3 py-2.5">操作人</th>
              <th className="px-3 py-2.5">类型</th>
              <th className="px-3 py-2.5">动作</th>
              <th className="px-3 py-2.5">实体 ID</th>
              <th className="px-3 py-2.5">备注</th>
              <th className="px-3 py-2.5">数据</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {listQ.isLoading && <tr><td colSpan={7} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500"/></td></tr>}
            {!listQ.isLoading && items.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-slate-500">暂无</td></tr>}
            {items.map((l: any) => (
              <tr key={l.id} className="hover:bg-white/[0.03] align-top">
                <td className="px-3 py-2 text-xs text-slate-400">{new Date(l.created_at).toLocaleString("zh-CN")}</td>
                <td className="px-3 py-2 text-xs">{l.operator_name ?? "—"}</td>
                <td className="px-3 py-2 text-xs font-mono">{l.entity_type}</td>
                <td className="px-3 py-2 text-xs"><span className="rounded bg-white/5 px-1.5 py-0.5">{l.action}</span></td>
                <td className="px-3 py-2 font-mono text-[10px] text-slate-400">{l.entity_id?.slice(0, 8)}</td>
                <td className="px-3 py-2 text-xs text-slate-300">{l.note ?? "—"}</td>
                <td className="px-3 py-2">
                  {(l.before || l.after) && (
                    <details>
                      <summary className="cursor-pointer text-[10px] text-brand">展开</summary>
                      <pre className="mt-1 max-w-xs overflow-auto rounded bg-black/30 p-1 text-[10px] text-slate-300">{JSON.stringify({ before: l.before, after: l.after }, null, 2)}</pre>
                    </details>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {listQ.data && <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage}/>}
    </div>
  );
}
