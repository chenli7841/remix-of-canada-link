import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/lib/i18n";
import { CreditCard, Loader2, Wallet, ArrowLeft, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pay/$orderId")({
  head: () => ({ meta: [{ title: "付款 / Pay — SinoCargo" }] }),
  component: PayPage,
});

const sb = supabase as any;

function PayPage() {
  const { orderId } = Route.useParams();
  const { lang, formatPrice, cnyToCad } = useApp();
  const navigate = useNavigate();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);

  const [order, setOrder] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [bal, setBal] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: o }, { data: oi }, { data: w }] = await Promise.all([
      sb.from("orders").select("*").eq("id", orderId).maybeSingle(),
      sb.from("order_items").select("id,name_zh,quantity,unit_price_cny,paid").eq("order_id", orderId),
      sb.from("wallets").select("balance_cad").maybeSingle(),
    ]);
    setOrder(o);
    setItems(oi ?? []);
    setBal(Number(w?.balance_cad ?? 0));
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, [orderId]);

  const unpaidIds = items.filter((i) => !i.paid).map((i) => i.id);
  const needCny = order ? Number(order.total_cny ?? 0) : 0;
  const needCad = +cnyToCad(needCny).toFixed(2);
  const enough = bal >= needCad;
  const allPaid = order?.payment_status === "paid" || unpaidIds.length === 0;

  const payAll = async () => {
    if (unpaidIds.length === 0) return;
    setPaying(true);
    try {
      const { data, error } = await sb.rpc("pay_order_items", { _item_ids: unpaidIds });
      if (error) throw error;
      if (!data?.ok) {
        if (data?.reason === "insufficient") {
          toast.error(tr(`余额不足，需 CA$${data.need_cad}`, `Insufficient balance, need CA$${data.need_cad}`));
        } else {
          toast.error(data?.reason ?? "Pay failed");
        }
        return;
      }
      toast.success(tr("付款成功", "Payment successful"));
      navigate({ to: "/orders/$orderId", params: { orderId } });
    } catch (e: any) {
      toast.error(e.message ?? "error");
    } finally {
      setPaying(false);
    }
  };

  if (loading)
    return (
      <div className="grid h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-ink-soft" />
      </div>
    );
  if (!order) return <div className="mx-auto max-w-2xl py-20 text-center">{tr("订单不存在", "Order not found")}</div>;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
      <Link
        to="/account"
        search={{ tab: "myOrders" }}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        {tr("我的订单", "My orders")}
      </Link>
      <h1 className="mb-2 font-display text-3xl font-bold">{tr("订单付款", "Pay order")}</h1>
      <div className="mb-8 text-sm text-ink-soft">#{order.order_no}</div>

      {allPaid && (
        <div className="mb-6 flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-700">
          <CheckCircle2 className="h-5 w-5" />
          <div>
            <div className="font-semibold">{tr("订单已付清", "Order fully paid")}</div>
            <Link to="/orders/$orderId" params={{ orderId }} className="text-sm underline">
              {tr("查看订单详情", "View order details")}
            </Link>
          </div>
        </div>
      )}

      <section className="mb-6 rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-3 font-display text-lg font-bold">{tr("商品", "Items")}</h2>
        <div className="space-y-2 text-sm">
          {items.map((it) => (
            <div key={it.id} className="flex justify-between gap-3">
              <span className="line-clamp-1">
                {it.name_zh} × {it.quantity}
              </span>
              <div className="text-right">
                <div>{formatPrice(it.unit_price_cny * it.quantity)}</div>
                {it.paid && <div className="text-[10px] text-emerald-600">✓ {tr("已付", "paid")}</div>}
              </div>
            </div>
          ))}
        </div>
        <div className="my-4 h-px bg-border" />
        <div className="space-y-1 text-sm">
          <Row label={tr("商品小计", "Subtotal")} value={formatPrice(order.subtotal_cny)} />
          <Row label={tr("运费/关税/保险", "Shipping & duty")} value={formatPrice(order.shipping_cny)} />
          <div className="flex items-baseline justify-between pt-2">
            <span className="font-semibold">{tr("应付", "Total due")}</span>
            <div className="text-right">
              <div className="font-display text-2xl font-bold text-brand-gradient">{formatPrice(needCny)}</div>
              <div className="text-xs text-ink-soft">≈ CA${needCad.toFixed(2)}</div>
            </div>
          </div>
        </div>
      </section>

      {!allPaid && (
        <section className="rounded-2xl border border-border bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold flex items-center gap-2">
              <Wallet className="h-5 w-5 text-brand" />
              {tr("钱包余额", "Wallet")}
            </h2>
            <div className="text-right">
              <div className="text-2xl font-bold">CA${bal.toFixed(2)}</div>
              {!enough && (
                <Link to="/account" search={{ tab: "wallet" }} className="text-xs text-brand hover:underline">
                  {tr("去充值", "Top up")}
                </Link>
              )}
            </div>
          </div>
          <button
            onClick={payAll}
            disabled={paying || !enough}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-cta-gradient px-6 py-3.5 text-sm font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-50"
          >
            {paying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            {tr(`钱包支付 CA$${needCad.toFixed(2)}`, `Pay CA$${needCad.toFixed(2)} with wallet`)}
          </button>
          {!enough && (
            <p className="mt-3 text-center text-xs text-amber-600">
              {tr("余额不足，请先充值", "Insufficient balance — please top up")}
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm text-ink-soft">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
