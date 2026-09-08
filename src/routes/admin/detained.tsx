import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listDetained } from "@/lib/scan.functions";
import { Page, fmtDate } from "@/lib/admin-shared";
import { Pagination } from "@/components/admin/Pagination";
import { Search, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/detained")({ component: DetainedPage });

const STATUSES = ["all", "detained", "released"];
const LABEL: Record<string, string> = { detained: "滞留中", released: "已释放/入库", all: "全部" };

function DetainedPage() {
  const fetchList = useServerFn(listDetained);
  const [status, setStatus] = useState("detained");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1); const pageSize = 25;
  const q = useQuery({
    queryKey: ["detained", status, search, page],
    queryFn: () => fetchList({ data: { status, search, page, pageSize } }),
  });

  return (
    <Page title="滞留国内单号" subtitle={q.data ? `共 ${q.data.total} 条` : "加载中…"}>
      <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(1); }}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"/>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="国内单号 / 客户号"
            className="w-72 rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-sm"/>
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
          {STATUSES.map(s => <option key={s} value={s}>{LABEL[s]}</option>)}
        </select>
      </form>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
            <tr><th className="px-4 py-2.5">国内单号</th><th>客户号</th><th>状态</th><th>登记时间</th><th>登记人</th><th>释放/入库</th><th>释放人</th><th>备注</th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && <tr><td colSpan={8} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500"/></td></tr>}
            {q.data?.items.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-slate-500">暂无</td></tr>}
            {q.data?.items.map((d: any) => (
              <tr key={d.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-mono text-xs">{d.domestic_tracking_no}</td>
                <td className="px-4 py-3 text-xs font-mono">{d.customer_code ?? "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {d.status === "detained" ? <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">滞留中</span>
                    : <span className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">已释放</span>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(d.created_at)}</td>
                <td className="px-4 py-3 text-xs text-slate-300">{d.created_by_name ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{d.released_at ? fmtDate(d.released_at) : "—"}</td>
                <td className="px-4 py-3 text-xs text-slate-300">{d.released_by_name ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{d.note ?? "—"}</td>
              </tr>
            ))}

          </tbody>
        </table>
      </div>
      {q.data && <Pagination page={page} pageSize={pageSize} total={q.data.total} onChange={setPage}/>}
    </Page>
  );
}
