import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { getOrderDetail, cancelOrder, getLabelData, adminShipShopOrder, updateOrderDomesticTrackingNo } from "@/lib/orders.functions";
import { getMyRoles } from "@/lib/admin.functions";
import {
  ORDER_STATUS_LABEL, ORDER_STATUS_COLOR, WAYBILL_STATUS_LABEL, WAYBILL_STATUS_COLOR,
  METHOD_LABEL, StatusBadge, Card, fmtDate, fmtCNY, BackLink,
} from "@/lib/admin-shared";
import { Loader2, XCircle, Printer, Truck } from "lucide-react";
import { renderLabel } from "@/lib/label-render";
import { LabelSizeToggle } from "@/components/admin/LabelSizeToggle";
import { WorkflowStepper, SHOP_FLOW, WAYBILL_FLOW } from "@/components/admin/WorkflowStepper";
import { OrderAttachments } from "@/components/order-attachments";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESERVED_ORDER_IDS = ["procurement"];

export const Route = createFileRoute("/admin/orders/$orderId")({
  beforeLoad: ({ params }) => {
    const id = params.orderId;
    if (!UUID_RE.test(id) && RESERVED_ORDER_IDS.includes(id)) {
      throw redirect({ to: "/admin/shop/orders/procurement" });
    }
  },
  component: OrderDetail,
});

function OrderDetail() {
  const { orderId } = Route.useParams();
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getOrderDetail);
  const fetchRoles = useServerFn(getMyRoles);
  const cancelFn = useServerFn(cancelOrder);
  const fetchLabel = useServerFn(getLabelData);
  const shipShopFn = useServerFn(adminShipShopOrder);

  const detailQ = useQuery({ queryKey: ["admin-order", orderId], queryFn: () => fetchDetail({ data: { orderId } }) });
  const meQ = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles(), staleTime: 60_000 });
  const canEdit = (meQ.data?.roles ?? []).some(r => r === "owner" || r === "manager");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const saveDtnFn = useServerFn(updateOrderDomesticTrackingNo);
  const serverDtn = detailQ.data?.order?.domestic_tracking_no ?? "";
  const [dtn, setDtn] = useState("");
  useEffect(() => { setDtn(serverDtn); }, [serverDtn]);

  if (detailQ.isLoading) return <div className="grid place-items-center p-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500"/></div>;
  if (detailQ.isError) return <div className="p-6 text-rose-400">{(detailQ.error as Error).message}</div>;
  const { order, items, waybills, logs, user } = detailQ.data!;
  const addr: any = order.address_snapshot ?? {};

  const totalWeight = waybills.reduce((s: number, w: any) => s + (Number(w.weight_kg) || 0), 0);
  const totalVolume = waybills.reduce((s: number, w: any) => s + ((Number(w.length_cm) || 0) * (Number(w.width_cm) || 0) * (Number(w.height_cm) || 0)), 0);

  const onCancel = async () => {
    if (!confirm("确认取消该订单？")) return;
    setBusy(true);
    try { await cancelFn({ data: { orderId } }); await qc.invalidateQueries({ queryKey: ["admin-order", orderId] }); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const onPrint = async () => {
    const data = await fetchLabel({ data: { entityType: "order", entityId: orderId } });
    renderLabel(data as any);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <BackLink to="/admin/orders">返回订单列表</BackLink>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">订单 {order.order_no}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <StatusBadge map={ORDER_STATUS_LABEL} color={ORDER_STATUS_COLOR} value={order.status}/>
            <span>{order.payment_status === "paid" ? "已支付" : "未支付"}</span>
            <span>· 创建于 {fmtDate(order.created_at)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LabelSizeToggle />
          <button onClick={onPrint}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">
            <Printer className="h-3.5 w-3.5"/>生成面单
          </button>
          {canEdit && order.source === "shop" && order.status === "procurement" && (
            <button
              onClick={async () => {
                if (!confirm("确认标记为已发货等待入库？")) return;
                setBusy(true);
                try { await shipShopFn({ data: { orderId } }); await qc.invalidateQueries({ queryKey: ["admin-order", orderId] }); }
                catch (e: any) { setErr(e.message); } finally { setBusy(false); }
              }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-50">
              <Truck className="h-3.5 w-3.5"/>已发货等待入库
            </button>
          )}
          {canEdit && order.status !== "cancelled" && (
            <button onClick={onCancel} disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50">
              <XCircle className="h-3.5 w-3.5"/>取消订单
            </button>
          )}
        </div>
      </div>

      <WorkflowStepper
        flow={order.source === "shop" ? SHOP_FLOW : WAYBILL_FLOW}
        current={order.status}
        title={order.source === "shop" ? "电商订单流程" : "集运订单流程"}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="客户">
          {user ? (
            <div className="space-y-1 text-sm">
              <div className="text-slate-100">{user.full_name ?? "—"}</div>
              <div className="text-xs text-slate-400">{user.email}</div>
              <div className="text-xs text-slate-400">{user.phone ?? "—"}</div>
              <div className="text-xs font-mono text-slate-500">客户号 {user.customer_code ?? "—"}</div>
              <Link to="/admin/users/$userId" params={{ userId: user.id }} className="text-xs text-brand hover:underline">查看用户 →</Link>
            </div>
          ) : <div className="text-sm text-slate-500">—</div>}
        </Card>
        <Card title="收件地址">
          <div className="space-y-1 text-xs text-slate-300">
            <div className="text-slate-100">{addr.recipient ?? addr.name ?? "—"} · {addr.phone ?? ""}</div>
            <div>{addr.line1 ?? addr.address1 ?? "—"}</div>
            {addr.line2 && <div>{addr.line2}</div>}
            <div>{[addr.city, addr.province ?? addr.state, addr.postal_code ?? addr.zip].filter(Boolean).join(", ")}</div>
            <div>{addr.country ?? ""}</div>
          </div>
        </Card>
        <Card title="物流信息">
          <div className="space-y-1 text-xs text-slate-300">
            <div>方式：{METHOD_LABEL[order.shipping_method] ?? order.shipping_method}</div>
            <div>线路：<span className="font-mono">{order.route_code ?? "—"}</span></div>
            <div>国际单号：<span className="font-mono">{order.tracking_no ?? "—"}</span></div>
            <div className="flex items-center gap-2">
              <span>国内单号：</span>
              {canEdit ? (
                <>
                  <input
                    value={dtn}
                    onChange={(e) => setDtn(e.target.value)}
                    placeholder="未填写"
                    className="w-40 rounded-md border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-slate-100 outline-none focus:border-brand"
                  />
                  <button
                    disabled={busy || dtn.trim() === (order.domestic_tracking_no ?? "")}
                    onClick={async () => {
                      setBusy(true); setErr(null);
                      try {
                        await saveDtnFn({ data: { orderId, domestic_tracking_no: dtn } });
                        await qc.invalidateQueries({ queryKey: ["admin-order", orderId] });
                      } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
                    }}
                    className="rounded-md border border-brand/30 bg-brand/10 px-2 py-1 text-[11px] font-semibold text-brand disabled:opacity-40">
                    保存
                  </button>
                </>
              ) : <span className="font-mono">{order.domestic_tracking_no ?? "—"}</span>}
            </div>
            <div>批次：<span className="font-mono">{order.batch_no ?? "—"}</span></div>
            <div>所属箱号：{order.carton_id ? <span className="font-mono">{String(order.carton_id).slice(0,8)}…</span> : "—"}</div>
            <div>所属托盘：{order.pallet_id ? <span className="font-mono">{String(order.pallet_id).slice(0,8)}…</span> : "—"}</div>
          </div>
        </Card>
      </div>

      <Card title="商品 / 物品">
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase text-slate-500">
            <tr><th className="py-2">名称</th><th>SKU</th><th>数量</th><th>单价</th><th className="text-right">小计</th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-500">—</td></tr>}
            {items.map((it: any) => {
              const qty = it.qty ?? it.quantity ?? 1;
              return (
                <tr key={it.id}>
                  <td className="py-2 text-slate-200">{it.title ?? it.name ?? "—"}</td>
                  <td className="text-xs text-slate-400 font-mono">{it.sku ?? "—"}</td>
                  <td className="text-xs">{qty}</td>
                  <td className="text-xs">{fmtCNY(it.unit_price_cny)}</td>
                  <td className="text-right text-xs">{fmtCNY(qty * (Number(it.unit_price_cny) || 0))}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t border-white/10 text-xs">
            <tr><td colSpan={4} className="py-2 text-right text-slate-400">商品小计</td><td className="text-right">{fmtCNY(order.subtotal_cny)}</td></tr>
            <tr><td colSpan={4} className="py-1 text-right text-slate-400">运费</td><td className="text-right">{fmtCNY(order.shipping_cny)}</td></tr>
            <tr><td colSpan={4} className="py-1 text-right text-slate-400">关税</td><td className="text-right">{fmtCNY(order.customs_cny)}</td></tr>
            <tr><td colSpan={4} className="py-1 text-right text-slate-400">保险</td><td className="text-right">{fmtCNY(order.insurance_cny)}</td></tr>
            <tr><td colSpan={4} className="py-2 text-right font-semibold text-slate-200">合计</td><td className="text-right font-semibold text-emerald-300">{fmtCNY(order.total_cny)}</td></tr>
          </tfoot>
        </table>
      </Card>

      <Card title="包裹汇总">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
          <Stat label="箱数" value={order.box_count ?? waybills.length} />
          <Stat label="总重量 (实际)" value={`${totalWeight.toFixed(2)} kg`} />
          <Stat label="总体积" value={`${totalVolume.toLocaleString()} cm³`} />
          <Stat label="运单数" value={waybills.length} />
        </div>
      </Card>

      <Card title={`运单 (${waybills.length})`}>
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase text-slate-500">
            <tr><th className="py-2">运单号</th><th>方式</th><th>状态</th><th>重量</th><th>尺寸 (L×W×H)</th><th>批次</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {waybills.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-500">—</td></tr>}
            {waybills.map((w: any) => (
              <tr key={w.id}>
                <td className="py-2 font-mono text-xs">{w.waybill_no}</td>
                <td className="text-xs">{METHOD_LABEL[w.shipping_method] ?? "—"}</td>
                <td><StatusBadge map={WAYBILL_STATUS_LABEL} color={WAYBILL_STATUS_COLOR} value={w.status}/></td>
                <td className="text-xs">{w.weight_kg ?? "—"} kg</td>
                <td className="text-xs font-mono">{w.length_cm && w.width_cm && w.height_cm ? `${w.length_cm}×${w.width_cm}×${w.height_cm}` : "—"}</td>
                <td className="font-mono text-[10px] text-slate-400">{w.batch_no ?? "—"}</td>
                <td className="text-right"><Link to="/admin/waybills/$waybillId" params={{ waybillId: w.id }} className="text-xs text-brand hover:underline">详情</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="客户上传的文件 / 图片">
        <div className="[&_*]:!text-white [&_.text-ink-soft]:!text-white/70 [&_.border-border]:!border-white/10 [&_.divide-border]:!divide-white/10">
          <OrderAttachments ownerKind="order" ownerId={order.id} lang="zh" />
        </div>
      </Card>

      <Card title="操作记录（内部）">
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {logs.length === 0 && <div className="text-xs text-slate-500">暂无</div>}
          {logs.map((l: any) => (
            <div key={l.id} className="rounded-md border border-white/5 bg-white/[0.02] p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">{l.action}</span>
                <span className="text-slate-500">{fmtDate(l.created_at)}</span>
              </div>
              <div className="text-slate-400">操作人：{l.operator_name ?? l.operator_id}</div>
              {l.note && <div className="text-slate-300">{l.note}</div>}
            </div>
          ))}
        </div>
      </Card>

      {err && <div className="text-xs text-rose-400">{err}</div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{value}</div>
    </div>
  );
}
