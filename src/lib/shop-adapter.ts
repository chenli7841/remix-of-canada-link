import type { Product } from "./mock-data";
import type { PublicProduct } from "./shop-public.functions";

const CAT_EMOJI: Record<string, string> = {
  electronics: "📱",
  fashion: "👗",
  beauty: "💄",
  home: "🛋️",
  food: "🍜",
  "mom-baby": "🍼",
  health: "🌿",
  stationery: "✏️",
};

export function adaptProduct(p: PublicProduct): Product {
  const catSlug = p.category?.slug ?? "home";
  const img = p.cover_url || (Array.isArray(p.images) && p.images[0]) || CAT_EMOJI[catSlug] || "🛍️";
  return {
    slug: p.slug,
    name: { zh: p.name, en: p.name_en || p.name },
    description: {
      zh: p.subtitle ?? p.description ?? "",
      en: p.subtitle_en ?? p.description_en ?? p.subtitle ?? p.description ?? "",
    },
    priceCNY: Number(p.price_cny ?? 0),
    weightKg: Number(p.weight_kg ?? 0.5),
    category: catSlug,
    image: img,
    purchaseType: p.purchase_type === "business" ? "business" : "personal",
    moq: p.moq ?? 1,
    packQty: p.pack_qty ?? 1,
    packWeightKg: p.pack_weight_kg ?? undefined,
    availableRouteCodes: Array.isArray(p.available_route_codes) ? p.available_route_codes : [],
    personalRouteCodes: [p.personal_sea_route_code, p.personal_air_route_code].filter(Boolean) as string[],
    businessRouteCodes: [p.business_sea_route_code, p.business_air_route_code].filter(Boolean) as string[],
  } as Product;
}

export function adaptCategories(cats: { slug: string; name: string; name_en: string | null }[]) {
  return cats.map((c) => ({
    slug: c.slug,
    name: { zh: c.name, en: c.name_en ?? c.name },
    icon: CAT_EMOJI[c.slug] ?? "🛍️",
  }));
}
