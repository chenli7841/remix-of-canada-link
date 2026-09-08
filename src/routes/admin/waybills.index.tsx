import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listWaybills, setWaybillStatus, addTrackingEvents, listTrackingPresets, type WaybillStatus } from "@/lib/orders.functions";
import { getMyRoles } from "@/lib/admin.functions";
import { WAYBILL_STATUS_LABEL, WAYBILL_STATUS_COLOR, METHOD_LABEL, StatusBadge, Page, fmtDate } from "@/lib/admin-shared";
import { Pagination } from "@/components/admin/Pagination";
import { DeleteRowButton, useCanDelete } from "@/components/admin/DeleteRowButton";
import { deleteWaybill } from "@/lib/admin-delete.functions";
import { Search, Loader2, ArrowRight, MapPin, ListChecks } from "lucide-react";

export const Route = createFileRoute("/admin/waybills/")({ component: WaybillsPage });

const STATUSES: (WaybillStatus | "all")[] = ["all","procurement","pending","received","storage","packed","shipped","arrived","in_transit","ready_pickup","delivered","cancelled"];

function WaybillsPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listWaybills);
  const fetchPresets = useServerFn(listTrackingPresets);
  const fetchRoles = useServerFn(getMyRoles);
  const setStatusFn = useServerFn(setWaybillStatus);
  const addEvent = useServerFn(addTrackingEvents);
  const delWaybill = useServerFn(deleteWaybill);
  const canDelete = useCanDelete();

  const [status, setStatus] = useState<WaybillStatus | "all">("all");
  const [search, setSearch] = useState(""); const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1); const pageSize = 10;
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["admin-waybills", { status, search, page }],
    queryFn: () => fetchList({ data: { status, search, page, pageSize } }),
  });
  const presetsQ = useQuery({ queryKey: ["tracking-presets"], queryFn: () => fetchPresets() });
  const meQ = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles(), staleTime: 60_000 });
  const canManage = (meQ.data?.roles ?? []).some(r => r === "owner" || r === "manager");

  const [bulkStatus, setBulkStatus] = useState<WaybillStatus>("received");
  const [bulkNote, setBulkNote] = useState("");
  const [presetCode, setPresetCode] = useState("");
  const [customStatus, setCustomStatus] = useState("");
  const [customLoc, setCustomLoc] = useState("");
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);

  const toggle = (id: string) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };
  const toggleAll = () => {
    if (selected.size === q.data?.waybills.length) setSelected(new Set());
    else setSelected(new Set(q.data?.waybills.map((w: any) => w.id) ?? []));
  };

  const doBulkStatus = async () => {
    if (!selected.size) return; setBusy(true); setMsg(null);
    try {
      const r = await setStatusFn({ data: { waybillIds: Array.from(selected), status: bulkStatus, note: bulkNote || undefined } });
      setMsg(`已更新 ${r.count} 条`); setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ["admin-waybills"] });
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };
  const doBulkEvent = async () => {
    if (!selected.size) return; setBusy(true); setMsg(null);
    try {
      let event: any;
      if (presetCode) {
        const p = presetsQ.data?.presets.find((x: any) => x.code === presetCode);
        if (!p) throw new Error("预设不存在");
        event = { status_zh: p.label_zh, status_en: p.label_en, location_zh: p.default_location_zh, location_en: p.default_location_en };
      } else {
        if (!customStatus.trim()) throw new Error("请填写状态或选择预设");
        event = { status_zh: customStatus, location_zh: customLoc || undefined };
      }
      const r = await addEvent({ data: { waybillIds: Array.from(selected), event } });
      setMsg(`已添加 ${r.inserted} 条轨迹`); setSelected(new Set()); setCustomStatus(""); setCustomLoc(""); setPresetCode("");
      await qc.invalidateQueries({ queryKey: ["admin-waybills"] });
    } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
  };

  return (
    <Page title="运单管理" subtitle={q.data ? `共 ${q.data.total} 条，已选 ${selected.size}` : "加载中…"}>
      <form className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(1); }}>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"/>
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="运单号 / 订单 / 集运 / 批次 / 客户号 / 国际单号"
            className="w-96 rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-sm focus:border-brand focus:outline-none"/>
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value as any); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
          {STATUSES.map(s => <option key={s} value={s}>{s === "all" ? "全部状态" : WAYBILL_STATUS_LABEL[s]}</option>)}
        </select>
        <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90">搜索</button>
      </form>

      {selected.size > 0 && (
        <div className="mb-4 rounded-2xl border border-brand/40 bg-brand/5 p-4">
          <div className="mb-3 text-sm font-semibold text-brand">批量操作（{selected.size} 条）</div>
          <div className="grid gap-3 md:grid-cols-2">
            {canManage && (
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="mb-2 text-xs font-semibold text-slate-300 inline-flex items-center gap-1"><ListChecks className="h-3.5 w-3.5"/>批量改状态</div>
                <div className="flex gap-2">
                  <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value as any)}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100 [&>option]:bg-[#0E1626]">
                    {STATUSES.filter(s => s !== "all").map(s => <option key={s} value={s}>{WAYBILL_STATUS_LABEL[s as string]}</option>)}
                  </select>
                  <input value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} placeholder="备注（内部）"
                    className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100"/>
                  <button onClick={doBulkStatus} disabled={busy}
                    className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">应用</button>
                </div>
              </div>
            )}
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="mb-2 text-xs font-semibold text-slate-300 inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5"/>批量加物流轨迹（公开）</div>
              <div className="flex flex-wrap gap-2">
                <select value={presetCode} onChange={(e) => setPresetCode(e.target.value)}
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100 [&>option]:bg-[#0E1626]">
                  <option value="">选择预设…</option>
                  {presetsQ.data?.presets.filter((p: any) => p.is_active).map((p: any) => <option key={p.code} value={p.code}>{p.label_zh}</option>)}
                </select>
                <span className="text-xs text-slate-500">或</span>
                <input value={customStatus} onChange={(e) => setCustomStatus(e.target.value)} placeholder="自定义状态"
                  className="w-32 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100"/>
                <input value={customLoc} onChange={(e) => setCustomLoc(e.target.value)} placeholder="位置（可空）"
                  className="w-32 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100"/>
                <button onClick={doBulkEvent} disabled={busy}
                  className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">添加</button>
              </div>
            </div>
          </div>
          {msg && <div className="mt-2 text-xs text-emerald-300">{msg}</div>}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2.5"><input type="checkbox" checked={!!selected.size && selected.size === q.data?.waybills.length} onChange={toggleAll}/></th>
              <th className="px-4 py-2.5">运单号</th>
              <th className="px-4 py-2.5">所属订单/集运</th>
              <th className="px-4 py-2.5">客户号</th>
              <th className="px-4 py-2.5">方式</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">付款</th>
              <th className="px-4 py-2.5">物品</th>
              <th className="px-4 py-2.5">重量</th>
              <th className="px-4 py-2.5">批次</th>
              <th className="px-4 py-2.5">创建</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && <tr><td colSpan={12} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500"/></td></tr>}
            {q.data?.waybills.length === 0 && <tr><td colSpan={12} className="py-10 text-center text-slate-500">暂无数据</td></tr>}
            {q.data?.waybills.map((w: any) => (
              <tr key={w.id} className="hover:bg-white/[0.03]">
                <td className="px-3 py-2.5"><input type="checkbox" checked={selected.has(w.id)} onChange={() => toggle(w.id)}/></td>
                <td className="px-4 py-2.5 font-mono text-base">{w.waybill_no}</td>
                <td className="px-4 py-2.5 font-mono text-sm">
                  {w.parent_kind === "order" && w.parent_id ? (
                    <Link to="/admin/orders/$orderId" params={{ orderId: w.parent_id }} className="text-brand hover:underline">订 {w.parent_no}</Link>
                  ) : w.parent_kind === "forwarding" && w.parent_id ? (
                    <Link to="/admin/forwardings/$forwardingId" params={{ forwardingId: w.parent_id }} className="text-brand hover:underline">集 {w.parent_no}</Link>
                  ) : <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-2.5 text-sm font-mono">{w.customer_code ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs">{METHOD_LABEL[w.shipping_method] ?? "—"}</td>
                <td className="px-4 py-2.5"><StatusBadge map={WAYBILL_STATUS_LABEL} color={WAYBILL_STATUS_COLOR} value={w.status}/></td>
                <td className="px-4 py-2.5 text-xs">{w.payment_status === "paid" ? <span className="text-emerald-300">已付</span> : <span className="text-amber-300">未付</span>}</td>
                <td className="px-4 py-2.5 text-[11px] text-slate-300 max-w-[200px] truncate">{Array.isArray(w.items_summary) && w.items_summary.length ? w.items_summary.map((i:any)=>`${i.name}×${i.quantity}`).join("、") : "—"}</td>
                <td className="px-4 py-2.5 text-xs">{w.weight_kg ?? "—"} kg</td>
                <td className="px-4 py-2.5 font-mono text-xs">
                  {w.batch_no && w.assigned_batch_id ? (
                    <Link to="/admin/batches/$batchId" params={{ batchId: w.assigned_batch_id }} className="text-brand hover:underline">{w.batch_no}</Link>
                  ) : <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{fmtDate(w.created_at)}</td>
                <td className="px-4 py-2.5 text-right"><Link to="/admin/waybills/$waybillId" params={{ waybillId: w.id }} className="text-xs text-brand hover:underline">详情 <ArrowRight className="inline h-3 w-3"/></Link>
                  {canDelete && <DeleteRowButton label="运单" name={w.waybill_no} onDelete={async () => { await delWaybill({ data: { id: w.id } }); await qc.invalidateQueries({ queryKey: ["admin-waybills"] }); }}/>}
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
