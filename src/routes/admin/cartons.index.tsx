import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listCartons, createCarton, getContainerLabelData } from "@/lib/cartons.functions";
import { Page, fmtDate } from "@/lib/admin-shared";
import { Pagination } from "@/components/admin/Pagination";
import { Plus, Loader2, ArrowRight, Printer, Filter } from "lucide-react";
import { renderLabel } from "@/lib/label-render";
import { ContainerCreateDialog } from "@/components/admin/ContainerCreateDialog";
import { DeleteRowButton, useCanDelete } from "@/components/admin/DeleteRowButton";
import { deleteCarton } from "@/lib/cartons.functions";

export const Route = createFileRoute("/admin/cartons/")({ component: CartonsPage });

function PaymentBadge({ s }: { s: string }) {
  const map: Record<string, string> = {
    paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    partial: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    unpaid: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    empty: "bg-slate-500/15 text-slate-400 border-slate-500/30",
  };
  const label: Record<string, string> = { paid: "已付", partial: "部分", unpaid: "未付", empty: "—" };
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${map[s]}`}>{label[s]}</span>;
}

function CartonsPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listCartons);
  const create = useServerFn(createCarton);
  const fetchLabel = useServerFn(getContainerLabelData);
  const delCarton = useServerFn(deleteCarton);
  const canDelete = useCanDelete();

  const [search, setSearch] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [page, setPage] = useState(1); const pageSize = 10;
  const q = useQuery({
    queryKey: ["cartons", search, showClosed, page],
    queryFn: () => fetchList({ data: { search, showClosed, page, pageSize } }),
  });

  const [show, setShow] = useState(false);

  const onPrint = async (id: string) => {
    const d = await fetchLabel({ data: { kind: "carton", id } });
    renderLabel(d as any);
  };

  return (
    <Page title="箱号管理" subtitle={q.data ? `共 ${q.data.total} 个箱` : "加载中…"}
      action={<button onClick={() => setShow(true)} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4"/>新建箱号</button>}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Filter className="h-3 w-3"/>搜索筛选</div>
        <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="箱号 / 客户号 / 线路 / 批次号 / 目的地"
          className="w-96 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
        {search && (
          <button onClick={() => { setSearch(""); setPage(1); }}
            className="text-xs text-slate-400 hover:text-slate-200">清空</button>
        )}
        <label className="ml-2 inline-flex items-center gap-1.5 text-xs text-slate-300">
          <input type="checkbox" checked={showClosed} onChange={(e) => { setShowClosed(e.target.checked); setPage(1); }} className="h-3.5 w-3.5 accent-brand"/>
          显示已关闭
        </label>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
            <tr><th className="px-4 py-2.5">箱号</th><th>线路</th><th>客户</th><th>目的地</th><th>状态</th><th>付款</th><th>计费重<div className="normal-case text-[10px] text-slate-500"><span className="text-sky-300/70">本身</span> / <span className="text-amber-300/70">运单合计</span></div></th><th>总费用 (CAD)<div className="normal-case text-[10px] text-slate-500"><span className="text-sky-300/70">A 本身</span> / <span className="text-amber-300/70">B 运单合计</span></div></th><th>所属托盘</th><th>所属批次</th><th>创建</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && <tr><td colSpan={12} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500"/></td></tr>}
            {q.data?.items.length === 0 && <tr><td colSpan={12} className="py-10 text-center text-slate-500">暂无</td></tr>}
            {q.data?.items.map((c: any) => {
              const selfChg = Number(c.self_chargeable_kg ?? 0);
              const childChg = Number(c.child_chargeable_kg ?? 0);
              return (
              <tr key={c.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2.5">
                  {c.display_name && <div className="text-sm font-semibold text-slate-100">{c.display_name}</div>}
                  <div className="font-mono text-base text-brand">{c.carton_no}</div>
                </td>
                <td className="text-sm text-slate-400">{c.route_code ?? "—"}</td>
                <td className="text-sm font-mono">{c.customer_code ?? "—"}</td>
                <td className="text-sm text-slate-400">{c.destination_code ?? "—"}</td>
                <td className="text-sm">{c.status}</td>
                <td><PaymentBadge s={c.payment_status}/></td>
                <td className="text-sm" title={`采用 ${c.has_customer ? "本身计费重(A)" : "运单合计计费重(B)"}`}>
                  <div className={`font-mono ${c.has_customer ? "font-bold text-sky-300" : "text-sky-300/60"}`}>本身 {selfChg ? `${selfChg} kg` : "—"}</div>
                  <div className={`font-mono ${c.has_customer ? "text-amber-300/60" : "font-bold text-amber-300"}`}>运单 {childChg ? `${childChg} kg` : "—"}</div>
                </td>
                <td className="text-sm font-mono" title={`A 本身计费 = 自身运费 CA$${Number(c.self_freight_cad ?? 0).toFixed(2)} + 关税 CA$${Number(c.child_customs_cad ?? 0).toFixed(2)} + 保险 CA$${Number(c.child_insurance_cad ?? 0).toFixed(2)} + 附加费 CA$${Number(c.surcharge_cad ?? 0).toFixed(2)}\nB 运单合计 = 下属运费 CA$${Number(c.child_freight_cad ?? 0).toFixed(2)} + 关税 + 保险 + 清关费 CA$${Number(c.clearance_fee_cad ?? 0).toFixed(2)}\n当前采用：${c.has_customer ? "A（有客户号）" : "B（无客户号）"}`}>
                  <div className={c.has_customer ? "font-bold text-sky-300" : "text-sky-300/60"}>A 本身 CA${Number(c.with_customer_total_cad ?? 0).toFixed(2)}</div>
                  <div className={c.has_customer ? "text-amber-300/60" : "font-bold text-amber-300"}>B 运单 CA${Number(c.without_customer_total_cad ?? 0).toFixed(2)}</div>
                </td>

                <td className="text-sm font-mono">{c.pallet_no ? <Link to="/admin/pallets/$palletId" params={{ palletId: c.pallet_id }} className="text-brand hover:underline">{c.pallet_no}</Link> : "—"}</td>
                <td className="text-sm font-mono">{c.batch_no ? <Link to="/admin/batches/$batchId" params={{ batchId: c.batch_id }} className="text-brand hover:underline">{c.batch_no}</Link> : "—"}</td>
                <td className="text-sm text-slate-400">{fmtDate(c.created_at)}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  <button onClick={() => onPrint(c.id)} className="mr-2 text-[10px] text-slate-300 hover:text-white"><Printer className="inline h-3 w-3"/></button>
                  <Link to="/admin/cartons/$cartonId" params={{ cartonId: c.id }} className="text-xs text-brand">详情 <ArrowRight className="inline h-3 w-3"/></Link>
                  {canDelete && <DeleteRowButton label="箱号" name={c.carton_no} extra="下属运单/订单的箱号关联会被清空。" onDelete={async () => { await delCarton({ data: { id: c.id } }); await qc.invalidateQueries({ queryKey: ["cartons"] }); }}/>}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {q.data && <Pagination page={page} pageSize={pageSize} total={q.data.total} onChange={setPage}/>}

      {show && (
        <ContainerCreateDialog kind="carton" onClose={() => setShow(false)} onSubmit={async (d) => {
          await create({ data: d });
          setShow(false);
          qc.invalidateQueries({ queryKey: ["cartons"] });
        }}/>
      )}
    </Page>
  );
}
