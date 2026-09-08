import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { useCart, cartLineKey, type CartLine } from "@/lib/cart";
import { useApp } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { listPublicRoutes } from "@/lib/shop-public.functions";
import { toast } from "sonner";
import { Plane, Ship, Truck, MapPin, Loader2, CheckCircle2, Route as RouteIcon, Tag, X, Clock } from "lucide-react";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/checkout")({
  head: () => ({ meta: [{ title: "结账 / Checkout — SinoCargo" }] }),
  validateSearch: z.object({ slugs: z.string().optional() }),
  component: CheckoutPage,
});

interface Address {
  id: string;
  recipient: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  is_default: boolean;
}
interface RouteRow {
  id: string;
  code: string;
  name_zh: string;
  name_en: string | null;
  shipping_method: string;
  destination_code: string | null;
  transit_days_min: number | null;
  transit_days_max: number | null;
}

const sb = supabase as any;

// Empty/undefined availableRouteCodes means the product isn't restricted — any active route works.
function allowedCodes(i: CartLine, allCodes: string[]): string[] {
  // Prefer the routes configured for THIS line's purchase mode (personal vs business),
  // so a personal item never offers business-only routes and vice versa.
  const modeCodes = i.purchaseType === "business" ? i.businessRouteCodes : i.personalRouteCodes;
  if (modeCodes && modeCodes.length > 0) return modeCodes;
  return i.availableRouteCodes && i.availableRouteCodes.length > 0 ? i.availableRouteCodes : allCodes;
}

function CheckoutPage() {
  const search = Route.useSearch();
  const { items: allItems, selectedItems, clearSlugs } = useCart();
  const { lang, formatPrice, cnyToCad } = useApp();
  const navigate = useNavigate();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);

  // Filter by search.slugs if present (actually cart line keys — see cartLineKey — kept the
  // "slugs" search-param name for URL stability), otherwise selected items.
  const items = useMemo(() => {
    if (search.slugs) {
      const set = new Set(search.slugs.split(","));
      return allItems.filter((i) => set.has(cartLineKey(i)));
    }
    return selectedItems.length > 0 ? selectedItems : allItems;
  }, [search.slugs, allItems, selectedItems]);

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addrId, setAddrId] = useState<string>("");
  const [routes, setRoutes] = useState<RouteRow[] | null>(null);
  const [routeCode, setRouteCode] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<any>(null);
  const [quoting, setQuoting] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [couponMsg, setCouponMsg] = useState<string>("");

  useEffect(() => {
    sb.from("addresses")
      .select("*")
      .order("is_default", { ascending: false })
      .then(({ data }: any) => {
        const list = (data as any[]) ?? [];
        setAddresses(list);
        const def = list.find((a) => a.is_default) ?? list[0];
        if (def) setAddrId(def.id);
      });
  }, []);

  const fetchRoutes = useServerFn(listPublicRoutes);
  useEffect(() => {
    fetchRoutes().then((r: any) => setRoutes(r.items ?? []));
  }, []);

  // Every selected item is guaranteed (by the cart page) to share at least one route — the
  // whole point of picking a shared route up front is that ALL lines resolve to the SAME
  // route_code, so the backend can pool their weight/volume into one chargeable-weight calc
  // instead of billing each line separately.
  const allCodes = useMemo(() => (routes ?? []).map((r) => r.code), [routes]);
  const commonRoutes = useMemo(() => {
    if (!routes || items.length === 0) return [];
    const codes =
      items.reduce<string[] | null>((acc, i) => {
        const mine = allowedCodes(i, allCodes);
        return acc === null ? mine : acc.filter((c) => mine.includes(c));
      }, null) ?? [];
    return routes.filter((r) => codes.includes(r.code));
  }, [items, routes, allCodes]);

  useEffect(() => {
    if (commonRoutes.length > 0 && !commonRoutes.some((r) => r.code === routeCode)) {
      setRouteCode(commonRoutes[0].code);
    }
  }, [commonRoutes, routeCode]);

  const selectedRoute = commonRoutes.find((r) => r.code === routeCode) ?? null;

  // Live quote — an explicit route_code makes every line resolve to the SAME route, so the
  // backend pools them into one freight calculation instead of resolving a route per product.
  useEffect(() => {
    if (items.length === 0 || !routeCode) {
      setQuote(null);
      return;
    }
    setQuoting(true);
    sb.rpc("quote_shop_order", {
      _payload: {
        route_code: routeCode,
        shipping_method: selectedRoute?.shipping_method,
        items: items.map((i) => ({
          slug: i.slug,
          quantity: i.quantity,
          mode: i.purchaseType,
          variant_id: i.variantId,
        })),
        coupon_code: couponCode || undefined,
      },
    })
      .then(({ data, error }: any) => {
        if (error || !data?.ok) {
          setQuote(null);
          const reason = data?.reason;
          if (reason === "no_route_for_product") {
            toast.error(
              tr(
                `商品 ${data.slug} 未配置 ${data.mode}/${data.method} 线路`,
                `Product ${data.slug} missing ${data.mode}/${data.method} route`,
              ),
            );
          } else if (reason === "below_moq") {
            toast.error(tr(`${data.slug} 未达起订量 ${data.moq}`, `${data.slug} below MOQ ${data.moq}`));
          } else if (reason) {
            toast.error(tr(`报价失败: ${reason}`, `Quote failed: ${reason}`));
          }
        } else {
          setQuote(data);
        }
      })
      .finally(() => setQuoting(false));
  }, [routeCode, couponCode, items.map((i) => `${cartLineKey(i)}:${i.quantity}:${i.purchaseType}`).join(",")]);

  const subtotal = quote?.subtotal_cny ?? items.reduce((s, i) => s + i.priceCNY * i.quantity, 0);
  const freight = quote?.freight_cny ?? 0;
  const customs = quote?.customs_cny ?? 0;
  const insurance = quote?.insurance_cny ?? 0;
  const discount = Number(quote?.discount_cny ?? 0);
  const total = quote?.total_cny ?? subtotal;

  const applyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    const { data } = await sb.rpc("validate_coupon", { _code: code, _subtotal_cny: subtotal });
    if (data?.ok) {
      setCouponCode(code);
      setCouponMsg(
        tr(`已应用：-${formatPrice(Number(data.discount_cny))}`, `Applied: -${formatPrice(Number(data.discount_cny))}`),
      );
    } else {
      setCouponCode("");
      const reasonMap: Record<string, [string, string]> = {
        not_found: ["优惠码不存在", "Code not found"],
        inactive: ["优惠码已停用", "Coupon inactive"],
        not_started: ["活动尚未开始", "Not started yet"],
        expired: ["优惠码已过期", "Coupon expired"],
        limit_reached: ["使用次数已用完", "Usage limit reached"],
        min_order: [
          `未达最低消费 ${formatPrice(Number(data?.min_order_cny ?? 0))}`,
          `Below min order ${formatPrice(Number(data?.min_order_cny ?? 0))}`,
        ],
      };
      const m = reasonMap[data?.reason] ?? ["无效", "Invalid"];
      setCouponMsg(tr(m[0], m[1]));
    }
  };
  const clearCoupon = () => {
    setCouponCode("");
    setCouponInput("");
    setCouponMsg("");
  };

  const placeOrder = async () => {
    if (items.length === 0) return;
    if (!addrId) return toast.error(tr("请先选择收货地址", "Choose a shipping address first"));
    if (!routeCode) return toast.error(tr("请先选择运输线路", "Choose a shipping route first"));
    setBusy(true);
    try {
      const addr = addresses.find((a) => a.id === addrId);
      const payload: any = {
        route_code: routeCode,
        shipping_method: selectedRoute?.shipping_method,
        address_snapshot: addr,
        items: items.map((i) => ({
          slug: i.slug,
          quantity: i.quantity,
          mode: i.purchaseType,
          variant_id: i.variantId,
        })),
        note: note || null,
      };
      if (couponCode) payload.coupon_code = couponCode;
      const { data, error } = await sb.rpc("place_shop_order", { _payload: payload });
      if (error) throw error;
      if (!data?.ok) {
        if (data?.reason === "insufficient") {
          toast.error(
            tr(
              `账户余额不足（需 CA$${Number(data.need_cad).toFixed(2)}，当前 CA$${Number(data.balance_cad).toFixed(2)}），请先充值`,
              `Insufficient balance (need CA$${Number(data.need_cad).toFixed(2)}, have CA$${Number(data.balance_cad).toFixed(2)}) — please top up`,
            ),
            {
              action: {
                label: tr("去充值", "Top up"),
                onClick: () => navigate({ to: "/account", search: { tab: "wallet" } }),
              },
            },
          );
          setBusy(false);
          return;
        }
        throw new Error(data?.reason ?? "下单失败");
      }
      clearSlugs(items.map(cartLineKey));
      const pointsMsg =
        data.points_earned > 0 ? tr(`，获得 ${data.points_earned} 积分`, `, earned ${data.points_earned} points`) : "";
      toast.success(
        tr(
          `已生成 ${data.orders_count} 个订单，账单 ${data.invoice_no}${pointsMsg}`,
          `${data.orders_count} order(s) created, invoice ${data.invoice_no}${pointsMsg}`,
        ),
      );
      navigate({ to: "/invoices" });
    } catch (err: any) {
      toast.error(err.message ?? tr("下单失败", "Failed to place order"));
    } finally {
      setBusy(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <h1 className="font-display text-2xl font-bold">{tr("没有要结算的商品", "Nothing to checkout")}</h1>
        <Link to="/cart" className="mt-4 inline-block text-brand hover:underline">
          {tr("← 返回购物车", "← Back to cart")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      <h1 className="mb-8 font-display text-3xl font-bold sm:text-4xl">{tr("结账", "Checkout")}</h1>

      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold">
              <MapPin className="h-5 w-5 text-brand" />
              {tr("收货地址", "Shipping address")}
            </h2>
            {addresses.length === 0 ? (
              <Link
                to="/account"
                search={{ tab: "addresses" }}
                className="inline-flex items-center gap-2 rounded-full border border-dashed border-border px-4 py-3 text-sm text-ink-soft hover:border-brand"
              >
                {tr("还没有地址，先去添加 →", "No address yet — add one →")}
              </Link>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {addresses.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAddrId(a.id)}
                    className={`relative rounded-xl border p-4 text-left transition ${addrId === a.id ? "border-brand bg-brand/5" : "border-border hover:border-brand/40"}`}
                  >
                    {addrId === a.id && <CheckCircle2 className="absolute right-3 top-3 h-5 w-5 text-brand" />}
                    <div className="font-semibold">
                      {a.recipient} · {a.phone}
                    </div>
                    <div className="mt-1 text-sm">
                      {a.line1}
                      {a.line2 ? `, ${a.line2}` : ""}
                    </div>
                    <div className="text-sm text-ink-soft">
                      {a.city}, {a.province} {a.postal_code}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold">
              <RouteIcon className="h-5 w-5 text-brand" />
              {tr("运输线路", "Shipping route")}
            </h2>
            {routes === null ? (
              <p className="text-sm text-ink-soft">{tr("加载线路中…", "Loading routes…")}</p>
            ) : commonRoutes.length === 0 ? (
              <p className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {tr(
                  "所选商品没有共同可用的线路，无法一起结算，请返回购物车分开结算",
                  "Selected items don't share a common route — go back to cart and check out separately",
                )}
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {commonRoutes.map((r) => {
                  const Icon = r.shipping_method === "sea" ? Ship : r.shipping_method === "truck" ? Truck : Plane;
                  const active = routeCode === r.code;
                  return (
                    <button
                      key={r.code}
                      onClick={() => setRouteCode(r.code)}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${active ? "border-brand bg-brand/5" : "border-border hover:border-brand/40"}`}
                    >
                      <span
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${active ? "bg-brand text-brand-foreground" : "bg-accent text-ink-soft"}`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="flex-1">
                        <div className="font-semibold">{lang === "zh" ? r.name_zh : (r.name_en ?? r.name_zh)}</div>
                        {(r.transit_days_min || r.transit_days_max) && (
                          <div className="flex items-center gap-1 text-xs text-ink-soft">
                            <Clock className="h-3 w-3" />
                            {r.transit_days_min}-{r.transit_days_max} {tr("天", "days")}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {quote?.lines?.length > 0 && (
            <section className="rounded-2xl border border-border bg-surface p-6">
              <h2 className="mb-4 font-display text-lg font-bold">{tr("运费明细", "Freight breakdown")}</h2>
              <div className="space-y-5">
                {groupLinesByRoute(quote.lines).map((g) => {
                  const modes = Array.from(new Set(g.lines.map((l: any) => l.mode)));
                  const modeLabel = modes
                    .map((m) => (m === "business" ? tr("商业采购", "Business") : tr("个人采购", "Personal")))
                    .join(" / ");
                  return (
                    <div key={g.route_code} className="rounded-xl border border-border">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-accent/40 px-4 py-2.5">
                        <div className="flex items-center gap-2 text-sm">
                          <RouteIcon className="h-4 w-4 text-brand" />
                          <span className="font-mono font-semibold">{g.route_code}</span>
                          <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                            {modeLabel}
                          </span>
                          <span className="text-xs text-ink-soft">
                            · {g.lines.length} {tr("件商品", "items")}
                          </span>
                        </div>
                        <div className="text-xs text-ink-soft">
                          {tr("线路小计", "Route subtotal")}：
                          <span className="ml-1 font-semibold text-foreground">{formatPrice(g.subtotal)}</span>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs text-ink-soft">
                            <tr>
                              <th className="px-4 py-2">{tr("商品", "Item")}</th>
                              <th className="py-2">{tr("箱数", "Cartons")}</th>
                              <th className="py-2">{tr("计费重", "Chargeable")}</th>
                              <th className="py-2">{tr("运费", "Freight")}</th>
                              <th className="py-2">{tr("关税", "Duty")}</th>
                              <th className="px-4 py-2 text-right">{tr("保险", "Insurance")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {g.lines.map((l: any) => {
                              const it = items.find(
                                (x) => x.slug === l.slug && (x.variantId ?? null) === (l.variant_id ?? null),
                              );
                              return (
                                <tr key={`${l.slug}::${l.variant_id ?? ""}`} className="border-t border-border">
                                  <td className="px-4 py-1.5">
                                    <div className="line-clamp-1">
                                      {it ? (lang === "zh" ? it.nameZh : it.nameEn) : l.slug}
                                      {it?.variantLabel && (
                                        <span className="ml-1 text-[10px] text-ink-soft">({it.variantLabel})</span>
                                      )}
                                    </div>
                                    <div className="text-[10px] text-ink-soft">
                                      {l.mode === "business" ? tr("商业", "Business") : tr("个人", "Personal")}
                                    </div>
                                  </td>
                                  <td>{Number(l.units ?? 0)}</td>
                                  <td>{Number(l.chargeable_kg ?? 0).toFixed(2)} kg</td>
                                  <td>{formatPrice(l.freight_cny)}</td>
                                  <td>{formatPrice(l.customs_cny)}</td>
                                  <td className="px-4 text-right">{formatPrice(l.insurance_cny)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot className="text-xs">
                            <tr className="border-t border-border bg-accent/20">
                              <td className="px-4 py-2 font-semibold" colSpan={3}>
                                {tr("线路合计", "Route total")}
                              </td>
                              <td className="py-2 font-semibold">{formatPrice(g.freight)}</td>
                              <td className="py-2 font-semibold">{formatPrice(g.customs)}</td>
                              <td className="px-4 py-2 text-right font-semibold">{formatPrice(g.insurance)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>
              {!quote.has_freight_rule && (
                <p className="mt-3 text-xs text-amber-500">
                  {tr("部分线路未配置运费规则，运费按 0 计算", "Some routes have no freight rule; freight = 0")}
                </p>
              )}
            </section>
          )}

          <section className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold">
              <Tag className="h-5 w-5 text-brand" />
              {tr("优惠码", "Coupon")}
            </h2>
            {couponCode ? (
              <div className="flex items-center gap-3 rounded-xl border border-brand/40 bg-brand/5 p-3">
                <Tag className="h-4 w-4 text-brand" />
                <span className="font-mono text-sm font-semibold">{couponCode}</span>
                <span className="text-xs text-success">{couponMsg}</span>
                <button
                  onClick={clearCoupon}
                  className="ml-auto grid h-6 w-6 place-items-center rounded-full hover:bg-accent"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder={tr("输入优惠码", "Enter coupon code")}
                  className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm font-mono uppercase outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
                />
                <button
                  onClick={applyCoupon}
                  disabled={!couponInput.trim()}
                  className="rounded-xl border border-border bg-foreground px-4 py-2 text-sm font-semibold text-background hover:bg-foreground/90 disabled:opacity-40"
                >
                  {tr("应用", "Apply")}
                </button>
              </div>
            )}
            {!couponCode && couponMsg && <p className="mt-2 text-xs text-destructive">{couponMsg}</p>}
          </section>

          <section className="rounded-2xl border border-border bg-surface p-6">
            <h2 className="mb-4 font-display text-lg font-bold">{tr("备注", "Order note")}</h2>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={tr("特殊要求、合箱备注等（可选）", "Special instructions (optional)")}
              className="w-full resize-none rounded-xl border border-border bg-background p-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
            />
          </section>
        </div>

        <aside className="h-fit rounded-2xl border border-border bg-surface p-6 lg:sticky lg:top-24">
          <h2 className="mb-4 font-display text-lg font-bold">{tr("订单摘要", "Order summary")}</h2>
          <div className="mb-4 max-h-48 space-y-2 overflow-y-auto text-sm">
            {items.map((i) => (
              <div key={cartLineKey(i)} className="flex justify-between gap-3">
                <span className="line-clamp-1">
                  {lang === "zh" ? i.nameZh : i.nameEn}
                  {i.variantLabel && <span className="text-ink-soft"> ({i.variantLabel})</span>} × {i.quantity}
                </span>
                <span className="shrink-0 font-medium">{formatPrice(i.priceCNY * i.quantity)}</span>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t border-border pt-4 text-sm">
            <Row label={tr("商品小计", "Items subtotal")} value={formatPrice(subtotal)} />
            {quote?.lines?.length > 0 && (
              <div className="rounded-lg bg-accent/30 p-2.5 space-y-1.5">
                <div className="text-[11px] font-semibold text-ink-soft">{tr("按线路小计", "By route")}</div>
                {groupLinesByRoute(quote.lines).map((g) => (
                  <div key={g.route_code} className="text-xs">
                    <div className="flex justify-between font-mono">
                      <span className="text-foreground">{g.route_code}</span>
                      <span className="font-semibold">{formatPrice(g.freight + g.customs + g.insurance)}</span>
                    </div>
                    <div className="flex justify-between text-ink-soft">
                      <span>{tr("运/税/险", "Frt/Duty/Ins")}</span>
                      <span>
                        {formatPrice(g.freight)} / {formatPrice(g.customs)} / {formatPrice(g.insurance)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Row label={tr("运费合计", "Shipping")} value={quoting ? "…" : formatPrice(freight)} />
            <Row label={tr("关税合计", "Duty")} value={quoting ? "…" : formatPrice(customs)} />
            <Row label={tr("保险合计", "Insurance")} value={quoting ? "…" : formatPrice(insurance)} />
            {discount > 0 && (
              <Row
                label={
                  (
                    <span className="text-success">
                      {tr("优惠", "Discount")} ({couponCode})
                    </span>
                  ) as any
                }
                value={(<span className="text-success">-{formatPrice(discount)}</span>) as any}
              />
            )}
            <Row
              label={tr("线路", "Route")}
              value={
                selectedRoute
                  ? lang === "zh"
                    ? selectedRoute.name_zh
                    : (selectedRoute.name_en ?? selectedRoute.name_zh)
                  : "—"
              }
              muted
            />
          </div>
          <div className="my-4 h-px bg-border" />
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">{tr("合计", "Total")}</span>
            <div className="text-right">
              <div className="font-display text-2xl font-bold text-brand-gradient">{formatPrice(total)}</div>
              <div className="text-xs text-ink-soft">≈ CA${cnyToCad(total).toFixed(2)}</div>
            </div>
          </div>
          <button
            onClick={placeOrder}
            disabled={busy || !addrId || !routeCode || quoting || !quote?.ok}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-full bg-cta-gradient px-6 py-3.5 text-sm font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {tr("提交订单并付款", "Place order & pay")}
          </button>
          <p className="mt-3 text-center text-[11px] text-ink-soft">
            {tr("提交后从账户余额扣款并生成账单", "Submit deducts wallet balance and creates an invoice")}
          </p>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: React.ReactNode; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-ink-soft" : ""}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

interface RouteGroup {
  route_code: string;
  lines: any[];
  subtotal: number;
  freight: number;
  customs: number;
  insurance: number;
}

function groupLinesByRoute(lines: any[]): RouteGroup[] {
  const map = new Map<string, RouteGroup>();
  for (const l of lines) {
    const code = l.route_code ?? "—";
    let g = map.get(code);
    if (!g) {
      g = { route_code: code, lines: [], subtotal: 0, freight: 0, customs: 0, insurance: 0 };
      map.set(code, g);
    }
    g.lines.push(l);
    g.subtotal += Number(l.subtotal_cny ?? 0);
    g.freight += Number(l.freight_cny ?? 0);
    g.customs += Number(l.customs_cny ?? 0);
    g.insurance += Number(l.insurance_cny ?? 0);
  }
  return Array.from(map.values());
}
