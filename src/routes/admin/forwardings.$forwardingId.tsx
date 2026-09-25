import { SENSITIVE_INSURANCE_NOTICE } from "@/lib/insurance";
import { normalizeHsCodeForStorage } from "@/lib/hs-code-format";
import { HsCodeInput } from "@/components/HsCodeInput";
import { toast } from "sonner";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { getForwardingDetail, intakeForwarding, addWaybillsToForwarding, getLabelData, previewForwardingFreight, setForwardingInsured, updateForwardingBasicInfo, updateForwardingItem, addForwardingItem, deleteForwardingItem } from "@/lib/orders.functions";
import { adminChangeRoute, adminUpdateWaybillDims } from "@/lib/admin-routing.functions";
import { listRoutes } from "@/lib/settings.functions";
import { listDestinations } from "@/lib/presets.functions";
import { getMyRoles } from "@/lib/admin.functions";
import { METHOD_LABEL, WAYBILL_STATUS_LABEL, WAYBILL_STATUS_COLOR, StatusBadge, Card, fmtDate, fmtCAD, BackLink } from "@/lib/admin-shared";
import { Loader2, PackageCheck, Plus, Copy, Printer, X, Calculator, Repeat, Pencil, MapPin, ShieldCheck, ShieldOff, Package } from "lucide-react";
import { renderLabel } from "@/lib/label-render";
import { LabelSizeToggle } from "@/components/admin/LabelSizeToggle";
import { WorkflowStepper, WAYBILL_FLOW } from "@/components/admin/WorkflowStepper";
import { TrackingTimeline } from "@/components/tracking-timeline";
import { OrderAttachments } from "@/components/order-attachments";
import { SurchargePanel } from "@/components/admin/SurchargePanel";
import { ForwardingLoadingInfo } from "@/components/admin/ForwardingLoadingInfo";

export const Route = createFileRoute("/admin/forwardings/$forwardingId")({ component: FwDetail });

function FwDetail() {
  const { forwardingId: id } = Route.useParams();
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getForwardingDetail);
  const fetchRoutes = useServerFn(listRoutes);
  const fetchRoles = useServerFn(getMyRoles);
  const intake = useServerFn(intakeForwarding);
  const preview = useServerFn(previewForwardingFreight);
  const addWaybills = useServerFn(addWaybillsToForwarding);
  const fetchLabel = useServerFn(getLabelData);
  const changeRoute = useServerFn(adminChangeRoute);
  const updateDims = useServerFn(adminUpdateWaybillDims);
  const setInsured = useServerFn(setForwardingInsured);
  const saveBasicFn = useServerFn(updateForwardingBasicInfo);

  const detailQ = useQuery({ queryKey: ["admin-fo", id], queryFn: () => fetchDetail({ data: { id } }) });
  const routesQ = useQuery({ queryKey: ["admin-routes"], queryFn: () => fetchRoutes() });
  const fetchDests = useServerFn(listDestinations);
  const destsQ = useQuery({ queryKey: ["admin-destinations"], queryFn: () => fetchDests(), staleTime: 300_000 });
  const meQ = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles(), staleTime: 60_000 });
  const canIntake = (meQ.data?.roles ?? []).some(r => ["owner","manager","warehouse_cn","warehouse_ca"].includes(r));

  const [routeId, setRouteId] = useState("");
  const [decl, setDecl] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<any>(null);
  const foData: any = (detailQ.data as any)?.fo;
  const BASIC_FIELDS = ["warehouse","shipping_method","destination_code","domestic_tracking_no","intl_tracking_no"] as const;
  const [basic, setBasic] = useState<Record<string, string>>({});
  const [basicRoute, setBasicRoute] = useState("");
  useEffect(() => {
    if (!foData) return;
    setBasic(Object.fromEntries(BASIC_FIELDS.map(f => [f, foData[f] ?? ""])));
    setBasicRoute(foData.route_code ?? "");
  }, [foData?.id, foData?.warehouse, foData?.shipping_method, foData?.destination_code, foData?.route_code, foData?.domestic_tracking_no, foData?.intl_tracking_no]);
  const basicDirty = !!foData && (BASIC_FIELDS.some(f => (basic[f] ?? "") !== (foData[f] ?? "")) || basicRoute !== (foData.route_code ?? ""));
  const saveBasic = async () => {
    setBusy(true); setErr(null);
    try {
      if (foData && basicRoute && basicRoute !== (foData.route_code ?? "")) {
        await changeRoute({ data: { entityType: "forwarding", entityId: id, newRouteCode: basicRoute, note: "基础信息修改线路" } });
      }
      await saveBasicFn({ data: { forwardingId: id, patch: Object.fromEntries(BASIC_FIELDS.map(f => [f, basic[f] ?? ""])) as any } });
      await qc.invalidateQueries({ queryKey: ["admin-fo", id] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (detailQ.data?.fo) {
      const fo = detailQ.data.fo;
      const wbs = (detailQ.data as any).waybills ?? [];
      setRouteId(fo.route_id ?? "");
      // 申报价值默认 = 所属运单 declared_cad 之和 (无则回落到订单存量值)
      const sumDecl = wbs.reduce((s: number, w: any) => s + Number((w.weight_snapshot?.declared_cad) ?? 0), 0);
      setDecl(sumDecl > 0 ? sumDecl.toFixed(2) : (fo.declared_value_cad?.toString() ?? ""));
      setNote(fo.note ?? "");
    }
  }, [detailQ.data?.fo?.id]);


  // Live preview when route or declared changes
  useEffect(() => {
    if (!routeId) { setPreviewData(null); return; }
    const t = setTimeout(async () => {
      try {
        const p = await preview({ data: { id, route_id: routeId, declared_value_cad: decl ? Number(decl) : undefined } });
        setPreviewData(p);
      } catch { setPreviewData(null); }
    }, 300);
    return () => clearTimeout(t);
  }, [routeId, decl, id, detailQ.data?.waybills?.length, detailQ.data?.fo?.insured]);

  if (detailQ.isLoading) return <div className="grid place-items-center p-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500"/></div>;
  if (detailQ.isError) return <div className="p-6 text-rose-400">{(detailQ.error as Error).message}</div>;
  const { fo, items, waybills, logs, user, shippingAddress, events, loading } = detailQ.data! as any;
  const snap: any = fo.freight_snapshot;
  const selectedRouteCode = (routesQ.data?.routes ?? []).find((r: any) => r.id === routeId)?.code;
  const isRouteChange = !!fo.route_id && !!routeId && routeId !== fo.route_id;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (!routeId) throw new Error("请选择线路");
      // 若线路相比客户原线路被更改 → 先生成新单号 / 新运单号 / 新面单, 旧号入 aliases
      if (isRouteChange && selectedRouteCode) {
        await changeRoute({ data: { entityType: "forwarding", entityId: id, newRouteCode: selectedRouteCode, note: "入库时变更线路" } });
      }
      await intake({ data: {
        id, route_id: routeId,
        declared_value_cad: decl ? Number(decl) : undefined,
        note, apply_fee: true,
      }});
      await qc.invalidateQueries({ queryKey: ["admin-fo", id] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const onPrintLabel = async () => {
    const d = await fetchLabel({ data: { entityType: "forwarding", entityId: id } });
    renderLabel(d as any);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <BackLink to="/admin/forwardings">返回集运单列表</BackLink>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">集运 {fo.request_no}</h1>
          <div className="mt-1 text-xs text-slate-400">
            {fo.intake_at ? <span className="text-emerald-300">已入库 · {fmtDate(fo.intake_at)}</span> : <span className="text-amber-300">待入库</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LabelSizeToggle />
          <button onClick={onPrintLabel}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">
            <Printer className="h-3.5 w-3.5"/>生成面单
          </button>
        </div>
      </div>

      <WorkflowStepper
        flow={WAYBILL_FLOW}
        current={(() => {
          const order = WAYBILL_FLOW.map(s => s.key);
          const statuses = (waybills ?? []).map((w: any) => w.status).filter(Boolean);
          if (fo.status) statuses.push(fo.status);
          if (!statuses.length) return fo.intake_at ? "received" : "pending";
          return statuses.reduce((best: string, s: string) => {
            const bi = order.indexOf(best); const si = order.indexOf(s);
            return si > bi ? s : best;
          }, statuses[0]);
        })()}
        title="集运流程"
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="客户">
          {user ? (
            <div className="space-y-1 text-sm">
              <div className="text-slate-100">{user.full_name ?? "—"}</div>
              <div className="text-xs text-slate-400">{user.email}</div>
              <div className="text-xs font-mono text-slate-500">客户号 {user.customer_code ?? "—"}</div>
            </div>
          ) : "—"}
        </Card>
        <Card title="基础信息">
          <div className="space-y-1 text-xs text-slate-300">
            {canIntake ? (
              <div className="space-y-2">
                <BasicField label="仓库" value={basic.warehouse ?? ""} onChange={(v) => setBasic(b => ({ ...b, warehouse: v }))} />
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-slate-400">方式</span>
                  <select
                    value={basic.shipping_method ?? ""}
                    onChange={(e) => setBasic(b => ({ ...b, shipping_method: e.target.value }))}
                    className="w-40 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 outline-none focus:border-brand [&>option]:bg-[#0E1626]">
                    {Object.keys(METHOD_LABEL).map(k => <option key={k} value={k}>{METHOD_LABEL[k]}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-slate-400">线路</span>
                  <select
                    value={basicRoute}
                    onChange={(e) => setBasicRoute(e.target.value)}
                    className="w-40 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 outline-none focus:border-brand [&>option]:bg-[#0E1626]">
                    <option value="">未选择</option>
                    {(routesQ.data?.routes ?? []).map((r: any) => (
                      <option key={r.id} value={r.code}>{r.code} · {r.name_zh ?? r.name ?? ""}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-slate-400">目的地</span>
                  <select
                    value={basic.destination_code ?? ""}
                    onChange={(e) => setBasic(b => ({ ...b, destination_code: e.target.value }))}
                    className="w-40 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 outline-none focus:border-brand [&>option]:bg-[#0E1626]">
                    <option value="">未选择</option>
                    {(destsQ.data?.items ?? []).map((d: any) => (
                      <option key={d.id} value={d.code}>{d.code} · {d.name_zh ?? d.name ?? ""}</option>
                    ))}
                  </select>
                </div>
                <BasicField label="国内单号" value={basic.domestic_tracking_no ?? ""} onChange={(v) => setBasic(b => ({ ...b, domestic_tracking_no: v }))} mono />
                <BasicField label="国际单号" value={basic.intl_tracking_no ?? ""} onChange={(v) => setBasic(b => ({ ...b, intl_tracking_no: v }))} mono />
                <div className="flex justify-end">
                  <button
                    disabled={busy || !basicDirty}
                    onClick={saveBasic}
                    className="rounded-md border border-brand/30 bg-brand/10 px-3 py-1 text-[11px] font-semibold text-brand disabled:opacity-40">
                    保存基础信息
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div>仓库：{fo.warehouse}</div>
                <div>方式：{METHOD_LABEL[fo.shipping_method] ?? fo.shipping_method}</div>
                <div>线路：<span className="font-mono">{fo.route_code ?? "—"}</span>{fo.route_name ? <span className="ml-1 text-slate-400">· {fo.route_name}</span> : null}</div>
                <div>目的地：{fo.destination_code ?? "—"}</div>
                <div>国内单号：<span className="font-mono">{fo.domestic_tracking_no ?? "—"}</span></div>
                <div>国际单号：<span className="font-mono">{fo.intl_tracking_no ?? "—"}</span></div>
              </>
            )}
            <ForwardingLoadingInfo loading={loading} />
            {fo.aliases?.length > 0 && (
              <div className="inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-300">
                <Repeat className="h-3 w-3"/>已变更过线路 / 目的地（见下方操作记录）
              </div>
            )}
          </div>
        </Card>
        <Card title="物品声明">
          <InsuranceBlock
            insured={!!fo.insured}
            sensitive={fo.shipping_routes?.cargo_type === "sensitive"}
            desc={fo.items_desc}
            canEdit={canIntake}
            onSave={async (next) => { await setInsured({ data: { id, insured: next } }); await qc.invalidateQueries({ queryKey: ["admin-fo", id] }); }}
          />
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={<span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5"/>收件地址</span> as any}>
          {shippingAddress ? (
            <div className="space-y-0.5 text-xs text-slate-300">
              <div className="text-slate-100">{shippingAddress.recipient ?? shippingAddress.name ?? "—"} · {shippingAddress.phone ?? "—"}</div>
              <div>{[shippingAddress.line1 ?? shippingAddress.address1, shippingAddress.line2, shippingAddress.city, shippingAddress.province ?? shippingAddress.state, shippingAddress.postal_code ?? shippingAddress.zip, shippingAddress.country].filter(Boolean).join(", ")}</div>
            </div>
          ) : <div className="text-xs text-slate-500">未关联收件地址</div>}
        </Card>
        <Card title={<span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5"/>客户注册地址</span> as any}>
          {user?.reg_address || user?.reg_city || user?.reg_country ? (
            <div className="space-y-0.5 text-xs text-slate-300">
              <div className="text-slate-100">{user.full_name ?? "—"} · {user.reg_phone ?? user.phone ?? "—"}</div>
              <div>{[user.reg_address, user.reg_city, user.reg_province, user.reg_postal_code, user.reg_country].filter(Boolean).join(", ")}</div>
            </div>
          ) : <div className="text-xs text-slate-500">用户未填写注册地址</div>}
        </Card>
      </div>

      <ItemsCustomerCard
        forwardingId={id}
        items={items ?? []}
        canEdit={canIntake}
        onChanged={() => qc.invalidateQueries({ queryKey: ["admin-fo", id] })}
      />

      {canIntake && (
        <Card title="入库 / 录入尺寸与重量（按运单汇总）">
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <label className="text-[10px] uppercase text-slate-500">线路 *</label>
                <select value={routeId} onChange={(e) => setRouteId(e.target.value)} required
                  className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100 [&>option]:bg-[#0E1626]">
                  <option value="">选择线路…</option>
                  {routesQ.data?.routes.map((r: any) => <option key={r.id} value={r.id}>{r.code} - {r.name_zh}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">总重量 kg（汇总）</label>
                <input readOnly value={previewData?.total_weight?.toFixed(3) ?? "—"}
                  className="w-full cursor-not-allowed rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-slate-300"/>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">总体积 m³（汇总）</label>
                <input readOnly value={previewData ? (previewData.total_volume_cm3 / 1e6).toFixed(4) : "—"}
                  className="w-full cursor-not-allowed rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-xs text-slate-300"/>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className="text-[10px] uppercase text-slate-500">申报价值 CAD</label>
                <input type="number" step="0.01" placeholder="0.00" value={decl} onChange={(e) => setDecl(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100"/>
              </div>
              <div>
                <label className="text-[10px] uppercase text-slate-500">备注</label>
                <input value={note} onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100"/>
              </div>
            </div>

            {previewData?.snapshot && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                <div className="mb-2 text-xs font-semibold text-emerald-300 inline-flex items-center gap-1"><Calculator className="h-3 w-3"/>运费明细预览</div>
                <div className="grid gap-2 text-xs sm:grid-cols-3 md:grid-cols-6">
                  <div><div className="text-slate-500">实重</div><div>{previewData.snapshot.actual_weight} kg</div></div>
                  <div><div className="text-slate-500">体积重</div><div>{previewData.snapshot.volumetric_weight} kg</div></div>
                  <div><div className="text-slate-500">计费重</div><div className="text-emerald-300">{previewData.snapshot.chargeable_weight} kg</div></div>
                  <div><div className="text-slate-500">单价</div><div>{fmtCAD(previewData.snapshot.unit_price_cad || 0)}/kg</div></div>
                  <div><div className="text-slate-500">运费</div><div className="text-emerald-300">{fmtCAD(previewData.snapshot.freight_cad || 0)}</div></div>
                  <div><div className="text-slate-500">关税</div><div>{previewData.snapshot.customs_applies === false ? <span className="text-emerald-300">包关税 / Include</span> : (Number(previewData.snapshot.duty_cad||0) > 0 ? fmtCAD(previewData.snapshot.duty_cad) : "—")}</div></div>
                  <div><div className="text-slate-500">保费</div><div>{fmtCAD(previewData.snapshot.insurance_cad||0)}</div></div>
                </div>
                <div className="mt-1 text-[10px] text-slate-500">共 {previewData.waybill_count} 个运单</div>
              </div>
            )}
            <button type="submit" disabled={busy || !previewData?.snapshot}
              className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
              {isRouteChange ? <Repeat className="h-3.5 w-3.5"/> : <PackageCheck className="h-3.5 w-3.5"/>}
              {isRouteChange ? "变更线路并重新入库（生成新单号）" : "入库并生成费用"}
            </button>
            {isRouteChange && <div className="text-[10px] text-amber-400">线路与客户选择不同，提交将生成新的集运单号 / 运单号 / 面单。旧号会自动加入历史单号列表。</div>}
            {err && <div className="text-xs text-rose-400">{err}</div>}
          </form>
        </Card>
      )}

      {snap && (
        <Card title="当前运费快照">
          <div className="grid gap-2 text-xs sm:grid-cols-3 md:grid-cols-6">
            <div><div className="text-slate-500">实重</div><div>{snap.actual_weight} kg</div></div>
            <div><div className="text-slate-500">体积重</div><div>{snap.volumetric_weight} kg</div></div>
            <div><div className="text-slate-500">计费重</div><div className="text-slate-100">{snap.chargeable_weight} kg</div></div>
            <div><div className="text-slate-500">运费</div><div className="text-emerald-300">{fmtCAD(snap.freight_cad || 0)}</div></div>
            <div><div className="text-slate-500">关税</div><div>{snap.customs_applies === false ? <span className="text-emerald-300">包关税 / Include</span> : (Number(snap.duty_cad||0) > 0 ? fmtCAD(snap.duty_cad) : "—")}</div></div>
            <div><div className="text-slate-500">保费</div><div>{fo.insured ? fmtCAD(snap.insurance_cad||0) : <span className="text-slate-500">未购买</span>}</div></div>
            <div><div className="text-slate-500">附加费</div><div>{fmtCAD(snap.surcharges_cad||0)}</div></div>
            <div className="col-span-2 md:col-span-3"><div className="text-slate-500">合计（列表"费用"）</div><div className="text-base font-bold text-amber-300">{fmtCAD(snap.total_cad||0)}</div></div>
          </div>
          <div className="mt-2 text-[10px] text-slate-500">公式：合计 = 运费 + 关税 + (已购买ⓘ保险时) 保费 + 附加费(CNY×汇率)</div>
        </Card>
      )}

      <div className="[&_*]:!text-white [&_.text-slate-500]:!text-white/60 [&_.text-slate-400]:!text-white/70 [&_.text-slate-600]:!text-white/40">
        <SurchargePanel scope="forwarding" id={id} canEdit={canIntake} title="附加费 · 集运订单层面"
          onChanged={() => qc.invalidateQueries({ queryKey: ["admin-fo", id] })}/>
      </div>

      {/* Waybill-level surcharges are now merged into the waybills table below (附加费 column). */}


      <WaybillsSection waybills={waybills} canEdit={canIntake}
        onAdd={async (rows) => {
          await addWaybills({ data: { forwardingId: id, rows } });
          qc.invalidateQueries({ queryKey: ["admin-fo", id] });
        }}
        onEditDims={async (waybillId, patch) => {
          await updateDims({ data: { waybillId, ...patch } });
          qc.invalidateQueries({ queryKey: ["admin-fo", id] });
        }}
        onSurchargesChanged={() => qc.invalidateQueries({ queryKey: ["admin-fo", id] })}
      />

      <Card title="物流轨迹">
        <div className="[&_*]:!text-white [&_.text-ink-soft]:!text-white/70 [&_.text-border]:!text-white/30">
          {(events ?? []).length === 0
            ? <div className="p-3 text-xs text-white/70">暂无轨迹</div>
            : <TrackingTimeline events={(events ?? []).map((e: any) => ({
                status_zh: e.status_zh, status_en: e.status_en,
                location_zh: e.location_zh, location_en: e.location_en,
                event_time: e.event_time,
                source: e.source === "admin" ? "admin_action" : e.source === "third_party" ? "third_party" : "admin_manual",
                source_ref: e.source_ref ?? null,
              }))} lang="zh" />}
        </div>
      </Card>


      <Card title="客户上传的文件 / 图片">
        <div className="[&_*]:!text-white [&_.text-ink-soft]:!text-white/70 [&_.border-border]:!border-white/10 [&_.divide-border]:!divide-white/10">
          <OrderAttachments ownerKind="forwarding" ownerId={id} lang="zh" />
        </div>
      </Card>

      <Card title="操作记录">
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {logs.length === 0 && <div className="text-xs text-slate-500">暂无</div>}
          {logs.map((l: any) => {
            const ACTION_LABEL: Record<string,string> = { change_route: "变更线路 / 目的地", update_dims: "编辑运单尺寸/重量", intake: "入库", add_waybills: "新增运单", set_insured: "保险状态变更" };
            const isRoute = l.action === "change_route";
            const isDims = l.action === "update_dims";
            return (
              <div key={l.id} className="rounded-md border border-white/5 bg-white/[0.02] p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">{ACTION_LABEL[l.action] ?? l.action}</span>
                  <span className="text-slate-500">{fmtDate(l.created_at)}</span>
                </div>
                <div className="text-slate-400">操作人：{l.operator_name ?? "—"}{l.note ? ` · ${l.note}` : ""}</div>
                {isRoute && l.before && l.after && (
                  <div className="mt-1 grid gap-1 rounded bg-white/[0.03] p-1.5 sm:grid-cols-2">
                    <div><div className="text-[10px] text-slate-500">变更前</div><div className="font-mono text-rose-300">{l.before.no ?? "—"}</div><div className="text-slate-400">线路 {l.before.route_code ?? "—"} · 目的地 {l.before.destination_code ?? "—"}</div></div>
                    <div><div className="text-[10px] text-slate-500">变更后</div><div className="font-mono text-emerald-300">{l.after.no ?? "—"}</div><div className="text-slate-400">线路 {l.after.route_code ?? "—"} · 目的地 {l.after.destination_code ?? "—"}{typeof l.after.waybills_changed === "number" ? ` · ${l.after.waybills_changed} 个运单同步换号` : ""}</div></div>
                  </div>
                )}
                {isDims && (l.before || l.after) && (
                  <div className="mt-1 grid gap-1 rounded bg-white/[0.03] p-1.5 sm:grid-cols-2">
                    <div><div className="text-[10px] text-slate-500">变更前</div><div className="font-mono text-rose-300">{fmtDims(l.before)}</div></div>
                    <div><div className="text-[10px] text-slate-500">变更后</div><div className="font-mono text-emerald-300">{fmtDims({ ...l.before, ...l.after })}</div></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

type Row = { weight_kg?: number; length_cm?: number; width_cm?: number; height_cm?: number; note?: string };
const fmtDims = (v: any) => v ? `${v.weight_kg ?? "—"}kg · ${v.length_cm ?? "—"}×${v.width_cm ?? "—"}×${v.height_cm ?? "—"}` : "—";

function WaybillsSection({ waybills, canEdit, onAdd, onEditDims, onSurchargesChanged }: {
  waybills: any[]; canEdit: boolean;
  onAdd: (rows: Row[]) => Promise<void>;
  onEditDims: (waybillId: string, patch: Partial<Row>) => Promise<void>;
  onSurchargesChanged?: () => void;
}) {
  const [surchargeWb, setSurchargeWb] = useState<any | null>(null);
  const [show, setShow] = useState(false);
  const [rows, setRows] = useState<Row[]>([{}]);
  const [busy, setBusy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Row>({});

  const addBlank = () => setRows([...rows, {}]);
  const copyLast = () => { const last = rows[rows.length - 1] ?? {}; setRows([...rows, { ...last }]); };
  const dup = (n: number) => { const last = rows[rows.length - 1] ?? {}; const add = Array.from({ length: n }, () => ({ ...last })); setRows([...rows, ...add]); };
  const remove = (i: number) => setRows(rows.filter((_, idx) => idx !== i));
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));

  const submit = async () => {
    setBusy(true);
    try { await onAdd(rows.filter(r => r.weight_kg || r.length_cm)); setShow(false); setRows([{}]); }
    finally { setBusy(false); }
  };

  const startEdit = (w: any) => {
    setEditId(w.id);
    setEditForm({ weight_kg: w.weight_kg ?? undefined, length_cm: w.length_cm ?? undefined, width_cm: w.width_cm ?? undefined, height_cm: w.height_cm ?? undefined });
  };
  const saveEdit = async () => {
    if (!editId) return;
    setBusy(true);
    try { await onEditDims(editId, editForm); setEditId(null); }
    finally { setBusy(false); }
  };

  return (
    <Card title={`运单 (${waybills.length})`} action={canEdit && (
      <button onClick={() => setShow(true)} className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-xs font-semibold text-white"><Plus className="h-3 w-3"/>新增 / 批量创建</button>
    )}>
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase text-slate-500">
          <tr><th className="py-2">运单号</th><th>唛头号</th><th>箱号</th><th>托盘号</th><th>物品</th><th>状态</th><th>重量</th><th>计费重</th><th>尺寸 (L×W×H)</th><th>运费</th><th>关税</th><th>保险</th><th>附加费</th><th></th></tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {waybills.length === 0 && <tr><td colSpan={14} className="py-6 text-center text-slate-500">—</td></tr>}
          {waybills.map((w: any) => {
            const snap = w.weight_snapshot ?? {};
            const cw = Number(snap.chargeable_weight ?? 0);
            return (
            <tr key={w.id}>
              <td className="py-2">
                <Link to="/admin/waybills/$waybillId" params={{ waybillId: w.id }} className="font-mono text-xs text-brand">{w.waybill_no}</Link>
              </td>
              <td className="font-mono text-[11px] text-slate-300">{w.mark_no ?? "—"}</td>
              <td className="font-mono text-[11px] text-slate-300">{w.box_no ?? "—"}</td>
              <td className="font-mono text-[11px] text-slate-300">{w.pallet_no ?? "—"}</td>
              <td className="text-[11px] text-slate-300">{fmtItemsSummary(w.items_summary)}</td>
              <td><StatusBadge map={WAYBILL_STATUS_LABEL} color={WAYBILL_STATUS_COLOR} value={w.status}/></td>
              {editId === w.id ? (
                <>
                  <td>
                    <input type="number" step="0.001" value={editForm.weight_kg ?? ""}
                      onChange={(e) => setEditForm({ ...editForm, weight_kg: e.target.value ? +e.target.value : undefined })}
                      className="w-20 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-xs"/>
                  </td>
                  <td className="text-xs text-slate-400">{cw > 0 ? `${cw} kg` : "—"}</td>
                  <td>
                    <div className="flex gap-1">
                      {(["length_cm","width_cm","height_cm"] as const).map((k) => (
                        <input key={k} type="number" value={(editForm as any)[k] ?? ""}
                          onChange={(e) => setEditForm({ ...editForm, [k]: e.target.value ? +e.target.value : undefined })}
                          className="w-12 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-xs"/>
                      ))}
                    </div>
                  </td>
                  <td className="text-xs text-emerald-300">{fmtCAD(Number(w.freight_cad ?? 0))}</td>
                  <td className="text-xs">{snap.customs_applies === false ? <span className="text-emerald-300">包关税</span> : (Number(w.duty_cad ?? 0) > 0 ? fmtCAD(Number(w.duty_cad)) : "—")}</td>
                  <td className="text-xs">{Number(w.insurance_cad ?? 0) > 0 ? fmtCAD(Number(w.insurance_cad)) : "—"}</td>
                  <td className="text-xs">
                    <SurchargeCell w={w} onOpen={() => setSurchargeWb(w)} />
                  </td>
                  <td>
                    <button onClick={saveEdit} disabled={busy} className="mr-1 rounded bg-brand px-2 py-0.5 text-[10px] text-white">保存</button>
                    <button onClick={() => setEditId(null)} className="rounded border border-white/10 px-2 py-0.5 text-[10px]">取消</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="text-xs">{w.weight_kg ?? "—"} kg</td>
                  <td className="text-xs text-slate-200" title={snap.actual_weight != null ? `实重 ${snap.actual_weight}kg · 体积重 ${snap.volumetric_weight}kg` : ""}>{cw > 0 ? `${cw} kg` : "—"}</td>
                  <td className="text-xs font-mono">{w.length_cm && w.width_cm && w.height_cm ? `${w.length_cm}×${w.width_cm}×${w.height_cm}` : "—"}</td>
                  <td className="text-xs text-emerald-300">{fmtCAD(Number(w.freight_cad ?? 0))}</td>
                  <td className="text-xs">{snap.customs_applies === false ? <span className="text-emerald-300">包关税</span> : (Number(w.duty_cad ?? 0) > 0 ? fmtCAD(Number(w.duty_cad)) : "—")}</td>
                  <td className="text-xs">{Number(w.insurance_cad ?? 0) > 0 ? fmtCAD(Number(w.insurance_cad)) : "—"}</td>
                  <td className="text-xs">
                    <SurchargeCell w={w} onOpen={() => setSurchargeWb(w)} />
                  </td>
                  <td>{canEdit && <button onClick={() => startEdit(w)} className="rounded p-1 text-slate-400 hover:bg-white/10"><Pencil className="h-3 w-3"/></button>}</td>
                </>
              )}
            </tr>
          );})}
        </tbody>
      </table>


      {show && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">添加运单（可批量）</h2>
              <button onClick={() => setShow(false)}><X className="h-4 w-4 text-slate-400"/></button>
            </div>
            <div className="mb-3 flex gap-2 text-xs">
              <button onClick={addBlank} className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/5"><Plus className="inline h-3 w-3"/>添加一行</button>
              <button onClick={copyLast} className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/5"><Copy className="inline h-3 w-3"/>复制上一行</button>
              <button onClick={() => dup(5)} className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/5">+5 同规格</button>
              <button onClick={() => dup(10)} className="rounded-md border border-white/10 px-2 py-1 hover:bg-white/5">+10 同规格</button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase text-slate-500">
                  <tr><th>#</th><th>重 (kg)</th><th>长</th><th>宽</th><th>高</th><th>备注</th><th></th></tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td className="py-1 text-slate-500">{i + 1}</td>
                      <td><input type="number" step="0.001" value={r.weight_kg ?? ""} onChange={(e) => update(i, { weight_kg: e.target.value ? +e.target.value : undefined })} className="w-16 rounded border border-white/10 bg-white/5 px-1 py-1"/></td>
                      <td><input type="number" value={r.length_cm ?? ""} onChange={(e) => update(i, { length_cm: e.target.value ? +e.target.value : undefined })} className="w-14 rounded border border-white/10 bg-white/5 px-1 py-1"/></td>
                      <td><input type="number" value={r.width_cm ?? ""} onChange={(e) => update(i, { width_cm: e.target.value ? +e.target.value : undefined })} className="w-14 rounded border border-white/10 bg-white/5 px-1 py-1"/></td>
                      <td><input type="number" value={r.height_cm ?? ""} onChange={(e) => update(i, { height_cm: e.target.value ? +e.target.value : undefined })} className="w-14 rounded border border-white/10 bg-white/5 px-1 py-1"/></td>
                      <td><input value={r.note ?? ""} onChange={(e) => update(i, { note: e.target.value })} className="w-full rounded border border-white/10 bg-white/5 px-1 py-1"/></td>
                      <td><button onClick={() => remove(i)} className="text-rose-400">×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button disabled={busy} onClick={submit} className="mt-3 w-full rounded-md bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? "创建中…" : `创建 ${rows.length} 个运单`}
            </button>
          </div>
        </div>
      )}

      {surchargeWb && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setSurchargeWb(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-white">运单附加费 · <span className="font-mono text-brand">{surchargeWb.waybill_no}</span></h2>
              <button onClick={() => setSurchargeWb(null)}><X className="h-4 w-4 text-slate-400"/></button>
            </div>
            <div className="[&_*]:!text-white [&_.text-slate-500]:!text-white/60 [&_.text-slate-400]:!text-white/70 [&_.text-slate-600]:!text-white/40">
              <SurchargePanel scope="waybill" id={surchargeWb.id} canEdit={canEdit}
                title={`运单 ${surchargeWb.waybill_no}`}
                onChanged={onSurchargesChanged}/>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function SurchargeCell({ w, onOpen }: { w: any; onOpen: () => void }) {
  const total = Number(w.surcharge_total_cny ?? 0);
  const count = Number(w.surcharge_count ?? 0);
  return (
    <button onClick={onOpen}
      className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] hover:border-brand/40 hover:bg-brand/10">
      {count > 0 ? (
        <>
          <span className={`font-mono ${total < 0 ? "text-rose-300" : "text-emerald-300"}`}>¥{total.toFixed(2)}</span>
          <span className="text-slate-400">· {count}项</span>
        </>
      ) : <span className="text-slate-400">+ 添加</span>}
    </button>
  );
}

// ===== helpers =====
const fmtItemsSummary = (s: any): string => {
  if (!Array.isArray(s) || s.length === 0) return "—";
  return s.map((it: any) => `${it.name ?? "—"}×${it.quantity ?? 1}`).join("、");
};

function InsuranceBlock({ insured, desc, canEdit, onSave, sensitive }: { sensitive: boolean; insured: boolean; desc: string | null; canEdit: boolean; onSave: (next: boolean) => Promise<void> }) {
  const [val, setVal] = useState(insured);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setVal(insured); }, [insured]);
  const dirty = val !== insured;
  return (
    <div className="space-y-2 text-xs text-slate-300">
      <div className="flex items-center gap-2">
        {insured ? <ShieldCheck className="h-4 w-4 text-emerald-400"/> : <ShieldOff className="h-4 w-4 text-slate-500"/>}
        <span className="font-semibold">{insured ? "已购买运输保险" : "未购买运输保险"}</span>
      </div>
      <div className="whitespace-pre-wrap text-slate-400">{desc ?? "—"}</div>
      {sensitive && <p>{SENSITIVE_INSURANCE_NOTICE}</p>}
      {canEdit && !sensitive && (
        <div className="flex items-center gap-2 pt-1">
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={val} onChange={(e) => setVal(e.target.checked)}/>
            <span>是否购买保险</span>
          </label>
          <button disabled={!dirty || busy} onClick={async () => { setBusy(true); try { await onSave(val); } finally { setBusy(false); } }}
            className="rounded-md bg-brand px-2 py-1 text-[11px] font-semibold text-white disabled:opacity-40">保存</button>
        </div>
      )}
    </div>
  );
}

// 列定义：k=字段名, kind=显示/输入类型。material/origin/brand/box_count/inner_qty
// 已从 extras 提升为 forwarding_items 列（读取时列优先、回退 extras）。
const ITEM_COLS: { k: string; label: string; kind: "text" | "num" | "money" }[] = [
  { k: "name", label: "品名", kind: "text" },
  { k: "quantity", label: "数量(总)", kind: "num" },
  { k: "unit_price_cad", label: "单价 CAD", kind: "money" },
  { k: "subtotal_cad", label: "小计 CAD", kind: "money" }, // 只读，计算
  { k: "unit_price_cny", label: "单价 CNY", kind: "money" },
  { k: "material", label: "材质", kind: "text" },
  { k: "origin", label: "产地", kind: "text" },
  { k: "brand", label: "品牌", kind: "text" },
  { k: "hs_code", label: "HSCODE", kind: "text" },
  { k: "box_count", label: "箱数", kind: "num" },
  { k: "inner_qty", label: "每箱数量", kind: "num" },
];
const itemVal = (it: any, k: string) => {
  if (k === "hs_code") return it.hs_code ?? it.extras?.hscode ?? "";
  if (["material", "origin", "brand", "box_count", "inner_qty"].includes(k)) return it[k] ?? it.extras?.[k] ?? "";
  return it[k] ?? "";
};
const itemSubtotal = (it: any) => {
  const unit = Number(itemVal(it, "unit_price_cad") || 0);
  const qty = Number(itemVal(it, "quantity") || 0);
  return unit > 0 && qty > 0 ? +(unit * qty).toFixed(2) : null;
};

function ItemsCustomerCard({
  forwardingId,
  items,
  canEdit,
  onChanged,
}: {
  forwardingId: string;
  items: any[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const updFn = useServerFn(updateForwardingItem);
  const addFn = useServerFn(addForwardingItem);
  const delFn = useServerFn(deleteForwardingItem);
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const editKeys = ITEM_COLS.filter((c) => c.k !== "subtotal_cad").map((c) => c.k);
  const startEdit = (it: any) => {
    setAdding(false);
    setEditId(it.id);
    setDraft(Object.fromEntries(editKeys.map((k) => [k, itemVal(it, k)])));
  };
  const startAdd = () => {
    setEditId(null);
    setAdding(true);
    setDraft(Object.fromEntries(editKeys.map((k) => [k, ""])));
  };
  const cancel = () => {
    setEditId(null);
    setAdding(false);
    setDraft({});
  };
  const buildPatch = () => {
    const p: any = {};
    for (const k of editKeys) {
      const raw = draft[k];
      if (["quantity", "unit_price_cad", "unit_price_cny", "box_count", "inner_qty"].includes(k)) {
        p[k] = raw === "" || raw == null ? (["box_count", "inner_qty"].includes(k) ? null : 0) : Number(raw);
      } else if (k === "hs_code") {
        p[k] = normalizeHsCodeForStorage(raw) ?? "";
      } else {
        p[k] = (raw ?? "").toString();
      }
    }
    return p;
  };
  const save = async () => {
    let patch: any;
    try {
      patch = buildPatch();
    } catch (e: any) {
      toast.error(e.message ?? "保存失败");
      return;
    }
    setBusy(true);
    try {
      if (adding) await addFn({ data: { forwardingId, patch } });
      else if (editId) await updFn({ data: { itemId: editId, patch } });
      cancel();
      onChanged();
    } catch (e: any) {
      toast.error(e.message ?? "保存失败");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    if (!confirm("删除这条物品？关税明细与集运单总额会自动重算。")) return;
    setBusy(true);
    try {
      await delFn({ data: { itemId: id } });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const fmtCell = (k: string, it: any) => {
    if (k === "subtotal_cad") {
      const v = itemSubtotal(it);
      return v == null ? <span className="text-slate-600">—</span> : <span className="text-emerald-300">C${v.toFixed(2)}</span>;
    }
    const v = itemVal(it, k);
    if (v === "" || v == null) return <span className="text-slate-600">—</span>;
    if (k === "unit_price_cad") return <span className="text-emerald-300">C${Number(v).toFixed(2)}</span>;
    if (k === "unit_price_cny") return <span className="text-slate-400">¥{Number(v).toFixed(2)}</span>;
    return String(v);
  };
  const editInput = (k: string) => {
    if (k === "subtotal_cad") {
      const unit = Number(draft.unit_price_cad || 0);
      const qty = Number(draft.quantity || 0);
      return <span className="text-emerald-300">{unit > 0 && qty > 0 ? `C$${(unit * qty).toFixed(2)}` : "—"}</span>;
    }
    if (k === "hs_code") {
      return <HsCodeInput value={draft.hs_code} onChange={(digits) => setDraft((d) => ({ ...d, hs_code: digits }))} />;
    }
    const isNum = ["quantity", "unit_price_cad", "unit_price_cny", "box_count", "inner_qty"].includes(k);
    return (
      <input
        value={draft[k] ?? ""}
        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
        type={isNum ? "number" : "text"}
        step={isNum ? "any" : undefined}
        className="w-full min-w-[64px] rounded border border-white/10 bg-white/5 px-1.5 py-1 text-xs text-slate-100 outline-none focus:border-brand"
      />
    );
  };

  if (!items?.length && !canEdit) return null;

  return (
    <Card
      title={<span className="inline-flex items-center gap-1"><Package className="h-3.5 w-3.5"/>客户录入物品（明细）</span> as any}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase text-slate-500">
            <tr>
              {ITEM_COLS.map((c) => <th key={c.k} className="py-1.5 pr-3 font-medium">{c.label}</th>)}
              {canEdit && <th className="py-1.5 pr-2 font-medium text-right">操作</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((it: any) => (
              <tr key={it.id} className="text-slate-200">
                {ITEM_COLS.map((c) => (
                  <td key={c.k} className="py-1.5 pr-3 align-top">
                    {editId === it.id ? editInput(c.k) : fmtCell(c.k, it)}
                  </td>
                ))}
                {canEdit && (
                  <td className="py-1.5 pr-2 text-right align-top whitespace-nowrap">
                    {editId === it.id ? (
                      <span className="inline-flex gap-1">
                        <button disabled={busy} onClick={save} className="rounded bg-brand px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40">保存</button>
                        <button disabled={busy} onClick={cancel} className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-300">取消</button>
                      </span>
                    ) : (
                      <span className="inline-flex gap-1">
                        <button onClick={() => startEdit(it)} className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:text-white">编辑</button>
                        <button onClick={() => remove(it.id)} className="rounded border border-rose-500/30 px-2 py-0.5 text-[11px] text-rose-300 hover:bg-rose-500/10">删除</button>
                      </span>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {adding && (
              <tr className="bg-white/[0.03] text-slate-200">
                {ITEM_COLS.map((c) => (
                  <td key={c.k} className="py-1.5 pr-3 align-top">{editInput(c.k)}</td>
                ))}
                <td className="py-1.5 pr-2 text-right align-top whitespace-nowrap">
                  <span className="inline-flex gap-1">
                    <button disabled={busy} onClick={save} className="rounded bg-brand px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40">保存</button>
                    <button disabled={busy} onClick={cancel} className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-slate-300">取消</button>
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {canEdit && !adding && (
        <button
          onClick={startAdd}
          className="mt-2 inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-white/10"
        >
          <Plus className="h-3 w-3" />添加物品
        </button>
      )}
      {canEdit && (
        <p className="mt-2 text-[10px] text-slate-500">
          保存后自动重算：关税逐品名明细（waybill_items）、集运单申报价 / 运费总额，并同步各运单拆分中的品名。
        </p>
      )}
    </Card>
  );
}

function BasicField({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-slate-400">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="未填写"
        className={`w-40 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100 outline-none focus:border-brand ${mono ? "font-mono" : ""}`}
      />
    </div>
  );
}
