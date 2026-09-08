import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useApp } from "@/lib/i18n";
import { type PurchaseType } from "@/lib/mock-data";
import { ProductCard } from "@/components/site/ProductCard";
import { Search, User, Building2 } from "lucide-react";
import { listPublicProducts, listPublicCategories } from "@/lib/shop-public.functions";
import { adaptProduct, adaptCategories } from "@/lib/shop-adapter";

const productsQO = queryOptions({
  queryKey: ["public", "products"],
  queryFn: () => listPublicProducts({ data: {} }),
});
const catsQO = queryOptions({
  queryKey: ["public", "categories"],
  queryFn: () => listPublicCategories(),
});

export const Route = createFileRoute("/products/")({
  head: () => ({
    meta: [
      { title: "商品 / Shop — SinoCargo" },
      { name: "description", content: "Browse curated China-sourced products shipped to Canada — personal retail and business wholesale (MOQ, OEM)." },
      { property: "og:title", content: "Shop — SinoCargo" },
      { property: "og:description", content: "China-sourced products, personal & business purchasing, dual-currency, shipped to Canada." },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(productsQO);
    context.queryClient.ensureQueryData(catsQO);
  },
  errorComponent: ({ error }) => <div className="p-10 text-center text-destructive">{error.message}</div>,
  notFoundComponent: () => <div className="p-10 text-center">Not found</div>,
  component: ProductsPage,
});

type Mode = "all" | PurchaseType;

function ProductsPage() {
  const { lang, t } = useApp();
  const { data: prodData } = useSuspenseQuery(productsQO);
  const { data: catData } = useSuspenseQuery(catsQO);
  const products = useMemo(() => prodData.items.map(adaptProduct), [prodData]);
  const categories = useMemo(() => adaptCategories(catData.items), [catData]);

  const [mode, setMode] = useState<Mode>("all");
  const [cat, setCat] = useState<string>("all");
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    return products.filter((p) => {
      if (mode !== "all" && p.purchaseType !== mode) return false;
      if (cat !== "all" && p.category !== cat) return false;
      if (q && !p.name[lang].toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [products, mode, cat, q, lang]);

  const modes: { key: Mode; label: string; desc: string; icon: React.ReactNode }[] = [
    { key: "all", label: t("ptype.all"), desc: lang === "zh" ? "浏览全部商品" : "Browse everything", icon: <Search className="h-4 w-4" /> },
    { key: "personal", label: t("ptype.personal"), desc: t("ptype.personal_desc"), icon: <User className="h-4 w-4" /> },
    { key: "business", label: t("ptype.business"), desc: t("ptype.business_desc"), icon: <Building2 className="h-4 w-4" /> },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-bold sm:text-4xl">{t("nav.products")}</h1>
        <p className="mt-2 text-ink-soft">{lang === "zh" ? "源头直采 · 中国发货 · 集运到加" : "Source direct · Ship from China · Consolidate to Canada"}</p>
      </header>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {modes.map((m) => {
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`group flex items-start gap-3 rounded-2xl border p-4 text-left transition ${
                active ? "border-brand bg-brand/5 shadow-glow" : "border-border bg-surface hover:border-brand/40"
              }`}
            >
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${active ? "bg-brand text-brand-foreground" : "bg-accent text-ink-soft"}`}>{m.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-xs text-ink-soft">{m.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={lang === "zh" ? "搜索商品..." : "Search products..."}
            className="h-11 w-full rounded-full border border-border bg-surface pl-10 pr-4 text-sm outline-none ring-brand/30 focus:border-brand focus:ring-2"
          />
        </div>
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

      <div className="mb-8 -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        <button
          onClick={() => setCat("all")}
          className={`shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition ${cat === "all" ? "border-foreground bg-foreground text-background" : "border-border bg-surface hover:border-brand/40"}`}
        >
          {lang === "zh" ? "全部" : "All"}
        </button>
        {categories.map((c) => (
          <button
            key={c.slug}
            onClick={() => setCat(c.slug)}
            className={`shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition ${cat === c.slug ? "border-foreground bg-foreground text-background" : "border-border bg-surface hover:border-brand/40"}`}
          >
            <span className="mr-1">{c.icon}</span>{c.name[lang]}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface py-20 text-center text-ink-soft">
          {lang === "zh" ? "没有匹配的商品" : "No products match your filters."}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((p) => <ProductCard key={p.slug} p={p} />)}
        </div>
      )}
    </div>
  );
}
