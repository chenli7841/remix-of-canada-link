import { Link } from "@tanstack/react-router";
import { useApp } from "@/lib/i18n";
import { useCart } from "@/lib/cart";
import type { Product } from "@/lib/mock-data";
import { ShoppingCart } from "lucide-react";
import { toast } from "sonner";

export function ProductCard({ p }: { p: Product }) {
  const { lang, formatPrice, t } = useApp();
  const { add } = useCart();
  const isB2B = p.purchaseType === "business";

  const handleAdd = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    add(p);
    toast.success(lang === "zh" ? `已加入购物车：${p.name.zh}` : `Added to cart: ${p.name.en}`);
  };

  return (
    <Link
      to="/products/$slug"
      params={{ slug: p.slug }}
      className="group relative flex flex-col overflow-hidden rounded-2xl border border-border bg-surface transition-all hover:-translate-y-1 hover:shadow-elevated"
    >
      <div className="relative grid aspect-square place-items-center overflow-hidden bg-gradient-to-br from-accent to-surface text-7xl">
        {/^https?:\/\//.test(p.image) ? (
          <img src={p.image} alt={p.name[lang]} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span>{p.image}</span>
        )}
        {p.badge && (
          <span className="absolute left-3 top-3 rounded-full bg-cta px-2.5 py-0.5 text-xs font-semibold text-cta-foreground">
            {p.badge[lang]}
          </span>
        )}
        <span
          className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
            isB2B ? "bg-foreground text-background" : "bg-background/80 text-ink-soft backdrop-blur"
          }`}
        >
          {isB2B ? t("ptype.business") : t("ptype.personal")}
        </span>
        <button
          onClick={handleAdd}
          aria-label={t("product.add")}
          className="absolute bottom-3 right-3 grid h-9 w-9 translate-y-2 place-items-center rounded-full bg-foreground text-background opacity-0 shadow-elevated transition-all hover:scale-110 group-hover:translate-y-0 group-hover:opacity-100"
        >
          <ShoppingCart className="h-4 w-4" />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{p.name[lang]}</h3>
        <p className="line-clamp-2 text-xs text-ink-soft">{p.description[lang]}</p>
        {isB2B && p.moq && (
          <div className="text-[11px] font-medium text-brand">{t("ptype.moq")} · {p.moq}</div>
        )}
        <div className="mt-auto flex items-end justify-between pt-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-soft">{t("product.from")}</div>
            <div className="font-display text-lg font-bold text-brand-gradient">{formatPrice(p.priceCNY)}</div>
          </div>
          <span className="text-xs text-ink-soft">{p.weightKg}kg</span>
        </div>
      </div>
    </Link>
  );
}
