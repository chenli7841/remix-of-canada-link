import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/i18n";
import { ProductCard } from "@/components/site/ProductCard";
import { listPublicProducts, listPublicCategories } from "@/lib/shop-public.functions";
import { adaptProduct, adaptCategories } from "@/lib/shop-adapter";
import heroImg from "@/assets/hero-logistics.jpg";
import { ArrowRight, Package, ShieldCheck, Plane, Ship, Truck, Warehouse } from "lucide-react";

const homeProductsQO = queryOptions({
  queryKey: ["public", "products", "home-featured"],
  queryFn: () => listPublicProducts({ data: { limit: 12, featuredOnly: true } }),
});
const homeCatsQO = queryOptions({
  queryKey: ["public", "categories"],
  queryFn: () => listPublicCategories(),
});

export const Route = createFileRoute("/")({
  head: () => {
    const img =
      "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/ececec33-843a-4443-a70f-61d8d276a071/id-preview-09d32aaf--d5d0f95a-a75a-4a1e-b677-98fa89e2c8c6.lovable.app-1784083834318.png";
    return {
      meta: [
        { title: "SinoCargo — 中国到加拿大跨境采购 + 集运" },
        {
          name: "description",
          content: "自营商城 + 国际集运一站搞定。源头好物、双币结算、全程可追踪，平均 7–12 天送达加拿大。",
        },
        { property: "og:title", content: "SinoCargo — 中国到加拿大跨境采购 + 集运" },
        {
          property: "og:description",
          content: "自营商城 + 国际集运一站搞定。源头好物、双币结算、全程可追踪，平均 7–12 天送达加拿大。",
        },
        { property: "og:image", content: img },
        { name: "twitter:image", content: img },
      ],
    };
  },
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(homeProductsQO);
    context.queryClient.ensureQueryData(homeCatsQO);
  },
  errorComponent: ({ error }) => <div className="p-10 text-center text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-10 text-center">Not found</div>,
  component: Home,
});

function Home() {
  const { t, lang } = useApp();
  const { data: prodData } = useSuspenseQuery(homeProductsQO);
  const { data: catData } = useSuspenseQuery(homeCatsQO);
  const featured = prodData.items.slice(0, 12).map(adaptProduct);
  const categories = adaptCategories(catData.items);

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden bg-hero text-white">
        <div className="absolute inset-0 grid-lines opacity-50" aria-hidden />
        <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-cta" />
              {t("hero.tag")}
            </span>
            <h1 className="mt-5 whitespace-pre-line font-display text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              {t("hero.title")}
            </h1>
            <p className="mt-5 max-w-xl text-base text-white/70 sm:text-lg">{t("hero.subtitle")}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/products"
                className="group inline-flex w-full items-center justify-center gap-2 rounded-full bg-cta-gradient px-6 py-3 text-sm font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 sm:w-auto"
              >
                {t("hero.cta_shop")}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
              <Link
                to="/shipping"
                className="group inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/20 bg-white/5 px-6 py-3 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/10 sm:w-auto"
              >
                <Ship className="h-4 w-4" />
                {t("hero.cta_ship")}
              </Link>
            </div>
            <div className="mt-6 rounded-2xl border border-white/15 bg-white/5 p-4 backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cta-gradient text-cta-foreground">
                  <Ship className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">{t("home.shipping_entry")}</div>
                  <div className="text-xs text-white/60">{t("home.shipping_entry_sub")}</div>
                </div>
                <Link
                  to="/shipping"
                  className="group inline-flex shrink-0 items-center gap-1 rounded-full bg-cta-gradient px-4 py-2 text-xs font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110"
                >
                  {t("home.shipping_entry_btn")}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
            <dl className="mt-12 grid max-w-lg grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
              {[
                ["50K+", t("stats.orders")],
                ["3", t("stats.warehouses")],
                ["80+", t("stats.cities")],
                ["9.2", t("stats.days")],
              ].map(([k, v]) => (
                <div key={v as string}>
                  <dt className="font-display text-2xl font-bold text-white">{k}</dt>
                  <dd className="mt-0.5 text-xs text-white/60">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative">
            <div className="absolute -inset-4 rounded-3xl bg-brand-gradient opacity-30 blur-3xl" aria-hidden />
            <img
              src={heroImg}
              width={1536}
              height={1024}
              alt="China to Canada international logistics network"
              className="relative w-full rounded-2xl border border-white/10 shadow-elevated"
            />
          </div>
        </div>
      </section>

      {/* CATEGORIES */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="mb-8 flex items-end justify-between">
          <h2 className="font-display text-2xl font-bold sm:text-3xl">{t("section.categories")}</h2>
          <Link to="/products" className="text-sm font-medium text-brand hover:underline">
            {t("common.view_all")} →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {categories.map((c) => (
            <Link
              key={c.slug}
              to="/products"
              className="group flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface p-4 text-center transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-card"
            >
              <span className="text-3xl transition-transform group-hover:scale-110">{c.icon}</span>
              <span className="text-xs font-medium text-ink-soft group-hover:text-foreground">{c.name[lang]}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* FEATURED */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6">
        <div className="mb-8 flex items-end justify-between">
          <h2 className="font-display text-2xl font-bold sm:text-3xl">{t("section.featured")}</h2>
          <Link to="/products" className="text-sm font-medium text-brand hover:underline">
            {t("common.view_all")} →
          </Link>
        </div>
        <div className="mb-6 rounded-2xl border border-brand/20 bg-brand/5 p-4 sm:p-5">
          <p className="text-sm font-medium text-foreground">
            <span className="mr-1 text-brand">💡</span>
            {lang === "zh" ? "推荐好物奖励：联系客服，推荐好物，客服采纳后得 $5 余额。" : "Recommend good products: contact customer service, and earn $5 credit after adoption."}
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">
            <span className="mr-1 text-brand">🏭</span>
            {lang === "zh" ? "推荐厂家：经由客户推荐并协助接洽的物品，提成该物品销售额的 1%-5%。" : "Recommend a manufacturer: receive 1%-5% commission on sales for items you refer and help us connect with."}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {featured.map((p) => (
            <ProductCard key={p.slug} p={p} />
          ))}
        </div>
      </section>

      {/* FLOW */}
      <section className="bg-surface py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">{t("section.flow")}</h2>
            <p className="mt-3 text-ink-soft">{t("section.flow_sub")}</p>
          </div>
          <div className="relative mt-14 grid gap-6 md:grid-cols-5">
            <div
              className="absolute left-[10%] right-[10%] top-7 hidden h-px bg-gradient-to-r from-transparent via-brand/40 to-transparent md:block"
              aria-hidden
            />
            {[
              { icon: Package, k: 1 as const },
              { icon: Warehouse, k: 2 as const },
              { icon: Package, k: 3 as const },
              { icon: Plane, k: 4 as const },
              { icon: Truck, k: 5 as const },
            ].map(({ icon: Icon, k }, i) => (
              <div key={k} className="relative flex flex-col items-center text-center">
                <div className="relative grid h-14 w-14 place-items-center rounded-2xl border border-border bg-background shadow-card">
                  <Icon className="h-6 w-6 text-brand" />
                  <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-cta text-[10px] font-bold text-cta-foreground">
                    {i + 1}
                  </span>
                </div>
                <h3 className="mt-4 text-sm font-semibold">{t(`flow.${k}_t` as const)}</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-soft">{t(`flow.${k}_d` as const)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRUST */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <h2 className="text-center font-display text-3xl font-bold sm:text-4xl">{t("section.trust")}</h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: ShieldCheck, k: 1 as const },
            { icon: Package, k: 2 as const },
            { icon: Ship, k: 3 as const },
            { icon: Truck, k: 4 as const },
          ].map(({ icon: Icon, k }) => (
            <div
              key={k}
              className="rounded-2xl border border-border bg-surface p-6 transition hover:border-brand/40 hover:shadow-card"
            >
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand-gradient text-brand-foreground">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mt-4 font-semibold">{t(`trust.${k}_t` as const)}</h3>
              <p className="mt-1 text-sm text-ink-soft">{t(`trust.${k}_d` as const)}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
