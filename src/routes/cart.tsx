import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { useCart, cartLineKey, type CartLine } from "@/lib/cart";
import { useApp } from "@/lib/i18n";
import { listPublicRoutes } from "@/lib/shop-public.functions";
import {
  Trash2,
  Minus,
  Plus,
  ShoppingBag,
  ArrowRight,
  CheckSquare,
  Square,
  Route as RouteIcon,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/cart")({
  head: () => ({ meta: [{ title: "购物车 / Cart — SinoCargo" }] }),
  component: CartPage,
});

interface RouteInfo {
  code: string;
  name_zh: string;
  name_en: string | null;
  shipping_method: string;
}

// Empty/undefined availableRouteCodes means the product isn't restricted — any active route works.
function allowedCodes(i: CartLine, allCodes: string[]): string[] {
  // Prefer the routes configured for THIS line's purchase mode (personal vs business),
  // so a personal item never offers business-only routes and vice versa.
  const modeCodes = i.purchaseType === "business" ? i.businessRouteCodes : i.personalRouteCodes;
  if (modeCodes && modeCodes.length > 0) return modeCodes;
  return i.availableRouteCodes && i.availableRouteCodes.length > 0 ? i.availableRouteCodes : allCodes;
}

function CartPage() {
  const c = useCart();
  const {
    items,
    update,
    remove,
    isSelected,
    toggleSelect,
    setAllSelected,
    selectedItems,
    selectedCount,
    selectedSubtotalCNY,
    selectedWeightKg,
  } = c;
  const { lang, formatPrice } = useApp();
  const navigate = useNavigate();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);

  const fetchRoutes = useServerFn(listPublicRoutes);
  const [routes, setRoutes] = useState<RouteInfo[] | null>(null);
  useEffect(() => {
    fetchRoutes().then((r: any) => setRoutes(r.items ?? []));
  }, []);

  const allCodes = useMemo(() => (routes ?? []).map((r) => r.code), [routes]);
  const routeLabel = (code: string) => {
    const r = routes?.find((x) => x.code === code);
    if (!r) return code;
    return lang === "zh" ? r.name_zh : (r.name_en ?? r.name_zh);
  };

  // Routes common to every SELECTED item — checkout is only possible when this is non-empty.
  const commonRoutes = useMemo(() => {
    if (!routes || selectedItems.length === 0) return null;
    return (
      selectedItems.reduce<string[] | null>((acc, i) => {
        const mine = allowedCodes(i, allCodes);
        return acc === null ? mine : acc.filter((c) => mine.includes(c));
      }, null) ?? []
    );
  }, [selectedItems, routes, allCodes]);
  const hasRouteConflict = routes !== null && selectedItems.length > 1 && (commonRoutes?.length ?? 0) === 0;

  const allSel = items.length > 0 && selectedItems.length === items.length;

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <ShoppingBag className="mx-auto h-14 w-14 text-ink-soft" />
        <h1 className="mt-6 font-display text-3xl font-bold">{tr("购物车是空的", "Your cart is empty")}</h1>
        <p className="mt-2 text-ink-soft">{tr("快去挑几件好物吧", "Discover something you'll love")}</p>
        <Link
          to="/products"
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-cta-gradient px-6 py-3 text-sm font-semibold text-cta-foreground shadow-elevated"
        >
          {tr("去购物", "Browse products")}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    );
  }

  const goCheckout = () => {
    if (selectedItems.length === 0 || hasRouteConflict) return;
    const slugs = selectedItems.map(cartLineKey).join(",");
    navigate({ to: "/checkout", search: { slugs } as any });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{tr("购物车", "Shopping cart")}</h1>
        <button
          onClick={() => setAllSelected(!allSel)}
          className="inline-flex items-center gap-2 text-sm text-ink-soft hover:text-foreground"
        >
          {allSel ? <CheckSquare className="h-4 w-4 text-brand" /> : <Square className="h-4 w-4" />}
          {tr("全选", "Select all")}
        </button>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {items.map((i) => {
            const sel = isSelected(i.slug, i.variantId);
            const codes = allowedCodes(i, allCodes);
            const restricted = !!(i.availableRouteCodes && i.availableRouteCodes.length > 0);
            const conflicting = sel && hasRouteConflict;
            return (
              <div
                key={cartLineKey(i)}
                className={`flex gap-3 rounded-2xl border bg-surface p-4 transition ${conflicting ? "border-destructive/50" : sel ? "border-brand/40" : "border-border"}`}
              >
                <button onClick={() => toggleSelect(i.slug, i.variantId)} className="shrink-0 self-center">
                  {sel ? <CheckSquare className="h-5 w-5 text-brand" /> : <Square className="h-5 w-5 text-ink-soft" />}
                </button>
                <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-accent to-surface text-4xl">
                  {/^https?:\/\//.test(i.image) ? (
                    <img src={i.image} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span>{i.image}</span>
                  )}
                </div>
                <div className="flex flex-1 flex-col">
                  <div className="flex items-start justify-between gap-3">
                    <Link
                      to="/products/$slug"
                      params={{ slug: i.slug }}
                      className="line-clamp-2 text-sm font-semibold hover:text-brand"
                    >
                      {lang === "zh" ? i.nameZh : i.nameEn}
                      {i.variantLabel && <span className="text-ink-soft"> ({i.variantLabel})</span>}
                    </Link>
                    <button
                      onClick={() => remove(i.slug, i.variantId)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-1 text-xs text-ink-soft">
                    {i.weightKg}kg · {i.purchaseType === "business" ? tr("商业", "Business") : tr("个人", "Personal")}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <RouteIcon className="h-3 w-3 text-ink-soft" />
                    {restricted ? (
                      codes.map((c) => (
                        <span
                          key={c}
                          className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-ink-soft"
                        >
                          {routeLabel(c)}
                        </span>
                      ))
                    ) : (
                      <span className="text-[10px] text-ink-soft">{tr("不限线路", "Any route")}</span>
                    )}
                  </div>
                  <div className="mt-auto flex items-end justify-between pt-2">
                    <div className="inline-flex items-center rounded-full border border-border">
                      {(() => {
                        const step = i.purchaseType === "business" ? Math.max(i.packQty ?? 1, 1) : 1;
                        return (
                          <>
                            <button
                              onClick={() => update(i.slug, i.quantity - step, i.variantId)}
                              className="grid h-8 w-8 place-items-center text-ink-soft hover:text-foreground"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-10 text-center text-sm font-medium">{i.quantity}</span>
                            <button
                              onClick={() => update(i.slug, i.quantity + step, i.variantId)}
                              className="grid h-8 w-8 place-items-center text-ink-soft hover:text-foreground"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </>
                        );
                      })()}
                    </div>
                    <div className="font-display text-lg font-bold text-brand-gradient">
                      {formatPrice(i.priceCNY * i.quantity)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <aside className="h-fit rounded-2xl border border-border bg-surface p-6 lg:sticky lg:top-24">
          <h2 className="mb-4 font-display text-lg font-bold">{tr("订单摘要", "Order summary")}</h2>
          <dl className="space-y-2 text-sm">
            <Row label={tr("已选商品", "Selected")} value={`${selectedItems.length} / ${items.length}`} />
            <Row label={tr("小计", "Subtotal")} value={formatPrice(selectedSubtotalCNY)} />
            <Row label={tr("预计总重量", "Est. weight")} value={`${selectedWeightKg.toFixed(2)} kg`} muted />
          </dl>
          <p className="mt-1.5 text-[11px] text-ink-soft">
            {tr(
              "实际计费重量会根据发货、打包和线路规则有所调整",
              "Actual chargeable weight may be adjusted based on shipping, packing and route rules",
            )}
          </p>
          <div className="my-4 h-px bg-border" />
          {hasRouteConflict ? (
            <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {tr(
                "所选商品没有共同可用的线路，无法一起结算，请分开结算或取消勾选部分商品",
                "Selected items don't share a common shipping route — check out separately or deselect some items",
              )}
            </div>
          ) : (
            <p className="text-[11px] text-ink-soft">
              {tr(
                "运费、关税在结账页根据所选线路自动计算",
                "Shipping & duty are calculated on checkout based on the route",
              )}
            </p>
          )}
          <button
            onClick={goCheckout}
            disabled={selectedItems.length === 0 || hasRouteConflict}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-cta-gradient px-6 py-3.5 text-sm font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-50"
          >
            {tr(`结算所选 (${selectedCount})`, `Checkout selected (${selectedCount})`)}
            <ArrowRight className="h-4 w-4" />
          </button>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-ink-soft" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
