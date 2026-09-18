import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getPalletDetail, assignToPallet, deletePallet, listCartons, getContainerLabelData, updatePallet, setContainerUnlock } from "@/lib/cartons.functions";
import { listAdminLogs } from "@/lib/admin-logs.functions";
import { SelfDimsCard } from "./cartons.$cartonId";
import { listWaybills } from "@/lib/orders.functions";
import { Card, BackLink, fmtDate } from "@/lib/admin-shared";
import { ContainerInfoCard, FeeComparisonCard } from "@/components/admin/ContainerFeePanel";
import { ContainerEditPanel } from "@/components/admin/ContainerEditPanel";
import { SurchargePanel } from "@/components/admin/SurchargePanel";
import { WaybillCompactList, CartonCompactList } from "@/components/admin/ContainerChildList";
import { renderLabel } from "@/lib/label-render";
import { LabelSizeToggle } from "@/components/admin/LabelSizeToggle";
import { Loader2, X, Trash2, Printer, ScanLine, History, Lock, Unlock } from "lucide-react";
import { ScanAddDialog } from "@/components/admin/ScanAddDialog";

export const Route = createFileRoute("/admin/pallets/$palletId")({ component: PalletDetail });

function PalletDetail() {
  const { palletId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getPalletDetail);
  const assign = useServerFn(assignToPallet);
  const del = useServerFn(deletePallet);
  const fetchCartons = useServerFn(listCartons);
  const fetchWaybills = useServerFn(listWaybills);
  const fetchLabel = useServerFn(getContainerLabelData);
  const updP = useServerFn(updatePallet);
  const setUnlock = useServerFn(setContainerUnlock);
  const fetchLogs = useServerFn(listAdminLogs);
  

  const q = useQuery({ queryKey: ["pallet", palletId], queryFn: () => fetchDetail({ data: { id: palletId } }) });
  const logsQ = useQuery({ queryKey: ["pallet-logs", palletId], queryFn: () => fetchLogs({ data: { entity_type: "pallet", entity_id: palletId, pageSize: 50 } }) });
  const [showAssign, setShowAssign] = useState(false);
  const [showAddWb, setShowAddWb] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [wbSearch, setWbSearch] = useState("");
  const cartonsQ = useQuery({ queryKey: ["cartons-for-pallet"], queryFn: () => fetchCartons({ data: {} }), enabled: showAssign });
  const wbsQ = useQuery({ queryKey: ["wbs-for-pallet", wbSearch], queryFn: () => fetchWaybills({ data: { search: wbSearch, pageSize: 50, status: "all" } }), enabled: showAddWb });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedWb, setSelectedWb] = useState<Set<string>>(new Set());

  if (q.isLoading) return <div className="grid place-items-center p-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500"/></div>;
  if (q.isError) return <div className="p-6 text-rose-400">{(q.error as Error).message}</div>;
  const { pallet, cartons, waybills, orders, forwardings } = q.data!;

  const onPrint = async () => { const d = await fetchLabel({ data: { kind: "pallet", id: palletId } }); renderLabel(d as any); };
  const invalidateP = () => { qc.invalidateQueries({ queryKey: ["pallet", palletId] }); qc.invalidateQueries({ queryKey: ["pallet-logs", palletId] }); };
  const locked = !!pallet.batch_status && pallet.batch_status !== "draft" && !pallet.unlocked;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <BackLink to="/admin/pallets">返回托盘列表</BackLink>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold font-mono">{pallet.pallet_no}</h1>
          <div className="mt-1 text-xs text-slate-400">状态：{pallet.status} · 付款 {pallet.payment_status} · 创建 {fmtDate(pallet.created_at)}{pallet.batch_no ? ` · 批次 ${pallet.batch_no}` : ""} · 计费重 <span className="font-mono text-amber-300">{pallet.chargeable_weight_kg ?? 0} kg</span>（{pallet.customer_code ? "自身" : "下属之和"}）{pallet.batch_status ? ` · 批次状态 ${pallet.batch_status}` : ""}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LabelSizeToggle />
          <button onClick={() => setShowScan(true)} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"><ScanLine className="inline h-3 w-3 mr-1"/>扫码加入</button>
          {pallet.batch_status && pallet.batch_status !== "draft" && (
            <button onClick={async () => { await setUnlock({ data: { kind: "pallet", id: palletId, unlocked: !pallet.unlocked } }); invalidateP(); }}
              className={`rounded-md border px-3 py-1.5 text-xs ${pallet.unlocked ? "border-amber-500/30 text-amber-300 hover:bg-amber-500/10" : "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"}`}>
              {pallet.unlocked ? <><Lock className="inline h-3 w-3 mr-1"/>重新锁定</> : <><Unlock className="inline h-3 w-3 mr-1"/>人工解锁</>}
            </button>
          )}
          <button onClick={onPrint} className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"><Printer className="inline h-3 w-3 mr-1"/>打印面单</button>
          <button onClick={async () => { if (confirm("删除此托盘？")) { await del({ data: { id: palletId } }); navigate({ to: "/admin/pallets" }); } }}
            className="rounded-md border border-rose-500/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"><Trash2 className="inline h-3 w-3 mr-1"/>删除</button>
        </div>
      </div>
      {locked && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 inline-flex items-center gap-2">
          <Lock className="h-4 w-4"/>此托盘所属批次为 <b>{pallet.batch_status}</b>（非草稿），字段已锁定为只读。如需修改请点击右上角 "人工解锁"。
        </div>
      )}
      <ScanAddDialog open={showScan} onClose={() => setShowScan(false)} container="pallet" containerId={palletId}
        onChanged={invalidateP}/>

      <ContainerInfoCard kind="pallet" row={pallet} currency="CAD"/>
      <FeeComparisonCard fees={pallet} currency="CAD"/>

      <ContainerEditPanel kind="pallet" row={pallet} locked={locked} onSave={async (patch) => { await updP({ data: { id: palletId, patch } }); invalidateP(); }}/>

      <SelfDimsCard kind="pallet" row={pallet} locked={locked} onSave={async (patch) => { await updP({ data: { id: palletId, patch } }); invalidateP(); }}/>

      <SurchargePanel scope="pallet" id={palletId} onChanged={() => { qc.invalidateQueries({ queryKey: ["pallet", palletId] }); qc.invalidateQueries({ queryKey: ["pallet-logs", palletId] }); }}/>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`箱号 (${cartons.length})`}>
          <CartonCompactList
            cartons={cartons as any}
            onKick={async (c) => { await assign({ data: { palletId: null, cartonIds: [c.id] } }); qc.invalidateQueries({ queryKey: ["pallet", palletId] }); }}
          />
        </Card>

        <Card title={`直接挂载运单 (${waybills.length})`}>
          <WaybillCompactList
            waybills={waybills as any}
            onKick={async (w) => { await assign({ data: { palletId: null, waybillIds: [w.id] } }); qc.invalidateQueries({ queryKey: ["pallet", palletId] }); }}
          />
        </Card>
      </div>


      {(orders.length > 0 || forwardings.length > 0) && (
        <Card title={`订单 / 集运 (${orders.length + forwardings.length})`}>
          <ul className="space-y-1 text-xs">
            {orders.map((o: any) => <li key={o.id}>订单 <Link to="/admin/orders/$orderId" params={{ orderId: o.id }} className="font-mono text-brand">{o.order_no}</Link></li>)}
            {forwardings.map((f: any) => <li key={f.id}>集运 <Link to="/admin/forwardings/$forwardingId" params={{ forwardingId: f.id }} className="font-mono text-brand">{f.request_no}</Link></li>)}
          </ul>
        </Card>
      )}

      <Card title={<span className="inline-flex items-center gap-1.5"><History className="h-4 w-4"/>操作记录 ({logsQ.data?.total ?? 0})</span>}>
        {logsQ.isLoading && <div className="py-4 text-center text-slate-500"><Loader2 className="mx-auto h-4 w-4 animate-spin"/></div>}
        {logsQ.data && logsQ.data.items.length === 0 && <div className="py-4 text-center text-xs text-slate-500">暂无操作记录</div>}
        {logsQ.data && logsQ.data.items.length > 0 && (
          <ul className="divide-y divide-white/5">
            {logsQ.data.items.map((l: any) => (
              <li key={l.id} className="flex items-start justify-between gap-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="text-slate-200">{l.note ?? l.action}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">{l.operator_name ?? "系统"} · <span className="font-mono">{l.action}</span></div>
                </div>
                <div className="whitespace-nowrap text-[10px] text-slate-500">{fmtDate(l.created_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {showAddWb && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold">加入运单</h2>
              <button onClick={() => setShowAddWb(false)}><X className="h-4 w-4 text-slate-400"/></button></div>
            <input value={wbSearch} onChange={(e) => setWbSearch(e.target.value)} placeholder="搜索运单号"
              className="mb-3 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-white/5">
              <table className="w-full text-sm"><tbody className="divide-y divide-white/5">
                {wbsQ.data?.waybills.filter((w: any) => w.pallet_id !== palletId).map((w: any) => (
                  <tr key={w.id} className={selectedWb.has(w.id) ? "bg-brand/10" : ""}>
                    <td className="px-2 py-1.5"><input type="checkbox" checked={selectedWb.has(w.id)} onChange={() => { const s = new Set(selectedWb); s.has(w.id) ? s.delete(w.id) : s.add(w.id); setSelectedWb(s); }}/></td>
                    <td className="font-mono text-xs">{w.waybill_no}</td>
                    <td className="text-xs text-slate-400">{w.pallet_id ? "已在其他托盘" : ""}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setShowAddWb(false)} className="rounded-md border border-white/10 px-3 py-1.5 text-xs">取消</button>
              <button onClick={async () => {
                if (!selectedWb.size) return;
                await assign({ data: { palletId, waybillIds: Array.from(selectedWb) } });
                setSelectedWb(new Set()); setShowAddWb(false);
                qc.invalidateQueries({ queryKey: ["pallet", palletId] });
              }} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white">加入 {selectedWb.size} 条</button>
            </div>
          </div>
        </div>
      )}


      {showAssign && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
            <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold">加入箱号</h2>
              <button onClick={() => setShowAssign(false)}><X className="h-4 w-4 text-slate-400"/></button></div>
            <div className="max-h-96 overflow-y-auto rounded-lg border border-white/5">
              <table className="w-full text-sm"><tbody className="divide-y divide-white/5">
                {cartonsQ.data?.items.filter((c: any) => c.pallet_id !== palletId).map((c: any) => (
                  <tr key={c.id} className={selected.has(c.id) ? "bg-brand/10" : ""}>
                    <td className="px-2 py-1.5"><input type="checkbox" checked={selected.has(c.id)} onChange={() => { const s = new Set(selected); s.has(c.id) ? s.delete(c.id) : s.add(c.id); setSelected(s); }}/></td>
                    <td className="font-mono text-xs">{c.carton_no}</td>
                    <td className="text-xs text-slate-400">{c.pallet_id ? "已在其他托盘" : ""}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={() => setShowAssign(false)} className="rounded-md border border-white/10 px-3 py-1.5 text-xs">取消</button>
              <button onClick={async () => {
                if (!selected.size) return;
                await assign({ data: { palletId, cartonIds: Array.from(selected) } });
                setSelected(new Set()); setShowAssign(false);
                qc.invalidateQueries({ queryKey: ["pallet", palletId] });
              }} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white">加入 {selected.size} 条</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
