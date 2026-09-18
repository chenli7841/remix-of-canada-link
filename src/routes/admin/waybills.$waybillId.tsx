import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getWaybillDetail, setWaybillStatus, addTrackingEvents, editTrackingEvent, deleteTrackingEvent, listTrackingPresets, updateWaybillDomesticTrackingNo, type WaybillStatus } from "@/lib/orders.functions";
import { listHsCodes, bindNameToHs, setForwardingItemHs } from "@/lib/hs-codes.functions";
import { getMyRoles } from "@/lib/admin.functions";
import { WAYBILL_STATUS_LABEL, WAYBILL_STATUS_COLOR, METHOD_LABEL, StatusBadge, Card, fmtDate, fmtCAD, BackLink } from "@/lib/admin-shared";
import { SurchargePanel } from "@/components/admin/SurchargePanel";
import { WorkflowStepper, WAYBILL_FLOW } from "@/components/admin/WorkflowStepper";
import { Loader2, Plus, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/admin/waybills/$waybillId")({ component: WaybillDetail });

const STATUSES: WaybillStatus[] = ["procurement","pending","received","storage","packed","shipped","arrived","in_transit","ready_pickup","delivered","cancelled"];

function WaybillDetail() {
  const { waybillId } = Route.useParams();
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getWaybillDetail);
  const fetchPresets = useServerFn(listTrackingPresets);
  const fetchRoles = useServerFn(getMyRoles);
  const setStatusFn = useServerFn(setWaybillStatus);
  const addEvent = useServerFn(addTrackingEvents);
  const editEvent = useServerFn(editTrackingEvent);
  const delEvent = useServerFn(deleteTrackingEvent);
  const saveDomesticFn = useServerFn(updateWaybillDomesticTrackingNo);

  const detailQ = useQuery({ queryKey: ["admin-waybill", waybillId], queryFn: () => fetchDetail({ data: { waybillId } }) });
  const presetsQ = useQuery({ queryKey: ["tracking-presets"], queryFn: () => fetchPresets() });
  const meQ = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles(), staleTime: 60_000 });
  const canManage = (meQ.data?.roles ?? []).some(r => r === "owner" || r === "manager");

  const [newStatus, setNewStatus] = useState<WaybillStatus>("received");
  const [statusNote, setStatusNote] = useState("");
  const [presetCode, setPresetCode] = useState("");
  const [evStatus, setEvStatus] = useState("");
  const [evLoc, setEvLoc] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ status_zh: "", location_zh: "", event_time: "" });
  const [dtEditing, setDtEditing] = useState(false);
  const [dtValue, setDtValue] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);


  if (detailQ.isLoading) return <div className="grid place-items-center p-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500"/></div>;
  if (detailQ.isError) return <div className="p-6 text-rose-400">{(detailQ.error as Error).message}</div>;
  const { waybill: wb, events, logs } = detailQ.data!;

  const onSaveDomestic = async () => {
    setBusy(true); setErr(null);
    try {
      await saveDomesticFn({ data: { waybillId, domestic_tracking_no: dtValue } });
      setDtEditing(false);
      await qc.invalidateQueries({ queryKey: ["admin-waybill", waybillId] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const onSetStatus = async () => {
    setBusy(true); setErr(null);
    try {
      await setStatusFn({ data: { waybillIds: [waybillId], status: newStatus, note: statusNote || undefined } });
      setStatusNote(""); await qc.invalidateQueries({ queryKey: ["admin-waybill", waybillId] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const onAddEvent = async () => {
    setBusy(true); setErr(null);
    try {
      let event: any;
      if (presetCode) {
        const p = presetsQ.data?.presets.find((x: any) => x.code === presetCode);
        if (!p) throw new Error("预设不存在");
        event = { status_zh: p.label_zh, status_en: p.label_en, location_zh: p.default_location_zh, location_en: p.default_location_en };
      } else {
        if (!evStatus.trim()) throw new Error("请填写状态或选择预设");
        event = { status_zh: evStatus, location_zh: evLoc || undefined };
      }
      await addEvent({ data: { waybillIds: [waybillId], event } });
      setEvStatus(""); setEvLoc(""); setPresetCode("");
      await qc.invalidateQueries({ queryKey: ["admin-waybill", waybillId] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const onEditSave = async (id: string) => {
    setBusy(true);
    try {
      await editEvent({ data: { eventId: id, patch: { status_zh: editForm.status_zh, location_zh: editForm.location_zh, event_time: editForm.event_time || undefined } } });
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["admin-waybill", waybillId] });
    } finally { setBusy(false); }
  };
  const onDelete = async (id: string) => {
    if (!confirm("删除该轨迹？")) return;
    await delEvent({ data: { eventId: id } });
    await qc.invalidateQueries({ queryKey: ["admin-waybill", waybillId] });
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <BackLink to="/admin/waybills">返回运单列表</BackLink>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold font-mono">{wb.waybill_no}</h1>
          <div className="mt-1 text-xs text-slate-400">
            <StatusBadge map={WAYBILL_STATUS_LABEL} color={WAYBILL_STATUS_COLOR} value={wb.status}/>
            <span className="ml-2">方式：{(wb.shipping_method && METHOD_LABEL[wb.shipping_method]) || "—"} · 创建：{fmtDate(wb.created_at)}</span>
          </div>
        </div>
      </div>

      <WorkflowStepper flow={WAYBILL_FLOW} current={wb.status} title="运单流程" />


      <div className="grid gap-4 md:grid-cols-2">
        <Card title="基础信息">
          <div className="space-y-1 text-xs text-slate-300">
            <div>国际单号：{wb.intl_tracking_no ?? "—"}</div>
            <div className="flex flex-wrap items-center gap-2">
              <span>国内单号：</span>
              {dtEditing ? (
                <>
                  <input
                    value={dtValue}
                    onChange={(e) => setDtValue(e.target.value)}
                    placeholder="国内快递单号"
                    className="w-56 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-slate-200 outline-none focus:border-brand"
                  />
                  <button disabled={busy} onClick={onSaveDomestic} className="rounded-md bg-brand px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">保存</button>
                  <button disabled={busy} onClick={() => setDtEditing(false)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300">取消</button>
                </>
              ) : (
                <>
                  <span className="font-mono text-slate-200">{(detailQ.data as any).domestic_tracking_no ?? "—"}</span>
                  <button
                    onClick={() => { setDtValue((detailQ.data as any).domestic_tracking_no ?? ""); setDtEditing(true); }}
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/5"
                  >
                    <Pencil className="h-3 w-3"/> 修改
                  </button>
                </>
              )}
            </div>
            <div>目的地：{(detailQ.data as any)?.address_destination_code ?? "—"}<span className="ml-1 text-slate-500">（收件地址）</span></div>
            <div>重量：{wb.weight_kg ?? "—"} kg</div>


            <div>尺寸：{wb.length_cm ?? "—"} × {wb.width_cm ?? "—"} × {wb.height_cm ?? "—"} cm</div>
            <div>箱号：{wb.box_no ?? "—"} · 板号：{wb.pallet_no ?? "—"}</div>
            <div>批次：{wb.batch_no ?? "—"}</div>
            <div>物品：{Array.isArray(wb.items_summary) && wb.items_summary.length
              ? wb.items_summary.map((i: any) => `${i.name}×${i.quantity}`).join("、")
              : "—"}</div>
            <div>所属：{wb.order_id ? <Link to="/admin/orders/$orderId" params={{ orderId: wb.order_id }} className="text-brand hover:underline">订单</Link>
                       : wb.forwarding_id ? <Link to="/admin/forwardings/$forwardingId" params={{ forwardingId: wb.forwarding_id }} className="text-brand hover:underline">集运单</Link>
                       : "—"}</div>
          </div>
        </Card>
        <Card title="费用（量尺称重后自动计算）">
          {(() => {
            const s: any = wb.weight_snapshot ?? {};
            const surchargeTotal = (detailQ.data as any)?.surcharges?.reduce((a: number, r: any) => a + Number(r.amount_cny ?? 0) * 0.19, 0) ?? Number(wb.surcharge_cad ?? 0);
            const computed = (detailQ.data as any)?.computed ?? {};
            return (
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-300">
                <div><div className="text-slate-500">实重</div><div>{s.actual_weight ?? wb.weight_kg ?? "—"} kg</div></div>
                <div><div className="text-slate-500">体积重</div><div>{s.volumetric_weight ?? "—"} kg</div></div>
                <div><div className="text-slate-500">计费重</div><div className="text-slate-100">{s.chargeable_weight ?? "—"} kg</div></div>
                <div><div className="text-slate-500">申报价值</div><div>{fmtCAD(Number(computed.declared_cad ?? s.declared_cad ?? 0))}</div></div>
                <div><div className="text-slate-500">运费</div><div className="text-emerald-300">{fmtCAD(Number(wb.freight_cad ?? 0))}</div></div>
                <div><div className="text-slate-500">关税</div><div>{Number(wb.duty_cad ?? 0) > 0 ? fmtCAD(Number(wb.duty_cad)) : (computed.duty_cad > 0 ? <span className="text-amber-300">{fmtCAD(computed.duty_cad)}（未持久化）</span> : "—")}</div></div>
                <div><div className="text-slate-500">保险</div><div>{Number(wb.insurance_cad ?? 0) > 0 ? fmtCAD(Number(wb.insurance_cad)) : <span className="text-slate-500">未购买 / 无</span>}</div></div>
                <div><div className="text-slate-500">清关费</div><div>{Number(wb.clearance_cad ?? 0) > 0 ? fmtCAD(Number(wb.clearance_cad)) : "—"}</div></div>
                <div><div className="text-slate-500">附加费</div><div>{surchargeTotal > 0 ? fmtCAD(surchargeTotal) : "—"}</div></div>
              </div>
            );
          })()}
        </Card>

        {Array.isArray((detailQ.data as any)?.items_breakdown) && (detailQ.data as any).items_breakdown.length > 0 && (
          <div className="md:col-span-2">
            {((detailQ.data as any).computed?.unmatched_names?.length ?? 0) > 0 && (
              <div className="mb-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-200">
                ⚠ 以下品名未匹配到 HS 编码，关税按 0 计：
                <span className="ml-1 font-mono">{(detailQ.data as any).computed.unmatched_names.join("、")}</span>
              </div>
            )}
            {!((detailQ.data as any).computed?.customs_enabled) && (
              <div className="mb-2 rounded-md border border-slate-500/30 bg-slate-500/10 p-2 text-xs text-slate-300">
                该线路未开启关税征收（customs_rules.enabled = false），本单关税按 0 计。
              </div>
            )}
            <Card title="物品明细（品名来源：forwarding_items · 数量按 箱数 拆分到本运单）">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead className="text-slate-400">
                    <tr className="border-b border-white/10 text-left">
                      <th className="py-1 pr-2">品名</th>
                      <th className="py-1 pr-2">HS Code</th>
                      <th className="py-1 pr-2">箱数</th>
                      <th className="py-1 pr-2">数量/箱</th>
                      <th className="py-1 pr-2">单价 CAD</th>
                      <th className="py-1 pr-2">申报价</th>
                      <th className="py-1 pr-2">税率(mfn+gst+反倾销)</th>
                      <th className="py-1 pr-2">关税</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailQ.data as any).items_breakdown.map((it: any, i: number) => (
                      <tr key={i} className="border-b border-white/5 text-slate-200">
                        <td className="py-1 pr-2">{it.name}</td>
                        <td className="py-1 pr-2">
                          <HsCell item={it} onChanged={() => qc.invalidateQueries({ queryKey: ["admin-waybill", waybillId] })} />
                        </td>
                        <td className="py-1 pr-2">{it.box_count}</td>
                        <td className="py-1 pr-2" title={`总数 ${it.quantity_total} / 箱数 ${it.box_count} · 来源 ${it.quantity_source}`}>
                          <span className="font-mono">{it.quantity_display}</span>
                          {it.quantity_fraction.denominator > 1 && (
                            <span className="ml-1 text-slate-500">≈{it.quantity_per_waybill.toFixed(3)}</span>
                          )}
                        </td>
                        <td className="py-1 pr-2">{fmtCAD(it.unit_price_cad)}</td>
                        <td className="py-1 pr-2">{fmtCAD(it.declared_value_cad)}</td>
                        <td className="py-1 pr-2 text-slate-400">
                          {(it.mfn_rate * 100).toFixed(1)}%+{(it.gst_rate * 100).toFixed(1)}%
                          {it.anti_dumping_rate > 0 && <>+<span className="text-rose-400">{(it.anti_dumping_rate * 100).toFixed(1)}%</span></>}
                          <span className="ml-1 text-slate-500">= {(it.tax_rate * 100).toFixed(1)}%</span>
                        </td>
                        <td className="py-1 pr-2 text-slate-100">{fmtCAD(it.duty_cad)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="text-slate-300">
                      <td colSpan={5} className="py-1 pr-2 text-right text-slate-500">合计</td>
                      <td className="py-1 pr-2">{fmtCAD((detailQ.data as any).computed?.declared_cad ?? 0)}</td>
                      <td/>
                      <td className="py-1 pr-2">{fmtCAD((detailQ.data as any).computed?.duty_cad ?? 0)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <div className="mt-2 text-[11px] text-slate-500">
                数量优先取 <code>forwarding_items.extras.items_per_carton</code>；无此字段时按 <code>quantity / forwarding_orders.box_count</code> 计算，非整数以分数展示便于后续汇总。
              </div>
            </Card>
          </div>
        )}


        {canManage && (
          <Card title="状态控制">
            <div className="flex gap-2">
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as any)}
                className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100 [&>option]:bg-[#0E1626]">
                {STATUSES.map(s => <option key={s} value={s}>{WAYBILL_STATUS_LABEL[s]}</option>)}
              </select>
              <input value={statusNote} onChange={(e) => setStatusNote(e.target.value)} placeholder="内部备注"
                className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100"/>
              <button onClick={onSetStatus} disabled={busy}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">更新</button>
            </div>
            {err && <div className="mt-2 text-xs text-rose-400">{err}</div>}
          </Card>
        )}
      </div>

      <Card title="物流轨迹（公开）" action={
        <div className="flex flex-wrap items-center gap-2">
          <select value={presetCode} onChange={(e) => setPresetCode(e.target.value)}
            className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-100 [&>option]:bg-[#0E1626]">
            <option value="">预设…</option>
            {presetsQ.data?.presets.filter((p: any) => p.is_active).map((p: any) => <option key={p.code} value={p.code}>{p.label_zh}</option>)}
          </select>
          <input value={evStatus} onChange={(e) => setEvStatus(e.target.value)} placeholder="自定义状态"
            className="w-28 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-100"/>
          <input value={evLoc} onChange={(e) => setEvLoc(e.target.value)} placeholder="位置"
            className="w-28 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-100"/>
          <button onClick={onAddEvent} disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-[11px] font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
            <Plus className="h-3 w-3"/>添加</button>
        </div>
      }>
        <div className="space-y-2">
          {events.length === 0 && <div className="text-xs text-white/60">暂无</div>}
          {events.map((ev: any) => (
            <div key={ev.id} className="rounded-md border border-white/5 bg-white/[0.02] p-2 text-xs text-white">
              {editing === ev.id ? (
                <div className="flex flex-wrap gap-2">
                  <input value={editForm.status_zh} onChange={(e) => setEditForm({ ...editForm, status_zh: e.target.value })}
                    className="w-32 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"/>
                  <input value={editForm.location_zh} onChange={(e) => setEditForm({ ...editForm, location_zh: e.target.value })}
                    className="w-32 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"/>
                  <input type="datetime-local" value={editForm.event_time} onChange={(e) => setEditForm({ ...editForm, event_time: e.target.value })}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"/>
                  <button onClick={() => onEditSave(ev.id)} className="rounded-md bg-brand px-2 py-1 text-xs text-white">保存</button>
                  <button onClick={() => setEditing(null)} className="rounded-md border border-white/10 px-2 py-1 text-xs text-white">取消</button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-white">{ev.status_zh}</div>
                    <div className="text-white/80">{ev.location_zh ?? "—"} · {fmtDate(ev.event_time)} · 来源 {ev.source}</div>
                  </div>
                  {canManage && (
                    <div className="flex gap-1">
                      <button onClick={() => { setEditing(ev.id); setEditForm({ status_zh: ev.status_zh, location_zh: ev.location_zh ?? "", event_time: ev.event_time?.slice(0,16) ?? "" }); }}
                        className="rounded p-1 text-slate-400 hover:bg-white/10"><Pencil className="h-3 w-3"/></button>
                      <button onClick={() => onDelete(ev.id)}
                        className="rounded p-1 text-rose-400 hover:bg-rose-500/10"><Trash2 className="h-3 w-3"/></button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      <SurchargePanel scope="waybill" id={waybillId} canEdit={canManage}/>

      <Card title="操作记录（内部）">
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {logs.length === 0 && <div className="text-xs text-slate-500">暂无</div>}
          {logs.map((l: any) => (
            <div key={l.id} className="rounded-md border border-white/5 bg-white/[0.02] p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">{l.action}</span>
                <span className="text-slate-500">{fmtDate(l.created_at)}</span>
              </div>
              <div className="text-slate-400">操作人：{l.operator_name ?? "—"}{l.note ? ` · ${l.note}` : ""}</div>
              {(l.before || l.after) && (
                <details className="mt-1"><summary className="cursor-pointer text-slate-500">详情</summary>
                  <pre className="mt-1 max-h-40 overflow-auto text-[10px] text-slate-500">{JSON.stringify({ before: l.before, after: l.after }, null, 2)}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

const HS_MATCH_LABEL: Record<string, { text: string; cls: string }> = {
  manual: { text: "手动", cls: "bg-emerald-500/20 text-emerald-300" },
  name:   { text: "名称", cls: "bg-sky-500/20 text-sky-300" },
  alias:  { text: "别名", cls: "bg-indigo-500/20 text-indigo-300" },
  fuzzy:  { text: "模糊", cls: "bg-amber-500/20 text-amber-300" },
  none:   { text: "未匹配", cls: "bg-rose-500/20 text-rose-300" },
};

function HsCell({ item, onChanged }: { item: any; onChanged: () => void }) {
  const searchFn = useServerFn(listHsCodes);
  const bindFn = useServerFn(bindNameToHs);
  const setFiHs = useServerFn(setForwardingItemHs);
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState(item.name ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const listQ = useQuery({
    queryKey: ["hs-search", kw],
    queryFn: () => searchFn({ data: { search: kw || undefined } }),
    enabled: open,
  });
  const badge = HS_MATCH_LABEL[item.hs_matched ?? "none"];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        {item.hs_code ? (
          <span className="font-mono">{item.hs_code}</span>
        ) : (
          <span className="text-rose-400">未匹配 HS</span>
        )}
        {badge && <span className={`rounded px-1.5 py-0.5 text-[10px] ${badge.cls}`}>{badge.text}</span>}
        <button onClick={() => setOpen(o => !o)} className="text-[11px] text-brand hover:underline">改绑</button>
        {!item.hs_code && (
          <a href={`/admin/hs-codes?prefill=${encodeURIComponent(item.name)}`} target="_blank" rel="noreferrer"
             className="text-[11px] text-slate-400 hover:text-white">新增</a>
        )}
      </div>
      {open && (
        <div className="mt-1 w-80 rounded-md border border-white/10 bg-slate-900 p-2 shadow-lg">
          <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索 HS 编码 / 品名"
            className="mb-2 w-full rounded border border-white/10 bg-white/5 px-2 py-1 text-xs"/>
          <div className="max-h-56 overflow-y-auto text-xs">
            {(listQ.data?.items ?? []).slice(0, 20).map((h: any) => (
              <button key={h.id} disabled={busy}
                onClick={async () => {
                  setBusy(true); setMsg(null);
                  try {
                    if (item.forwarding_item_id) await setFiHs({ data: { item_id: item.forwarding_item_id, hs_code: h.hs_code } });
                    await bindFn({ data: { hs_code: h.hs_code, name: item.name } });
                    setOpen(false); onChanged();
                  } catch (e: any) { setMsg(e.message); } finally { setBusy(false); }
                }}
                className="flex w-full items-start justify-between rounded px-2 py-1 text-left hover:bg-white/5">
                <span><span className="font-mono">{h.hs_code}</span> · {h.name_zh}</span>
                <span className="text-slate-500">{(Number(h.mfn_rate)*100).toFixed(1)}%</span>
              </button>
            ))}
            {(listQ.data?.items ?? []).length === 0 && !listQ.isLoading && (
              <div className="p-2 text-center text-slate-500">无结果 —
                <a href={`/admin/hs-codes?prefill=${encodeURIComponent(item.name)}`} target="_blank" rel="noreferrer"
                   className="ml-1 text-brand hover:underline">去新增</a>
              </div>
            )}
          </div>
          {msg && <div className="mt-1 text-[11px] text-rose-300">{msg}</div>}
        </div>
      )}
    </div>
  );
}
