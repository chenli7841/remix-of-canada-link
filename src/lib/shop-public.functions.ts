import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function pubClient() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export type PublicProduct = {
  id: string;
  slug: string;
  name: string;
  name_en: string | null;
  subtitle: string | null;
  subtitle_en: string | null;
  description: string | null;
  description_en: string | null;
  brand: string | null;
  price_cny: number;
  compare_price_cny: number | null;
  weight_kg: number | null;
  cover_url: string | null;
  images: string[];
  tags: string[];
  total_stock: number;
  sold_count: number;
  category: { slug: string; name: string; name_en: string | null } | null;
  hs_code: string | null;
  manufacturer: string | null;
  detail_blocks: Array<{ type: "image" | "video" | "text"; url?: string; content?: string }>;
  purchase_type: "personal" | "business";
  allow_personal: boolean;
  allow_business: boolean;
  moq: number;
  customs_mfn_rate: number;
  customs_gst_rate: number;
  customs_antidumping_rate: number;
  freight_cny: number;
  compare_price_cad: number | null;
  personal_freight_mode: "follow_route" | "per_unit";
  personal_per_unit_freight_cny: number;
  pack_qty: number;
  pack_weight_kg: number | null;
  pack_length_cm: number | null;
  pack_width_cm: number | null;
  pack_height_cm: number | null;
  pack_volume_m3: number | null;
  available_route_codes: string[] | null;
  personal_sea_route_code: string | null;
  personal_air_route_code: string | null;
  business_sea_route_code: string | null;
  business_air_route_code: string | null;
  is_featured: boolean;
  origin_location: string | null;
  origin_location_en: string | null;
  packaging_note: string | null;
  packaging_note_en: string | null;
  lead_time_note: string | null;
  lead_time_note_en: string | null;
  origin_port_note: string | null;
  origin_port_note_en: string | null;
  faq_items: Array<{ q: string; a: string; q_en?: string; a_en?: string }>;
  trust_points: Array<{ text: string; text_en?: string } | string>;
};

const BASE_COLS =
  "id,slug,name,name_en,subtitle,subtitle_en,description,description_en,brand,price_cny,compare_price_cny,compare_price_cad,weight_kg,cover_url,images,tags,total_stock,sold_count,hs_code,manufacturer,detail_blocks,purchase_type,allow_personal,allow_business,moq,customs_mfn_rate,customs_gst_rate,customs_antidumping_rate,freight_cny,personal_freight_mode,personal_per_unit_freight_cny,pack_qty,pack_weight_kg,pack_length_cm,pack_width_cm,pack_height_cm,pack_volume_m3,available_route_codes,personal_sea_route_code,personal_air_route_code,business_sea_route_code,business_air_route_code,is_featured,category:product_categories(slug,name,name_en)";
// origin_location(_en) / packaging_note(_en) / lead_time_note(_en) / origin_port_note(_en) /
// faq_items / trust_points ship in migrations 20260814110000 + 20260814150000 + 20260814190000 —
// until those have been deployed, selecting them errors with "column products.x does not exist",
// so every query below falls back to BASE_COLS and fills these in as defaults rather than
// 500ing the whole page.
const NEW_COLS =
  "origin_location,origin_location_en,packaging_note,packaging_note_en,lead_time_note,lead_time_note_en,origin_port_note,origin_port_note_en,faq_items,trust_points";
const SELECT_COLS = `${BASE_COLS},${NEW_COLS}`;
const DEFAULT_TRUST_POINTS = [
  {
    text: "国内官方渠道直采，保证正品",
    text_en: "Sourced from official China channels, guaranteed authentic",
  },
  {
    text: "支持合箱集运，节省 40% 运费",
    text_en: "Box consolidation supported, saves up to 40% on freight",
  },
  { text: "全程运单追踪，节点透明", text_en: "Full tracking with visibility at every node" },
];
const NEW_COLS_DEFAULTS = {
  origin_location: null,
  origin_location_en: null,
  packaging_note: null,
  packaging_note_en: null,
  lead_time_note: null,
  lead_time_note_en: null,
  origin_port_note: null,
  origin_port_note_en: null,
  faq_items: [],
  trust_points: DEFAULT_TRUST_POINTS,
};
const isMissingNewColumn = (err: any) => !!err && /does not exist/i.test(err.message ?? "");
const withNewColDefaults = (row: any) => (row ? { ...NEW_COLS_DEFAULTS, ...row } : row);
const withNewColDefaultsList = (rows: any[] | null) => (rows ?? []).map(withNewColDefaults);

export const listPublicCategories = createServerFn({ method: "GET" }).handler(async () => {
  const sb = pubClient();
  const { data, error } = await sb
    .from("product_categories")
    .select("id,slug,name,name_en,cover_url,sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return { items: data ?? [] };
});

export const listPublicProducts = createServerFn({ method: "POST" })
  .inputValidator((d: { category?: string; q?: string; limit?: number; featuredOnly?: boolean } = {}) => d)
  .handler(async ({ data }) => {
    const sb = pubClient();
    const limit = Math.min(200, data.limit ?? 100);
    const buildMain = (cols: string) => {
      let q = sb
        .from("products")
        .select(cols)
        .eq("status", "active" as any);
      if (data.featuredOnly) q = q.eq("is_featured", true as any);
      q = q.order("created_at", { ascending: false }).limit(limit);
      if (data.q) q = q.ilike("name", `%${data.q}%`);
      return q;
    };
    let { data: rows, error } = await buildMain(SELECT_COLS);
    if (isMissingNewColumn(error)) ({ data: rows, error } = await buildMain(BASE_COLS));
    if (error) throw new Error(error.message);
    let items = withNewColDefaultsList(rows) as any as PublicProduct[];
    if (data.featuredOnly && items.length === 0) {
      // no products marked as featured yet — fall back to the most recent active products
      const buildFallback = (cols: string) =>
        sb
          .from("products")
          .select(cols)
          .eq("status", "active" as any)
          .order("created_at", { ascending: false })
          .limit(limit);
      let { data: fallbackRows, error: fbErr } = await buildFallback(SELECT_COLS);
      if (isMissingNewColumn(fbErr)) ({ data: fallbackRows, error: fbErr } = await buildFallback(BASE_COLS));
      if (fbErr) throw new Error(fbErr.message);
      items = withNewColDefaultsList(fallbackRows) as any as PublicProduct[];
    }
    if (data.category && data.category !== "all") {
      items = items.filter((p) => p.category?.slug === data.category);
    }
    return { items };
  });

export const getPublicProduct = createServerFn({ method: "POST" })
  .inputValidator((d: { slug: string }) => d)
  .handler(async ({ data }) => {
    const sb = pubClient();
    const buildProduct = (cols: string) =>
      sb
        .from("products")
        .select(cols)
        .eq("slug", data.slug)
        .eq("status", "active" as any)
        .maybeSingle();
    let { data: product, error } = await buildProduct(SELECT_COLS);
    if (isMissingNewColumn(error)) ({ data: product, error } = await buildProduct(BASE_COLS));
    if (error) throw new Error(error.message);
    if (!product) return { product: null, related: [] as PublicProduct[], variants: [] as any[] };
    product = withNewColDefaults(product);
    // weight_kg/length_cm/.../pack_volume_m3 ship in migration 20260814210000 — same
    // not-yet-deployed fallback as the product-level NEW_COLS above.
    const VARIANT_FREIGHT_COLS =
      "weight_kg,length_cm,width_cm,height_cm,pack_qty,pack_weight_kg,pack_length_cm,pack_width_cm,pack_height_cm,pack_volume_m3";
    const buildVariants = (cols: string) =>
      sb
        .from("product_variants")
        .select(cols)
        .eq("product_id", (product as any).id)
        .eq("is_active", true);
    let { data: variants, error: varErr } = await buildVariants(
      `id,sku,attrs,price_cny,stock,is_active,${VARIANT_FREIGHT_COLS}`,
    );
    if (isMissingNewColumn(varErr))
      ({ data: variants } = await buildVariants("id,sku,attrs,price_cny,stock,is_active"));
    const cat = (product as any).category?.slug as string | undefined;
    let related: PublicProduct[] = [];
    if (cat) {
      const buildRelated = (cols: string) =>
        sb
          .from("products")
          .select(cols)
          .eq("status", "active" as any)
          .neq("slug", data.slug)
          .limit(8);
      let { data: rel, error: relErr } = await buildRelated(SELECT_COLS);
      if (isMissingNewColumn(relErr)) ({ data: rel } = await buildRelated(BASE_COLS));
      related = (withNewColDefaultsList(rel) as any as PublicProduct[])
        .filter((p) => p.category?.slug === cat)
        .slice(0, 4);
    }
    return {
      product: product as any as PublicProduct,
      related,
      variants: (variants ?? []) as any[],
    };
  });

export const listPublicRoutes = createServerFn({ method: "GET" }).handler(async () => {
  const sb = pubClient();
  const { data, error } = await sb
    .from("shipping_routes")
    .select(
      "id, code, name_zh, name_en, shipping_method, destination_code, transit_days_min, transit_days_max, note, sort_order, origin_warehouse_id",
    )
    .eq("is_active", true)
    .in("usage_scope", ["shop", "both"])
    .order("sort_order");
  if (error) throw new Error(error.message);
  return { items: data ?? [] };
});

export const listPublicWarehouses = createServerFn({ method: "GET" }).handler(async () => {
  const sb = pubClient();
  const { data, error } = await sb
    .from("warehouses")
    .select("id, code, name_zh, name_en, country, type, address, phone, sort_order")
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return { items: data ?? [] };
});
