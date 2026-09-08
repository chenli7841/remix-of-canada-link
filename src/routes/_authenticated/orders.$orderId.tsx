import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/i18n";
import { OrderAttachments } from "@/components/order-attachments";
import { WaybillsList } from "@/components/waybills-list";
import {
  ArrowLeft,
  Package,
  Plane,
  MapPin,
  Hash,
  Loader2,
  CreditCard,
  Receipt,
  ShieldCheck,
  FileText,
  Paperclip,
  ShoppingCart,
  Boxes,
  Weight,
  Ruler,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orders/$orderId")({
  head: () => ({ meta: [{ title: "订单/运单详情 / Order & Waybill Detail — SinoCargo" }] }),
  component: OrderDetailPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center text-destructive">{error.message}</div>
  ),
  notFoundComponent: () => (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center text-ink-soft">Order not found</div>
  ),
});

const sb = supabase as any;

interface OrderDetail {
  id: string;
  order_no: string;
  status: string;
  created_at: string;
  shipping_method: string;
  tracking_no: string | null;
  subtotal_cny: number;
  shipping_cny: number;
  total_cny: number;
  insurance_cny: number;
  customs_cny: number;
  box_count: number;
  batch_no: string | null;
  eta: string | null;
  address_snapshot: any;
  note: string | null;
  customer_code: string | null;
  destination_code: string | null;
  route_code: string | null;
  company_code: string | null;
  intl_tracking_no: string | null;
  box_no: string | null;
  pallet_no: string | null;
  domestic_tracking_no: string | null;
}
interface OrderItem {
  id: string;
  product_slug: string;
  name_zh: string;
  name_en: string;
  image_url: string | null;
  unit_price_cny: number;
  quantity: number;
  paid?: boolean;
}

function OrderDetailPage() {
  const { orderId } = Route.useParams();
  const { lang, cnyToCad } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<OrderItem[]>([]);
  const [waybills, setWaybills] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);

  const reload = async () => {
    const { data: o } = await sb.from("orders").select("*").eq("id", orderId).maybeSingle();
    const { data: it } = await sb.from("order_items").select("*").eq("order_id", orderId);
    const { data: wb } = await sb.from("waybills").select("*").eq("order_id", orderId).order("created_at");
    setOrder(o ?? null);
    setItems(it ?? []);
    setWaybills(wb ?? []);
    setLoading(false);
  };
  useEffect(() => {
    reload();
  }, [orderId]);

  if (loading)
    return (
      <div className="grid h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-ink-soft" />
      </div>
    );
  if (!order)
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center text-ink-soft">
        {tr("订单不存在", "Order not found")}
      </div>
    );

  const statusLabel = (s: string) =>
    (
      ({
        pending: tr("待支付", "Pending"),
        paid: tr("已支付", "Paid"),
        processing: tr("封箱打包", "Packed"),
        shipped: tr("运输中", "In transit"),
        delivered: tr("已完成", "Completed"),
        cancelled: tr("已取消", "Cancelled"),
      }) as Record<string, string>
    )[s] ?? s;

  const totalBox = items.reduce((acc, i) => acc + i.quantity, 0);
  const addr = order.address_snapshot ?? {};
  const isImg = (s: string | null) => !!s && /^https?:\/\//.test(s);

  const waybillNos = waybills.map((w) => w.waybill_no).filter(Boolean);
  const totalWeight = waybills.reduce((a, w) => a + Number(w.weight_kg ?? 0), 0);
  const totalVolume = waybills.reduce((a, w) => {
    const l = Number(w.length_cm ?? 0),
      wd = Number(w.width_cm ?? 0),
      h = Number(w.height_cm ?? 0);
    return a + (l && wd && h ? (l * wd * h) / 1_000_000 : 0);
  }, 0);
  const shipFee = Number(order.shipping_cny ?? 0);
  const insFee = Number(order.insurance_cny ?? 0);
  const cusFee = Number(order.customs_cny ?? 0);
  const freightTotal = shipFee + insFee + cusFee;

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
        <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
          <ShoppingCart className="h-3 w-3" />
          {tr("商城订单", "Shop order")}
        </span>
        <h1 className="font-display text-2xl font-bold sm:text-3xl">{tr("订单/运单详情", "Order & waybill detail")}</h1>
        <span className="font-mono text-sm text-ink-soft">{order.order_no}</span>
        <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
          {statusLabel(order.status)}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {/* Waybill identifiers */}
          <Card title={tr("运单标识", "Waybill identifiers")} icon={<Hash className="h-4 w-4" />}>
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <Stat label={tr("订单号", "Order No.")} value={<span className="font-mono">{order.order_no}</span>} />
              <Stat
                label={tr("批次号", "Batch No.")}
                value={order.batch_no ? <span className="font-mono">{order.batch_no}</span> : "—"}
              />
              <Stat label={tr("客户号", "Customer")} value={order.customer_code ?? "—"} />
              <Stat label={tr("目的地编号", "Destination")} value={order.destination_code ?? "—"} />
              <Stat label={tr("线路编号", "Route")} value={order.route_code ?? "—"} />
              <Stat label={tr("公司编号", "Company")} value={order.company_code ?? "—"} />
              <Stat
                label={tr("国际运单号", "Intl tracking")}
                value={order.intl_tracking_no ? <span className="font-mono">{order.intl_tracking_no}</span> : "—"}
              />
            </dl>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-ink-soft">
                  {tr("运单号", "Waybill numbers")} ({waybillNos.length || (order.tracking_no ? 1 : 0)})
                </dt>
                <dd className="mt-1 flex flex-wrap gap-1.5">
                  {(waybillNos.length ? waybillNos : order.tracking_no ? [order.tracking_no] : []).map((n) => (
                    <span key={n} className="rounded-full bg-brand/10 px-2 py-0.5 font-mono text-[11px] text-brand">
                      {n}
                    </span>
                  ))}
                  {waybillNos.length === 0 && !order.tracking_no && <span className="text-xs text-ink-soft">—</span>}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wider text-ink-soft">
                  {tr("国内运单号", "Domestic tracking")}
                </dt>
                <dd className="mt-1">
                  {order.domestic_tracking_no ? (
                    <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[11px]">
                      {order.domestic_tracking_no}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-soft">—</span>
                  )}
                </dd>
              </div>
            </div>

            {/* Order-level totals: freight breakdown / weight / volume / boxes */}
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
                  value={totalWeight > 0 ? `${totalWeight.toFixed(2)} kg` : "—"}
                />
                <Stat
                  label={
                    <span className="inline-flex items-center gap-1">
                      <Ruler className="h-3 w-3" />
                      {tr("总体积", "Total volume")}
                    </span>
                  }
                  value={totalVolume > 0 ? `${totalVolume.toFixed(3)} m³` : "—"}
                />
                <Stat
                  label={
                    <span className="inline-flex items-center gap-1">
                      <Receipt className="h-3 w-3" />
                      {tr("订单总运费", "Freight total")}
                    </span>
                  }
                  value={
                    <span className="font-display font-bold text-brand-gradient">
                      CA${cnyToCad(freightTotal).toFixed(2)}
                    </span>
                  }
                />
              </dl>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] text-ink-soft">
                <div className="rounded-lg bg-accent/40 px-2 py-1.5">
                  <span className="inline-flex items-center gap-1">
                    <Plane className="h-3 w-3" />
                    {tr("运费", "Shipping")}
                  </span>
                  <div className="mt-0.5 font-mono text-foreground">CA${cnyToCad(shipFee).toFixed(2)}</div>
                </div>
                <div className="rounded-lg bg-accent/40 px-2 py-1.5">
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {tr("关税", "Customs")}
                  </span>
                  <div className="mt-0.5 font-mono text-foreground">CA${cnyToCad(cusFee).toFixed(2)}</div>
                </div>
                <div className="rounded-lg bg-accent/40 px-2 py-1.5">
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    {tr("保险", "Insurance")}
                  </span>
                  <div className="mt-0.5 font-mono text-foreground">CA${cnyToCad(insFee).toFixed(2)}</div>
                </div>
              </div>
            </div>
          </Card>

          {/* Items — per-item payment */}
          <Card
            title={tr("内件信息（按商品付款）", "Items (pay per item)")}
            icon={<Package className="h-4 w-4" />}
            sub={`${items.length} ${tr("款 · 共", "SKU · ")} ${totalBox} ${tr("件", "unit(s)")}`}
          >
            <ul className="divide-y divide-border">
              {items.map((it) => {
                const itemTotal = Number(it.unit_price_cny) * it.quantity;
                const sel = selected.has(it.id);
                return (
                  <li
                    key={it.id}
                    className={`flex items-center gap-3 py-3 first:pt-0 last:pb-0 ${it.paid ? "opacity-60" : ""}`}
                  >
                    {!it.paid && (
                      <input
                        type="checkbox"
                        checked={sel}
                        onChange={(e) => {
                          const n = new Set(selected);
                          if (e.target.checked) n.add(it.id);
                          else n.delete(it.id);
                          setSelected(n);
                        }}
                        className="h-4 w-4"
                      />
                    )}
                    <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-gradient-to-br from-accent to-surface text-2xl">
                      {isImg(it.image_url) ? (
                        <img src={it.image_url!} alt={it.name_en} className="h-full w-full object-cover" />
                      ) : (
                        <span>{it.image_url || "📦"}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{lang === "zh" ? it.name_zh : it.name_en}</div>
                      <div className="text-xs text-ink-soft">
                        CA${cnyToCad(Number(it.unit_price_cny)).toFixed(2)} × {it.quantity}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-display text-sm font-bold ${it.paid ? "line-through" : ""}`}>
                        CA${cnyToCad(itemTotal).toFixed(2)}
                      </div>
                      {it.paid ? (
                        <span className="text-[10px] font-semibold text-success">{tr("已付款", "Paid")}</span>
                      ) : (
                        <span className="text-[10px] font-semibold text-warning">{tr("待付款", "Unpaid")}</span>
                      )}
                    </div>
                  </li>
                );
              })}
              {items.length === 0 && (
                <li className="py-6 text-center text-sm text-ink-soft">{tr("无商品", "No items")}</li>
              )}
            </ul>
            {items.some((it) => !it.paid) && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <button
                  onClick={() => {
                    const allUnpaid = items.filter((it) => !it.paid).map((it) => it.id);
                    setSelected(new Set(allUnpaid));
                  }}
                  className="text-xs text-brand hover:underline"
                >
                  {tr("全选未付", "Select all unpaid")}
                </button>
                <button onClick={() => setSelected(new Set())} className="text-xs text-ink-soft hover:underline">
                  {tr("清空", "Clear")}
                </button>
                <div className="ml-auto text-xs text-ink-soft">
                  {tr("已选", "Selected")}: {selected.size} · CA$
                  {cnyToCad(
                    items
                      .filter((it) => selected.has(it.id))
                      .reduce((s, it) => s + Number(it.unit_price_cny) * it.quantity, 0),
                  ).toFixed(2)}
                </div>
                <button
                  disabled={paying || selected.size === 0}
                  onClick={async () => {
                    setPaying(true);
                    const { data, error } = await sb.rpc("pay_order_items", { _item_ids: Array.from(selected) });
                    setPaying(false);
                    if (error) return toast.error(error.message);
                    if (!data?.ok) {
                      if (data?.reason === "insufficient")
                        return toast.error(
                          tr(`钱包余额不足，需 CA$${data.need_cad}`, `Insufficient balance, need CA$${data.need_cad}`),
                        );
                      return toast.error(data?.reason ?? "failed");
                    }
                    toast.success(tr(`已扣款 CA$${data.paid_cad}`, `Paid CA$${data.paid_cad}`));
                    setSelected(new Set());
                    reload();
                  }}
                  className="inline-flex items-center gap-2 rounded-full bg-cta-gradient px-5 py-2 text-xs font-semibold text-cta-foreground shadow-elevated disabled:opacity-50"
                >
                  {paying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CreditCard className="h-3.5 w-3.5" />}
                  {tr("钱包付选中", "Pay selected (Wallet)")}
                </button>
              </div>
            )}
          </Card>

          {/* Per-waybill cards with batch + dims + status + tracking dropdown */}
          <Card title={tr("运单（含批次/轨迹）", "Waybills (batch & tracking)")} icon={<Boxes className="h-4 w-4" />}>
            <WaybillsList ownerKind="order" ownerId={order.id} lang={lang} />
          </Card>

          {/* Attachments */}
          <Card title={tr("附件 / 单据", "Attachments")} icon={<Paperclip className="h-4 w-4" />}>
            <OrderAttachments ownerKind="order" ownerId={order.id} lang={lang} />
          </Card>
        </div>

        {/* Side: cost breakdown + address */}
        <aside className="space-y-6">
          <Card title={tr("费用明细", "Cost breakdown")} icon={<Receipt className="h-4 w-4" />}>
            <dl className="space-y-2 text-sm">
              <Row label={tr("商品小计", "Subtotal")} value={`CA$${cnyToCad(Number(order.subtotal_cny)).toFixed(2)}`} />
              <Row
                label={
                  <span className="inline-flex items-center gap-1">
                    <Plane className="h-3 w-3" />
                    {tr("国际运费", "Shipping")}
                  </span>
                }
                value={`CA$${cnyToCad(Number(order.shipping_cny)).toFixed(2)}`}
              />
              <Row
                label={
                  <span className="inline-flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3" />
                    {tr("保险", "Insurance")}
                  </span>
                }
                value={`CA$${cnyToCad(Number(order.insurance_cny)).toFixed(2)}`}
              />
              <Row
                label={
                  <span className="inline-flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    {tr("关税", "Customs/Duty")}
                  </span>
                }
                value={`CA$${cnyToCad(Number(order.customs_cny)).toFixed(2)}`}
              />
              <div className="my-2 border-t border-border" />
              <Row
                label={<span className="text-base font-semibold">{tr("合计", "Total")}</span>}
                value={
                  <span className="font-display text-lg font-bold text-brand-gradient">
                    CA${cnyToCad(Number(order.total_cny)).toFixed(2)}
                  </span>
                }
              />
              <div className="pt-1 text-right text-[11px] text-ink-soft">
                {tr("付款状态", "Payment")}:{" "}
                {(() => {
                  const ps = (order as any).payment_status;
                  if (ps === "paid") return <span className="text-success font-semibold">{tr("已付款", "Paid")}</span>;
                  if (ps === "partial")
                    return <span className="text-amber-500 font-semibold">{tr("部分付款", "Partial")}</span>;
                  return <span className="text-warning font-semibold">{tr("待付款", "Unpaid")}</span>;
                })()}
              </div>
            </dl>
          </Card>

          {addr && (addr.recipient || addr.line1) && (
            <Card title={tr("收货地址", "Shipping address")} icon={<MapPin className="h-4 w-4" />}>
              <div className="text-sm">
                <div className="font-semibold">{addr.recipient}</div>
                <div className="text-ink-soft">{addr.phone}</div>
                <div className="mt-2">
                  {addr.line1}
                  {addr.line2 ? `, ${addr.line2}` : ""}
                </div>
                <div className="text-ink-soft">
                  {addr.city}, {addr.province} {addr.postal_code} · {addr.country}
                </div>
              </div>
            </Card>
          )}

          {order.note && (
            <Card title={tr("订单备注", "Note")} icon={<FileText className="h-4 w-4" />}>
              <p className="text-sm text-ink-soft">{order.note}</p>
            </Card>
          )}
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
