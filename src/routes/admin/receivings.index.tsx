import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listReceivings, createReceiving } from "@/lib/receivings.functions";
import { listBatches } from "@/lib/orders.functions";
import { BATCH_STATUS_LABEL, BATCH_STATUS_COLOR, METHOD_LABEL, StatusBadge, Page, fmtDate } from "@/lib/admin-shared";
import { Plus, Loader2, X, ArrowRight, PackageCheck } from "lucide-react";

export const Route = createFileRoute("/admin/receivings/")({ component: ReceivingsPage });

const RECV_LABEL: Record<string, string> = { open: "待匹配", matched: "已匹配", confirmed: "已确认", closed: "已关闭" };
const RECV_COLOR: Record<string, string> = {
  open: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  matched: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  confirmed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  closed: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

function ReceivingsPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listReceivings);
  const create = useServerFn(createReceiving);
  const fetchBatches = useServerFn(listBatches);

  const q = useQuery({ queryKey: ["admin-receivings"], queryFn: () => fetchList() });
  const batchesQ = useQuery({ queryKey: ["batches-for-recv"], queryFn: () => fetchBatches(), staleTime: 30_000 });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ batch_id: "", warehouse_code: "", notes: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await create({ data: { batch_id: form.batch_id || null, warehouse_code: form.warehouse_code, notes: form.notes } });
      setShowForm(false); setForm({ batch_id: "", warehouse_code: "", notes: "" });
      await qc.invalidateQueries({ queryKey: ["admin-receivings"] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Page title="收货管理" subtitle={q.data ? `共 ${q.data.receivings.length} 张收货单` : "加载中…"}
      action={
        <button onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90">
          <Plus className="h-4 w-4"/>新建收货单
        </button>
      }>
      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5">收货单号</th>
              <th className="px-4 py-2.5">匹配批次</th>
              <th className="px-4 py-2.5">方式</th>
              <th className="px-4 py-2.5">仓库</th>
              <th className="px-4 py-2.5">收货状态</th>
              <th className="px-4 py-2.5">批次状态</th>
              <th className="px-4 py-2.5">确认时间</th>
              <th className="px-4 py-2.5">创建</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && <tr><td colSpan={9} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500"/></td></tr>}
            {q.data?.receivings.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-slate-500">暂无收货单</td></tr>}
            {q.data?.receivings.map((r: any) => (
              <tr key={r.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-mono text-xs text-slate-200">{r.receiving_no}</td>
                <td className="px-4 py-3 text-xs font-mono">{r.batches?.batch_no ?? <span className="text-slate-500">— 未匹配 —</span>}</td>
                <td className="px-4 py-3 text-xs">{r.batches?.shipping_method ? METHOD_LABEL[r.batches.shipping_method] : "—"}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{r.warehouse_code ?? "—"}</td>
                <td className="px-4 py-3"><StatusBadge map={RECV_LABEL} color={RECV_COLOR} value={r.status}/></td>
                <td className="px-4 py-3">
                  {r.batches?.status ? <StatusBadge map={BATCH_STATUS_LABEL} color={BATCH_STATUS_COLOR} value={r.batches.status}/> : <span className="text-slate-500 text-xs">—</span>}
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{r.confirmed_at ? fmtDate(r.confirmed_at) : "—"}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(r.created_at)}</td>
                <td className="px-4 py-3 text-right">
                  <Link to="/admin/receivings/$receivingId" params={{ receivingId: r.id }} className="text-xs text-brand hover:underline">
                    详情 <ArrowRight className="inline h-3 w-3"/>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <form onClick={(e) => e.stopPropagation()} onSubmit={onCreate}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold inline-flex items-center gap-2"><PackageCheck className="h-4 w-4 text-brand"/>新建收货单</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X className="h-4 w-4"/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">匹配批次（可留空，扫描首单后自动匹配）</label>
                <select value={form.batch_id} onChange={(e) => setForm({ ...form, batch_id: e.target.value })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
                  <option value="">— 未匹配 —</option>
                  {batchesQ.data?.batches
                    .filter((b: any) => b.status === "shipped")
                    .map((b: any) => (
                      <option key={b.id} value={b.id}>{b.batch_no} · {METHOD_LABEL[b.shipping_method] ?? b.shipping_method} · {BATCH_STATUS_LABEL[b.status]}</option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">收货仓库代码</label>
                <input value={form.warehouse_code} onChange={(e) => setForm({ ...form, warehouse_code: e.target.value })}
                  placeholder="如 YYZ-A1" className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
              </div>
              <div>
                <label className="text-xs text-slate-400">备注</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
              </div>
              {err && <div className="text-xs text-rose-400">{err}</div>}
              <button type="submit" disabled={busy} className="w-full rounded-md bg-brand py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
                {busy ? "创建中…" : "创建"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Page>
  );
}
