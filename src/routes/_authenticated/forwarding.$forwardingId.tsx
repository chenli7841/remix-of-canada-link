import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/i18n";
import { OrderAttachments } from "@/components/order-attachments";
import { WaybillsList } from "@/components/waybills-list";
import { TrackingTimeline } from "@/components/tracking-timeline";
import {
  ArrowLeft,
  Package,
  Plane,
  Hash,
  Loader2,
  Activity,
  Receipt,
  ShieldCheck,
  FileText,
  Truck,
  Paperclip,
  Boxes,
  Weight,
  Ruler,
  Trash2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/forwarding/$forwardingId")({
  head: () => ({ meta: [{ title: "订单/运单详情 / Order & Waybill Detail — SinoCargo" }] }),
  component: ForwardingDetailPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center text-destructive">{error instanceof Error ? error.message : String(error)}</div>
  ),
  notFoundComponent: () => <div className="mx-auto max-w-3xl px-4 py-20 text-center text-ink-soft">Not found</div>,
});

const sb = supabase as any;

// 只读后端算好存下来的快照值——不在前端猜一个除数现算。线路的体积重除数是
// 可配置的（不一定是 6000），前端猜错了会显示一个跟最终计费对不上的数字，
// 不如老实显示"还没算出来"。快照还没生成时返回 null，调用方自己决定怎么显示。
function volumetricWeightKg(w: any): number | null {
  const saved = Number(w?.weight_snapshot?.volumetric_weight ?? 0);
  return saved > 0 ? saved : null;
}

function ForwardingDetailPage() {
  const { forwardingId } = Route.useParams();
  const { lang, cnyToCad } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [fo, setFo] = useState<any | null>(null);
  const [waybills, setWaybills] = useState<any[]>([]);
  const [fItems, setFItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<any[]>([]);

  const [shipAddr, setShipAddr] = useState<any | null>(null);
  const [profile, setProfile] = useState<any | null>(null);
  const [routeInfo, setRouteInfo] = useState<any | null>(null);
  const [busyDel, setBusyDel] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const { data } = await sb.from("forwarding_orders").select("*").eq("id", forwardingId).maybeSingle();
      const { data: wb } = await sb.from("waybills").select("*").eq("forwarding_id", forwardingId).order("created_at");
      const { data: fi } = await sb
        .from("forwarding_items")
        .select("*")
        .eq("forwarding_id", forwardingId)
        .order("created_at");
      setFo(data ?? null);
      setWaybills(wb ?? []);
      setFItems(fi ?? []);
      if (data?.address_id) {
        const { data: a } = await sb.from("addresses").select("*").eq("id", data.address_id).maybeSingle();
        setShipAddr(a ?? null);
      }
      const { data: p } = await sb
        .from("profiles")
        .select("full_name, phone, reg_country, reg_province, reg_city, reg_address, reg_postal_code, reg_phone")
        .maybeSingle();
      setProfile(p ?? null);
      if (data?.route_id) {
        const { data: r } = await sb
          .from("shipping_routes")
          .select("code, name_zh, name_en")
          .eq("id", data.route_id)
          .maybeSingle();
        setRouteInfo(r ?? null);
      }
      // Timeline: follow only the first waybill (avoid duplicating events across all waybills)
      const firstWaybillNo = (wb ?? [])[0]?.waybill_no ?? null;
      const allEvents: any[] = [];
      if (firstWaybillNo) {
        const { data: ships } = await sb.from("shipments").select("id, tracking_no").eq("tracking_no", firstWaybillNo);
        const shipIds = (ships ?? []).map((s: any) => s.id);
        if (shipIds.length) {
          const { data: evs } = await sb
            .from("tracking_events")
            .select("*")
            .in("shipment_id", shipIds)
            .order("event_time");
          for (const e of evs ?? []) allEvents.push(e);
        }
      }
      if (data) {
        allEvents.push({
          status_zh: "订单已生成",
          status_en: "Order created",
          location_zh: data.warehouse ?? null,
          location_en: data.warehouse ?? null,
          event_time: data.created_at,
          source: "admin_manual",
        });
      }
      setEvents(allEvents);
      setLoading(false);
    })();
  }, [forwardingId]);

  if (loading)
    return (
      <div className="grid h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-ink-soft" />
      </div>
    );
  if (!fo)
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center text-ink-soft">{tr("运单不存在", "Not found")}</div>
    );

  const statusLabel = (s: string) =>
    (
      ({
        pending: tr("未入库", "Pending arrival"),
        received: tr("已入库", "Received"),
        packed: tr("封箱打包", "Packed"),
        shipped: tr("运输中", "In transit"),
        in_transit: tr("正在派送", "Out for delivery"),
        ready_pickup: tr("待取货", "Ready for pickup"),
        delivered: tr("已完成", "Completed"),
        cancelled: tr("已取消", "Cancelled"),
      }) as Record<string, string>
    )[s] ?? s;

  // Only a still-"未入库" request may be removed by the customer; the DB policy
  // fo_delete_own enforces the same status === "pending" rule server-side.
  const onDelete = async () => {
    if (
      !window.confirm(
        tr(`确定删除集运订单 ${fo.request_no}？删除后无法恢复。`, `Delete forwarding request ${fo.request_no}? This cannot be undone.`),
      )
    )
      return;
    setBusyDel(true);
    try {
      const { data, error } = await sb
        .from("forwarding_orders")
        .delete()
        .eq("id", forwardingId)
        .eq("status", "pending")
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        toast.error(
          tr("无法删除：该集运订单已入库或状态已变更", "Cannot delete: this request is already in the warehouse"),
        );
        return;
      }
      toast.success(tr("集运订单已删除", "Forwarding request deleted"));
      navigate({ to: "/account", search: { tab: "myOrders" } });
    } catch (e: any) {
      toast.error(e?.message ?? tr("删除失败", "Delete failed"));
    } finally {
      setBusyDel(false);
    }
  };

  const waybillNos = waybills.map((w) => w.waybill_no).filter(Boolean);
  const totalWeight = waybills.reduce((a, w) => a + Number(w.weight_kg ?? 0), 0);
  const totalVolume = waybills.reduce((a, w) => {
    const l = Number(w.length_cm ?? 0),
      wd = Number(w.width_cm ?? 0),
      h = Number(w.height_cm ?? 0);
    return a + (l && wd && h ? (l * wd * h) / 1_000_000 : 0);
  }, 0);
  // 只要有一张运单的体积重快照还没生成，总数就不该显示一个悄悄偏小的部分和——
  // 那样看起来是个完整数字，其实是错的。宁可整体显示"计算中"。
  const perWaybillVolWeights = waybills.map((w) => volumetricWeightKg(w));
  const totalVolumetricWeight = perWaybillVolWeights.some((v) => v === null)
    ? null
    : (perWaybillVolWeights as number[]).reduce((sum, v) => sum + v, 0);
  // CAD is source of truth. total_cad is authoritative — it's what the admin list "费用" shows,
  // computed server-side as: freight + duty + (insured ? insurance : 0) + surcharges (CNY×fx).
  const snap: any = fo.freight_snapshot ?? null;
  const feeCad = Number(snap?.freight_cad ?? Number(fo.fee_cny ?? 0) * (snap?.fx_rate || 0.19));
  const insCad = fo.insured ? Number(snap?.insurance_cad ?? 0) : 0;
  const cusCad = Number(snap?.duty_cad ?? 0);
  const surCad = Number(snap?.surcharges_cad ?? 0);
  const customsApplies: boolean = snap ? snap.customs_applies !== false : true;
  const totalCad = Number(snap?.total_cad ?? feeCad + insCad + cusCad + surCad);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
      <Link
        to="/account"
        search={{ tab: "myOrders" }}
        className="mb-6 inline-flex items-center gap-2 text-sm text-ink-soft hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {tr("返回我的订单", "Back to my orders")}
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1 rounded-full bg-cta/10 px-2.5 py-0.5 text-xs font-semibold text-cta">
          <Truck className="h-3 w-3" />
          {tr("集运", "Forwarding")}
        </span>
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{tr("订单/运单详情", "Order & waybill detail")}</h1>
        <span className="font-mono text-sm text-ink-soft">{fo.request_no}</span>
        <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
          {statusLabel(fo.status)}
        </span>
        {fo.status === "pending" && (
          <button
            onClick={onDelete}
            disabled={busyDel}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            {busyDel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {tr("删除集运订单", "Delete request")}
          </button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Waybill identifiers */}
          <Card title={tr("运单标识", "Waybill identifiers")} icon={<Hash className="h-4 w-4" />}>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Stat label={tr("订单号", "Order No.")} value={<span className="font-mono">{fo.request_no}</span>} />
              <Stat
                label={tr("批次号", "Batch No.")}
                value={fo.batch_no ? <span className="font-mono">{fo.batch_no}</span> : "—"}
              />
              <Stat label={tr("客户号", "Customer")} value={fo.customer_code ?? "—"} />
              <Stat label={tr("目的地编号", "Destination")} value={fo.destination_code ?? "—"} />
              <Stat
                label={tr("线路编号", "Route")}
                value={
                  fo.route_code ? (
                    <span>
                      <span className="font-mono">{fo.route_code}</span>
                      {routeInfo?.name_zh || routeInfo?.name_en ? (
                        <span className="ml-1 text-ink-soft">
                          ·{" "}
                          {lang === "zh"
                            ? (routeInfo?.name_zh ?? routeInfo?.name_en)
                            : (routeInfo?.name_en ?? routeInfo?.name_zh)}
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    "—"
                  )
                }
              />
              <Stat
                label={tr("中国运单号", "China tracking")}
                value={
                  fo.domestic_tracking_no ? (
                    <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[11px]">
                      {fo.domestic_tracking_no}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-soft">—</span>
                  )
                }
              />
            </dl>
            <div className="mt-4">
              <dt className="text-[11px] uppercase tracking-wider text-ink-soft">
                {tr("运单号", "Waybill numbers")} ({waybillNos.length || (fo.tracking_no ? 1 : 0)})
              </dt>
              <dd className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
                {(waybillNos.length ? waybillNos : fo.tracking_no ? [fo.tracking_no] : []).map((n) => (
                  <span
                    key={n}
                    className="truncate rounded-full bg-brand/10 px-2 py-0.5 text-center font-mono text-[11px] text-brand"
                  >
                    {n}
                  </span>
                ))}
                {waybillNos.length === 0 && !fo.tracking_no && <span className="text-xs text-ink-soft">—</span>}
              </dd>
            </div>

            {/* Order-level totals */}
            <div className="mt-5 rounded-xl border border-border bg-background/40 p-4">
              <div className="mb-3 text-[11px] uppercase tracking-wider text-ink-soft">
                {tr("订单汇总", "Order summary")}
              </div>
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                <Stat
                  label={
                    <span className="inline-flex items-center gap-1">
                      <Boxes className="h-3 w-3" />
                      {tr("运单数（箱数）", "Waybills (boxes)")}
                    </span>
                  }
                  value={waybills.length || "—"}
                />
                <Stat
                  label={
                    <span className="inline-flex items-center gap-1">
                      <Weight className="h-3 w-3" />
                      {tr("总重量", "Total weight")}
                    </span>
                  }
                  value={
                    totalWeight > 0
                      ? `${totalWeight.toFixed(2)} kg`
                      : fo.weight_kg
                        ? `${Number(fo.weight_kg).toFixed(2)} kg`
                        : "—"
                  }
                />
                <Stat
                  label={
                    <span className="inline-flex items-center gap-1">
                      <Ruler className="h-3 w-3" />
                      {tr("总体积", "Total volume")}
                    </span>
                  }
                  value={
                    totalVolume > 0
                      ? totalVolumetricWeight !== null
                        ? `${totalVolume.toFixed(3)} m³ / ${totalVolumetricWeight.toFixed(2)} kg ${tr("体积重", "vol. wt.")}`
                        : `${totalVolume.toFixed(3)} m³ / ${tr("体积重计算中", "vol. wt. pending")}`
                      : "—"
                  }
                />
                <Stat
                  label={
                    <span className="inline-flex items-center gap-1">
                      <Receipt className="h-3 w-3" />
                      {tr("订单总运费", "Freight total")}
                    </span>
                  }
                  value={<span className="font-display font-bold text-brand-gradient">CA${totalCad.toFixed(2)}</span>}
                />
              </dl>
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-ink-soft sm:grid-cols-4">
                <div className="rounded-lg bg-accent/40 px-2 py-1.5">
                  <span className="inline-flex items-center gap-1">
                    <Plane className="h-3 w-3" />
                    {tr("运费", "Shipping")}
                  </span>
                  <div className="mt-0.5 font-mono text-foreground">CA${feeCad.toFixed(2)}</div>
                </div>
                <div className="rounded-lg bg-accent/40 px-2 py-1.5">
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {tr("关税", "Customs")}
                  </span>
                  <div className="mt-0.5 font-mono text-foreground">
                    {!customsApplies ? tr("包关税", "Include") : cusCad > 0 ? `CA$${cusCad.toFixed(2)}` : "—"}
                  </div>
                </div>
                <div className="rounded-lg bg-accent/40 px-2 py-1.5">
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    {tr("保险", "Insurance")}
                  </span>
                  <div className="mt-0.5 font-mono text-foreground">
                    {fo.insured ? `CA$${insCad.toFixed(2)}` : tr("未购买", "None")}
                  </div>
                </div>
                <div className="rounded-lg bg-accent/40 px-2 py-1.5">
                  <span className="inline-flex items-center gap-1">
                    <Receipt className="h-3 w-3" />
                    {tr("附加费", "Surcharges")}
                  </span>
                  <div className="mt-0.5 font-mono text-foreground">{surCad > 0 ? `CA$${surCad.toFixed(2)}` : "—"}</div>
                </div>
              </div>
            </div>
          </Card>

          {/* Items / package contents */}
          <Card
            title={tr("内件信息", "Package contents")}
            icon={<Package className="h-4 w-4" />}
            sub={fItems.length ? `${fItems.length} ${tr("项", "items")}` : undefined}
          >
            {fItems.length > 0 ? (
              <ul className="divide-y divide-border text-sm">
                {fItems.map((it) => (
                  <li key={it.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1 truncate font-medium">{it.name}</div>
                    <div className="text-xs text-ink-soft">
                      CA${Number((it as any).unit_price_cad ?? cnyToCad(Number(it.unit_price_cny))).toFixed(2)} ×{" "}
                      {it.quantity}
                    </div>
                    <div className="w-24 text-right font-display text-sm font-bold">
                      CA$
                      {(
                        Number((it as any).unit_price_cad ?? cnyToCad(Number(it.unit_price_cny))) * Number(it.quantity)
                      ).toFixed(2)}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-sm text-ink-soft">{fo.items_desc ?? tr("（未填写）", "—")}</div>
            )}
            <div className="mt-3 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
              <Stat
                label={tr("仓库", "Warehouse")}
                value={fo.warehouse === "guangzhou" ? tr("广州仓", "Guangzhou") : tr("义乌仓", "Yiwu")}
              />
              <Stat
                label={tr("申报重量", "Declared weight")}
                value={fo.weight_kg ? `${Number(fo.weight_kg).toFixed(2)} kg` : "—"}
              />
              <Stat label={tr("备注", "Note")} value={fo.note ?? "—"} />
            </div>
          </Card>

          {/* Per-waybill list with dims + weight */}
          <Card
            title={tr("运单（含尺寸/重量/批次/轨迹）", "Waybills (dims / weight / batch / tracking)")}
            icon={<Boxes className="h-4 w-4" />}
          >
            {waybills.length > 0 && (
              <div className="mb-3 overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-accent/40 text-left text-[10px] uppercase tracking-wider text-ink-soft">
                    <tr>
                      <th className="px-3 py-2">{tr("运单号", "Waybill")}</th>
                      <th className="px-3 py-2">{tr("唛头号", "Mark")}</th>
                      <th className="px-3 py-2">{tr("重量", "Weight")}</th>
                      <th className="px-3 py-2">{tr("尺寸 L×W×H", "L×W×H")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {waybills.map((w) => (
                      <tr key={w.id}>
                        <td className="px-3 py-2 font-mono">{w.waybill_no}</td>
                        <td className="px-3 py-2 font-mono text-ink-soft">{w.mark_no ?? "—"}</td>
                        <td className="px-3 py-2">{w.weight_kg ? `${Number(w.weight_kg).toFixed(2)} kg` : "—"}</td>
                        <td className="px-3 py-2 font-mono">
                          {w.length_cm && w.width_cm && w.height_cm
                            ? (() => {
                                const vw = volumetricWeightKg(w);
                                const dims = `${w.length_cm}×${w.width_cm}×${w.height_cm} cm`;
                                return vw !== null
                                  ? `${dims} / ${vw.toFixed(2)} kg ${tr("体积重", "vol. wt.")}`
                                  : `${dims} / ${tr("体积重计算中", "vol. wt. pending")}`;
                              })()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <WaybillsList ownerKind="forwarding" ownerId={fo.id} lang={lang} />
          </Card>

          {/* Addresses */}
          <Card title={tr("地址", "Addresses")} icon={<Paperclip className="h-4 w-4" />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border p-3">
                <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-soft">
                  {tr("收件地址", "Shipping address")}
                </div>
                {shipAddr ? (
                  <div className="text-sm">
                    <div className="font-semibold">
                      {shipAddr.recipient ?? shipAddr.name ?? "—"} · {shipAddr.phone ?? "—"}
                    </div>
                    <div className="mt-1 text-xs text-ink-soft">
                      {[
                        shipAddr.line1 ?? shipAddr.address1,
                        shipAddr.line2,
                        shipAddr.city,
                        shipAddr.province ?? shipAddr.state,
                        shipAddr.postal_code ?? shipAddr.zip,
                        shipAddr.country,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-ink-soft">{tr("未关联收件地址", "No shipping address")}</div>
                )}
              </div>
              <div className="rounded-xl border border-border p-3">
                <div className="mb-1 text-[11px] uppercase tracking-wider text-ink-soft">
                  {tr("我的注册地址", "Registered address")}
                </div>
                {profile?.reg_address || profile?.reg_city || profile?.reg_country ? (
                  <div className="text-sm">
                    <div className="font-semibold">
                      {profile.full_name ?? "—"} · {profile.reg_phone ?? profile.phone ?? "—"}
                    </div>
                    <div className="mt-1 text-xs text-ink-soft">
                      {[
                        profile.reg_address,
                        profile.reg_city,
                        profile.reg_province,
                        profile.reg_postal_code,
                        profile.reg_country,
                      ]
                        .filter(Boolean)
                        .join(", ")}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-ink-soft">
                    {tr("尚未填写。前往「个人中心 · 个人资料」补充。", "Not filled — go to Account · Profile to add.")}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Tracking timeline */}
          <Card title={tr("物流轨迹", "Tracking timeline")} icon={<Activity className="h-4 w-4" />}>
            <TrackingTimeline events={events as any} lang={lang} />
          </Card>

          {/* Attachments */}
          <Card title={tr("附件 / 单据", "Attachments")} icon={<Paperclip className="h-4 w-4" />}>
            <OrderAttachments ownerKind="forwarding" ownerId={fo.id} lang={lang} />
          </Card>
        </div>

        <aside className="space-y-6">
          <Card title={tr("费用明细", "Cost breakdown")} icon={<Receipt className="h-4 w-4" />}>
            <dl className="space-y-2 text-sm">
              <Row
                label={
                  <span className="inline-flex items-center gap-1">
                    <Plane className="h-3 w-3" />
                    {tr("国际运费", "Shipping")}
                  </span>
                }
                value={`CA$${feeCad.toFixed(2)}`}
              />
              <Row
                label={
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {tr("关税", "Customs/Duty")}
                  </span>
                }
                value={!customsApplies ? tr("包关税", "Include") : cusCad > 0 ? `CA$${cusCad.toFixed(2)}` : "—"}
              />
              <Row
                label={
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    {tr("保险", "Insurance")}
                  </span>
                }
                value={fo.insured ? `CA$${insCad.toFixed(2)}` : tr("未购买", "Not purchased")}
              />
              <Row
                label={
                  <span className="inline-flex items-center gap-1">
                    <Receipt className="h-3 w-3" />
                    {tr("附加费", "Surcharges")}
                  </span>
                }
                value={surCad > 0 ? `CA$${surCad.toFixed(2)}` : "—"}
              />
              <div className="my-2 border-t border-border" />
              <Row
                label={<span className="text-base font-semibold">{tr("合计", "Total")}</span>}
                value={
                  <span className="font-display text-lg font-bold text-brand-gradient">CA${totalCad.toFixed(2)}</span>
                }
              />
              <div className="pt-1 text-right text-[11px] text-ink-soft">
                {tr("付款状态", "Payment")}:{" "}
                {fo.payment_status === "paid" ? tr("已付款", "Paid") : tr("待付款", "Unpaid")}
              </div>
            </dl>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Card({
  title,
  icon,
  sub,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <header className="mb-4 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-brand/10 text-brand">{icon}</span>
        <h2 className="font-display text-sm font-bold uppercase tracking-wider">{title}</h2>
        {sub && <span className="ml-auto text-xs text-ink-soft">{sub}</span>}
      </header>
      {children}
    </section>
  );
}
function Stat({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold">{value}</dd>
    </div>
  );
}
function Row({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-ink-soft">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
