import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getCartonDetail, updateCarton, assignToCarton, deleteCarton, getContainerLabelData, setContainerUnlock } from "@/lib/cartons.functions";
import { listAdminLogs } from "@/lib/admin-logs.functions";
import { Card, BackLink, fmtDate } from "@/lib/admin-shared";
import { ContainerInfoCard, FeeComparisonCard } from "@/components/admin/ContainerFeePanel";
import { ContainerEditPanel } from "@/components/admin/ContainerEditPanel";
import { SurchargePanel } from "@/components/admin/SurchargePanel";
import { ScanAddDialog } from "@/components/admin/ScanAddDialog";
import { WaybillCompactList } from "@/components/admin/ContainerChildList";
import { renderLabel } from "@/lib/label-render";
import { LabelSizeToggle } from "@/components/admin/LabelSizeToggle";
import { Loader2, Trash2, Printer, ScanLine, History, Lock, Unlock } from "lucide-react";
import { useEffect } from "react";
import { Save } from "lucide-react";

export const Route = createFileRoute("/admin/cartons/$cartonId")({ component: CartonDetail });

function CartonDetail() {
  const { cartonId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getCartonDetail);
  const update = useServerFn(updateCarton);
  const assign = useServerFn(assignToCarton);
  const del = useServerFn(deleteCarton);
  const fetchLabel = useServerFn(getContainerLabelData);
  const setUnlock = useServerFn(setContainerUnlock);
  const fetchLogs = useServerFn(listAdminLogs);

  const q = useQuery({ queryKey: ["carton", cartonId], queryFn: () => fetchDetail({ data: { id: cartonId } }) });
  const logsQ = useQuery({ queryKey: ["carton-logs", cartonId], queryFn: () => fetchLogs({ data: { entity_type: "carton", entity_id: cartonId, pageSize: 50 } }) });
  const [showScan, setShowScan] = useState(false);

  if (q.isLoading) return <div className="grid place-items-center p-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500"/></div>;
  if (q.isError) return <div className="p-6 text-rose-400">{(q.error as Error).message}</div>;
  const { carton, waybills, orders, forwardings } = q.data!;

  const onPrint = async () => { const d = await fetchLabel({ data: { kind: "carton", id: cartonId } }); renderLabel(d as any); };
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["carton", cartonId] });
    qc.invalidateQueries({ queryKey: ["carton-logs", cartonId] });
  };

  const chargeableW = carton.customer_code ? carton.self_chargeable_kg : carton.child_chargeable_kg;
  const locked = !!carton.batch_status && carton.batch_status !== "draft" && !carton.unlocked;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <BackLink to="/admin/cartons">返回箱号列表</BackLink>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold font-mono">{carton.carton_no}</h1>
          <div className="mt-1 text-xs text-slate-400">状态：{carton.status} · 付款 {carton.payment_status} · 创建 {fmtDate(carton.created_at)} · 计费重 <span className="font-mono text-amber-300">{chargeableW ?? 0} kg</span>（{carton.customer_code ? "自身" : "下属之和"}）{carton.batch_status ? ` · 批次状态 ${carton.batch_status}` : ""}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LabelSizeToggle />
          <button onClick={() => setShowScan(true)} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"><ScanLine className="inline h-3 w-3 mr-1"/>扫码加入</button>
          {carton.batch_status && carton.batch_status !== "draft" && (
            <button onClick={async () => { await setUnlock({ data: { kind: "carton", id: cartonId, unlocked: !carton.unlocked } }); invalidate(); }}
              className={`rounded-md border px-3 py-1.5 text-xs ${carton.unlocked ? "border-amber-500/30 text-amber-300 hover:bg-amber-500/10" : "border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"}`}>
              {carton.unlocked ? <><Lock className="inline h-3 w-3 mr-1"/>重新锁定</> : <><Unlock className="inline h-3 w-3 mr-1"/>人工解锁</>}
            </button>
          )}
          <button onClick={onPrint} className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"><Printer className="inline h-3 w-3 mr-1"/>打印面单</button>
          <button onClick={async () => { if (confirm("删除此箱号？运单/订单关联会被清空")) { await del({ data: { id: cartonId } }); navigate({ to: "/admin/cartons" }); } }}
            className="rounded-md border border-rose-500/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10"><Trash2 className="inline h-3 w-3 mr-1"/>删除</button>
        </div>
      </div>

      {locked && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 inline-flex items-center gap-2">
          <Lock className="h-4 w-4"/>此箱号所属批次为 <b>{carton.batch_status}</b>（非草稿），字段已锁定为只读。如需修改请点击右上角 "人工解锁"。
        </div>
      )}

      <ScanAddDialog open={showScan} onClose={() => setShowScan(false)} container={"carton" as any} containerId={cartonId} onChanged={invalidate}/>

      <ContainerInfoCard kind="carton" row={carton} currency="CAD"/>
      <FeeComparisonCard fees={carton} currency="CAD"/>

      <ContainerEditPanel kind="carton" row={carton} locked={locked} onSave={async (patch) => { await update({ data: { id: cartonId, patch } }); invalidate(); }}/>

      <SelfDimsCard kind="carton" row={carton} locked={locked} onSave={async (patch) => { await update({ data: { id: cartonId, patch } }); invalidate(); }}/>


      <SurchargePanel scope="carton" id={cartonId} onChanged={invalidate}/>

      <Card title={`运单 (${waybills.length})`} action={
        <button onClick={() => setShowScan(true)} className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-xs font-semibold text-white"><ScanLine className="h-3 w-3"/>扫码加入</button>
      }>
        <WaybillCompactList
          waybills={waybills as any}
          onKick={async (w) => { await assign({ data: { cartonId: null, waybillIds: [w.id] } }); invalidate(); }}
        />
      </Card>

      {(orders.length > 0 || forwardings.length > 0) && (
        <Card title={`订单 / 集运单 (${orders.length + forwardings.length})`}>
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
    </div>
  );
}

export function SelfDimsCard({ kind, row, onSave, locked }: { kind: "carton" | "pallet"; row: any; onSave: (patch: any) => Promise<any>; locked?: boolean }) {
  const [f, setF] = useState({
    self_length_cm: row.self_length_cm ?? "",
    self_width_cm: row.self_width_cm ?? "",
    self_height_cm: row.self_height_cm ?? "",
    self_weight_kg: row.self_weight_kg ?? "",
  });
  useEffect(() => {
    setF({
      self_length_cm: row.self_length_cm ?? "",
      self_width_cm: row.self_width_cm ?? "",
      self_height_cm: row.self_height_cm ?? "",
      self_weight_kg: row.self_weight_kg ?? "",
    });
  }, [row.id]);
  const [saving, setSaving] = useState(false);
  const L = Number(f.self_length_cm || 0), W = Number(f.self_width_cm || 0), H = Number(f.self_height_cm || 0);
  const previewVolume = L && W && H ? +((L * W * H) / 1_000_000).toFixed(4) : 0;
  const handleSave = async () => {
    if (locked) return;
    setSaving(true);
    try {
      const patch: any = {};
      for (const k of Object.keys(f) as (keyof typeof f)[]) {
        const v = f[k];
        patch[k] = v === "" || v == null ? null : Number(v);
      }
      await onSave(patch);
    } finally { setSaving(false); }
  };
  const upd = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const selfFreightCad = row.self_freight_cad != null ? Number(row.self_freight_cad) : null;
  return (
    <Card title={`基本信息 · ${kind === "carton" ? "箱号" : "托盘"}自身尺寸/重量`} action={
      <button onClick={handleSave} disabled={saving || locked} className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
        {locked ? <Loader2 className="h-3 w-3"/> : saving ? <Loader2 className="h-3 w-3 animate-spin"/> : <Save className="h-3 w-3"/>}保存
      </button>
    }>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
        <Field label="自身长 (cm)" value={f.self_length_cm} onChange={upd("self_length_cm")} disabled={locked}/>
        <Field label="自身宽 (cm)" value={f.self_width_cm} onChange={upd("self_width_cm")} disabled={locked}/>
        <Field label="自身高 (cm)" value={f.self_height_cm} onChange={upd("self_height_cm")} disabled={locked}/>
        <Field label="自身重量 (kg)" value={f.self_weight_kg} onChange={upd("self_weight_kg")} disabled={locked}/>
        <ReadOnlyField label="自身体积 (m³)" value={previewVolume || "—"} hint="= 长×宽×高 / 1,000,000"/>
        <ReadOnlyField label="自身运费 (CA$)" value={selfFreightCad != null ? `CA$${selfFreightCad.toFixed(2)}` : "—"} hint="按线路规则自动计算（保存尺寸/重量后即时更新）"/>
      </div>
      <div className="mt-2 text-[10px] text-slate-500">{locked ? "已锁定，字段只读。" : "体积与运费由系统根据所属线路的运费规则自动计算，保存尺寸/重量后立即更新。"}</div>
    </Card>
  );
}

function Field({ label, value, onChange, disabled }: { label: string; value: any; onChange: (e: any) => void; disabled?: boolean }) {
  return (
    <div>
      <label className="text-slate-400">{label}</label>
      <input type="number" step="any" value={value} onChange={onChange} disabled={disabled}
        className={`mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}/>
    </div>
  );
}

function ReadOnlyField({ label, value, hint }: { label: string; value: any; hint?: string }) {
  return (
    <div>
      <label className="text-slate-400">{label}</label>
      <div title={hint} className="mt-1 w-full rounded-md border border-dashed border-white/10 bg-white/[0.03] px-2 py-1.5 text-sm font-mono text-amber-300">{value}</div>
    </div>
  );
}
