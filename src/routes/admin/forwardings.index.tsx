import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listForwardings } from "@/lib/orders.functions";
import { METHOD_LABEL, Page, fmtDate, fmtCAD } from "@/lib/admin-shared";
import { Pagination } from "@/components/admin/Pagination";
import { DeleteRowButton, useCanDelete } from "@/components/admin/DeleteRowButton";
import { deleteForwardingRecord } from "@/lib/admin-delete.functions";
import { Search, Loader2, ArrowRight } from "lucide-react";

export const Route = createFileRoute("/admin/forwardings/")({ component: ForwardingsPage });

const STATUSES = ["all","pending","received","storage","packed","shipped","in_transit","ready_pickup","delivered","cancelled"];
const STATUS_LABEL: Record<string, string> = {
  all:"全部", pending:"待入库", received:"已入库", storage:"仓储中", packed:"已打包",
  shipped:"已发出", in_transit:"运输中", ready_pickup:"可取货", delivered:"已签收", cancelled:"已取消",
  procurement:"代采购", arrived:"清关中",
};
// 每个状态的徽标颜色（tailwind class）—— 可手动调整
const STATUS_COLOR: Record<string, string> = {
  pending:      "bg-slate-500/15 text-slate-300 border-slate-500/30",
  received:     "bg-lime-500/15 text-lime-300 border-lime-500/30",
  storage:      "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  packed:       "bg-amber-500/15 text-amber-300 border-amber-500/30",
  shipped:      "bg-blue-500/15 text-blue-300 border-blue-500/30",
  arrived:      "bg-teal-500/15 text-teal-300 border-teal-500/30",
  in_transit:   "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  ready_pickup: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  delivered:    "bg-violet-500/15 text-violet-300 border-violet-500/30",
  cancelled:    "bg-rose-500/15 text-rose-300 border-rose-500/30",
  procurement:  "bg-pink-500/15 text-pink-300 border-pink-500/30",
};

function ForwardingsPage() {
  const fetchList = useServerFn(listForwardings);
  const delFo = useServerFn(deleteForwardingRecord);
  const canDelete = useCanDelete();
  const qc = useQueryClient();
  const [status, setStatus] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const q = useQuery({
    queryKey: ["admin-forwardings", { status, search, page }],
    queryFn: () => fetchList({ data: { status, search, page, pageSize } }),
  });

  return (
    <Page title="集运单管理" subtitle={q.data ? `共 ${q.data.total} 单` : "加载中…"}>
      <form className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(1); }}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"/>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="集运号/国内国际单号/客户号/批次"
            className="w-72 rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-sm focus:border-brand focus:outline-none"/>
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand focus:outline-none [&>option]:bg-[#0E1626]">
          {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90">搜索</button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5">集运号</th>
              <th className="px-4 py-2.5">客户号</th>
              <th className="px-4 py-2.5">仓库 / 方式</th>
              <th className="px-4 py-2.5">线路</th>
              <th className="px-4 py-2.5">箱数</th>
              <th className="px-4 py-2.5">国内单号</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">费用</th>
              <th className="px-4 py-2.5">批次</th>
              <th className="px-4 py-2.5">创建时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && <tr><td colSpan={11} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500"/></td></tr>}
            {q.data?.items.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-slate-500">暂无数据</td></tr>}
            {q.data?.items.map((f: any) => (
              <tr key={f.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2.5 font-mono text-base">{f.request_no}</td>
                <td className="px-4 py-2.5 text-xs">{f.customer_code ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs">{f.warehouse} · {METHOD_LABEL[f.shipping_method] ?? f.shipping_method}</td>
                <td className="px-4 py-2.5 text-xs">
                  {f.route_code ? (
                    <span><span className="font-mono">{f.route_code}</span>{f.route_name ? <span className="ml-1 text-slate-400">· {f.route_name}</span> : null}</span>
                  ) : "—"}
                </td>
                <td className="px-4 py-2.5 text-center text-xs">{f.waybill_count ?? f.box_count ?? 0}</td>
                <td className="px-4 py-2.5 font-mono text-base text-brand">{f.domestic_tracking_no ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs">
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[f.status] ?? "bg-slate-500/15 text-slate-300 border-slate-500/30"}`}
                    title={f.intake_at ? `入库时间 ${fmtDate(f.intake_at)}` : "未入库"}
                  >
                    {STATUS_LABEL[f.status] ?? f.status ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-xs">{(() => { const snap = f.freight_snapshot ?? {}; const cad = Number(snap.total_cad ?? ((Number(snap.freight_cad ?? 0)) + Number(snap.duty_cad ?? 0) + Number(snap.insurance_cad ?? 0) + Number(snap.surcharges_cad ?? 0))); return cad > 0 ? fmtCAD(cad) : "—"; })()}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{f.batch_no ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{fmtDate(f.created_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link to="/admin/forwardings/$forwardingId" params={{ forwardingId: f.id }}
                    className="inline-flex items-center gap-1 text-xs text-brand hover:underline">详情 <ArrowRight className="h-3 w-3"/></Link>
                  {canDelete && <DeleteRowButton label="集运单" name={f.request_no} extra="其下属运单、物品信息将一并删除。" onDelete={async () => { await delFo({ data: { id: f.id } }); await qc.invalidateQueries({ queryKey: ["admin-forwardings"] }); }}/>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {q.data && <Pagination page={page} pageSize={pageSize} total={q.data.total} onChange={setPage}/>}
    </Page>
  );
}
