import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { getProduct, saveProduct, listCategories } from "@/lib/shop.functions";
import { listHsCodes } from "@/lib/hs-codes.functions";
import { MediaUpload, uploadShopMedia } from "@/components/admin/MediaUpload";
import {
  Loader2,
  Save,
  ArrowLeft,
  Plus,
  Trash2,
  PackageOpen,
  Image as ImageIcon,
  Video,
  FileText,
  Search,
  Plane,
  Ship,
  Truck,
  Warehouse,
  Upload,
  X,
  ShoppingCart,
  Minus,
  Share2,
  MapPin,
} from "lucide-react";

export const Route = createFileRoute("/admin/shop/products/$productId")({ component: ProductEdit });

// ---- shared visual language for the "editable in place" fields below ----
// Dashed brand border + tinted fill = you can edit this right here, it maps
// 1:1 onto something a shopper sees on the real product page. Solid muted =
// read-only (either computed, or lives elsewhere — e.g. stock/inventory).
const editableCls =
  "w-full rounded-lg border-2 border-dashed border-brand/40 bg-brand/5 px-3 py-2 text-sm text-foreground placeholder:text-ink-soft/60 focus:border-brand focus:bg-surface focus:outline-none transition";
const editableSmCls =
  "rounded-lg border-2 border-dashed border-brand/40 bg-brand/5 px-2.5 py-1.5 text-xs text-foreground focus:border-brand focus:bg-surface focus:outline-none transition";
const lockedCls = "w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-ink-soft";
// Same shape as a normal input — still fully editable — but solid/neutral
// instead of the dashed brand style, so "internal-only, never shown to
// shoppers" (生产厂家信息) reads visually different from the front-end-mapped
// fields around it.
const lockedInputCls =
  "w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-ink-soft focus:outline-none";

function ProductEdit() {
  const { productId } = Route.useParams();
  const isNew = productId === "new";
  const fetchOne = useServerFn(getProduct);
  const save = useServerFn(saveProduct);
  const fetchCats = useServerFn(listCategories);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const catsQ = useQuery({ queryKey: ["shop-cats"], queryFn: () => fetchCats() });
  const q = useQuery({
    queryKey: ["shop-product", productId],
    queryFn: () => fetchOne({ data: { id: productId } }),
    enabled: !isNew,
  });

  const [form, setForm] = useState<any>({
    sku: "",
    name: "",
    name_en: "",
    slug: "",
    description: "",
    description_en: "",
    brand: "",
    status: "draft",
    price_cny: 0,
    compare_price_cad: null,
    category_id: null,
    cover_url: "",
    weight_kg: null,
    length_cm: null,
    width_cm: null,
    height_cm: null,
    tags: [],
    images: [],
    hs_code: "",
    manufacturer: "",
    manufacturer_contact: {},
    detail_blocks: [],
    purchase_type: "personal",
    allow_personal: true,
    allow_business: false,
    cargo_type: "general",
    moq: 1,
    customs_mfn_rate: 0,
    customs_gst_rate: 0,
    customs_antidumping_rate: 0,
    personal_freight_mode: "follow_route",
    personal_per_unit_freight_cny: 0,
    personal_per_unit_freight_air_cny: 0,
    personal_per_unit_freight_sea_cny: 0,
    personal_air_route_code: null,
    personal_sea_route_code: null,
    business_air_route_code: null,
    business_sea_route_code: null,
    pack_qty: 1,
    pack_weight_kg: null,
    pack_length_cm: null,
    pack_width_cm: null,
    pack_height_cm: null,
    pack_volume_m3: null,
    available_route_codes: [],
    is_featured: false,
    origin_location: "",
    origin_location_en: "",
    packaging_note: "",
    packaging_note_en: "",
    lead_time_note: "",
    lead_time_note_en: "",
    origin_port_note: "",
    origin_port_note_en: "",
    faq_items: [],
    trust_points: [],
  });

  const [routes, setRoutes] = useState<any[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [featuredCount, setFeaturedCount] = useState(0);
  const [expandedVariant, setExpandedVariant] = useState<Record<number, boolean>>({});
  const totalStock = q.data?.product ? (q.data.product as any).total_stock : null;

  useEffect(() => {
    import("@/integrations/supabase/client").then(({ supabase }) =>
      (supabase as any)
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("is_featured", true)
        .then(({ count }: any) => setFeaturedCount(count ?? 0)),
    );
  }, [q.data]);

  useEffect(() => {
    if (q.data) {
      const p: any = q.data.product;
      setForm({
        ...p,
        images: Array.isArray(p.images) ? p.images : [],
        detail_blocks: Array.isArray(p.detail_blocks) ? p.detail_blocks : [],
        available_route_codes: Array.isArray(p.available_route_codes) ? p.available_route_codes : [],
        faq_items: Array.isArray(p.faq_items) ? p.faq_items : [],
        trust_points: (Array.isArray(p.trust_points) ? p.trust_points : []).map((t: any) =>
          typeof t === "string" ? { text: t, text_en: "" } : t,
        ),
        manufacturer_contact:
          p.manufacturer_contact && typeof p.manufacturer_contact === "object" ? p.manufacturer_contact : {},
      });
      setVariants(q.data.variants);
    }
  }, [q.data]);

  useEffect(() => {
    import("@/integrations/supabase/client").then(({ supabase }) =>
      (supabase as any)
        .from("shipping_routes")
        .select("code,name_zh,shipping_method,destination_code,cargo_type,usage_scope")
        .eq("is_active", true)
        .in("usage_scope", ["shop", "both"])
        .order("sort_order")
        .then(({ data }: any) => setRoutes(data ?? [])),
    );
  }, []);

  const onSave = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await save({ data: { ...form, id: isNew ? undefined : productId, variants } });
      setMsg("✓ 已保存");
      qc.invalidateQueries({ queryKey: ["shop-products"] });
      qc.invalidateQueries({ queryKey: ["shop-product", productId] });
      if (isNew && r.id) navigate({ to: "/admin/shop/products/$productId", params: { productId: r.id } });
    } catch (e: any) {
      setMsg("✗ " + e.message);
    } finally {
      setBusy(false);
    }
  };

  // Variants
  const addVariant = () =>
    setVariants([
      ...variants,
      {
        id: "new_" + Date.now(),
        sku: form.sku + "-V" + (variants.length + 1),
        attrs: { color: "", size: "" },
        price_cny: form.price_cny ?? 0,
        stock: 0,
        is_active: true,
      },
    ]);
  const updateVariant = (idx: number, patch: any) => {
    const n = [...variants];
    n[idx] = { ...n[idx], ...patch };
    setVariants(n);
  };
  const removeVariant = (idx: number) => setVariants(variants.filter((_, i) => i !== idx));

  // Gallery images
  const addImageUrl = (url: string) => setForm({ ...form, images: [...form.images, url] });
  const removeImage = (i: number) =>
    setForm({ ...form, images: form.images.filter((_: any, idx: number) => idx !== i) });

  // Detail blocks
  const addBlock = (type: "image" | "video" | "text") =>
    setForm({ ...form, detail_blocks: [...form.detail_blocks, { type, url: "", content: "" }] });
  const updateBlock = (i: number, patch: any) => {
    const n = [...form.detail_blocks];
    n[i] = { ...n[i], ...patch };
    setForm({ ...form, detail_blocks: n });
  };
  const removeBlock = (i: number) =>
    setForm({
      ...form,
      detail_blocks: form.detail_blocks.filter((_: any, idx: number) => idx !== i),
    });

  // FAQ
  const addFaq = () => setForm({ ...form, faq_items: [...form.faq_items, { q: "", a: "" }] });
  const updateFaq = (i: number, patch: any) => {
    const n = [...form.faq_items];
    n[i] = { ...n[i], ...patch };
    setForm({ ...form, faq_items: n });
  };
  const removeFaq = (i: number) =>
    setForm({ ...form, faq_items: form.faq_items.filter((_: any, idx: number) => idx !== i) });

  // Trust points ("商品亮点" / 前台保障文案，逐商品可编辑)
  const addTrust = () => setForm({ ...form, trust_points: [...form.trust_points, { text: "", text_en: "" }] });
  const updateTrust = (i: number, patch: any) => {
    const n = [...form.trust_points];
    n[i] = { ...n[i], ...patch };
    setForm({ ...form, trust_points: n });
  };
  const removeTrust = (i: number) =>
    setForm({
      ...form,
      trust_points: form.trust_points.filter((_: any, idx: number) => idx !== i),
    });

  // Variant swatches
  const addSwatch = () =>
    setVariants([
      ...variants,
      {
        id: "new_" + Date.now(),
        sku: form.sku + "-V" + (variants.length + 1),
        attrs: { color: "", size: "" },
        price_cny: form.price_cny ?? 0,
        stock: 0,
        is_active: true,
      },
    ]);

  // 可用运输方式（前台"运输方式卡片"）
  const toggleRoute = (code: string) => {
    const set = new Set<string>(form.available_route_codes ?? []);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    setForm({ ...form, available_route_codes: [...set] });
  };

  if (!isNew && q.isLoading)
    return (
      <div className="grid h-[60vh] place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );

  return (
    <div className="mx-auto max-w-6xl p-6">
      <button
        onClick={() => navigate({ to: "/admin/shop/products" })}
        className="mb-3 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white"
      >
        <ArrowLeft className="h-3 w-3" />
        返回商品列表
      </button>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2 text-white">
          <PackageOpen className="h-5 w-5 text-blue-400" />
          {isNew ? "新增商品" : "编辑商品"}
        </h1>
        <div className="flex items-center gap-3">
          {msg && <span className="text-xs text-emerald-300">{msg}</span>}
          <button
            onClick={onSave}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存
          </button>
        </div>
      </div>

      {/* Everything below mirrors the real product page's light theme — this
          card is deliberately light against the dark admin shell so it reads
          as "this is what shoppers will see", not just another settings form. */}
      <div className="rounded-3xl border border-border bg-surface p-5 text-foreground shadow-elevated sm:p-8">
        {/* slim utility strip — pure admin metadata, no visual counterpart on the product page */}
        <div className="mb-8 grid gap-3 rounded-xl border border-border bg-muted p-4 sm:grid-cols-4">
          <UtilField label="SKU">
            <input
              value={form.sku}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              className={utilInputCls}
            />
          </UtilField>
          <UtilField label="Slug">
            <input
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: e.target.value })}
              className={utilInputCls}
            />
          </UtilField>
          <UtilField label="分类">
            <select
              value={form.category_id ?? ""}
              onChange={(e) => setForm({ ...form, category_id: e.target.value || null })}
              className={utilInputCls}
            >
              <option value="">未分类</option>
              {(catsQ.data?.items ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </UtilField>
          <UtilField label="状态">
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
              className={utilInputCls}
            >
              <option value="draft">草稿</option>
              <option value="active">在售</option>
              <option value="archived">下架</option>
            </select>
          </UtilField>
          <div className="sm:col-span-4">
            <label
              className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs cursor-pointer ${form.is_featured ? "border-brand bg-brand/10 text-brand" : "border-border bg-surface text-ink-soft"} ${!form.is_featured && featuredCount >= 12 ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <input
                type="checkbox"
                checked={!!form.is_featured}
                disabled={!form.is_featured && featuredCount >= 12}
                onChange={(e) => setForm({ ...form, is_featured: e.target.checked })}
              />
              加入首页「本周精选」（已选 {featuredCount}/12）
            </label>
          </div>
        </div>

        {/* ===== hero: gallery left / buy-box right, same as the real page ===== */}
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <CoverDropzone value={form.cover_url ?? ""} onChange={(v) => setForm({ ...form, cover_url: v })} />
            <PasteUrlRow onSubmit={(v) => setForm({ ...form, cover_url: v })} />
            <ThumbGrid images={form.images} onAdd={addImageUrl} onRemove={removeImage} />
            <PasteUrlRow onSubmit={addImageUrl} />
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-full border-2 border-dashed border-brand/40 bg-brand/5 p-0.5 text-[11px] font-semibold uppercase tracking-wider">
                <label
                  className={`flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 ${form.allow_personal ? "bg-foreground text-background" : "text-ink-soft"}`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={!!form.allow_personal}
                    onChange={(e) => setForm({ ...form, allow_personal: e.target.checked })}
                  />
                  个人购买
                </label>
                <label
                  className={`flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 ${form.allow_business ? "bg-foreground text-background" : "text-ink-soft"}`}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={!!form.allow_business}
                    onChange={(e) => setForm({ ...form, allow_business: e.target.checked })}
                  />
                  企业批发
                </label>
              </div>
              {form.allow_business && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
                  MOQ
                  <input
                    type="number"
                    value={String(form.moq ?? 1)}
                    onChange={(e) => setForm({ ...form, moq: Number(e.target.value) || 1 })}
                    className="w-10 border-b border-dashed border-amber-500 bg-transparent text-center outline-none"
                  />
                </span>
              )}
              <span className="rounded-md border border-border bg-muted px-2 py-0.5 text-[11px] text-ink-soft">
                库存 {isNew ? "新建后到「库存流水」入库" : (totalStock ?? "—")}
              </span>
            </div>

            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="商品名"
              className={`${editableCls} font-display text-2xl font-bold sm:text-3xl`}
            />
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input
                value={form.name_en ?? ""}
                onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                placeholder="Name (English)"
                className={editableSmCls + " w-full"}
              />
              <input
                value={form.brand ?? ""}
                onChange={(e) => setForm({ ...form, brand: e.target.value })}
                placeholder="品牌"
                className={editableSmCls + " w-full"}
              />
            </div>

            <textarea
              value={form.description ?? ""}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="商品简介"
              rows={2}
              className={`${editableCls} mt-3 resize-y text-ink-soft`}
            />
            <textarea
              value={form.description_en ?? ""}
              onChange={(e) => setForm({ ...form, description_en: e.target.value })}
              placeholder="Description (English)"
              rows={2}
              className={`${editableCls} mt-2 resize-y text-ink-soft`}
            />

            <div className="mt-3 flex items-center gap-2 text-ink-soft">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-muted">
                <Share2 className="h-3.5 w-3.5" />
              </span>
              <span className="rounded-full border border-border bg-muted px-2 py-1 text-[11px]">
                分享按钮 · 前台固定功能，无需设置
              </span>
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-surface p-6">
              <div className="flex items-baseline gap-3">
                <span className="text-xs text-ink-soft">¥</span>
                <input
                  type="number"
                  value={String(form.price_cny ?? "")}
                  onChange={(e) => setForm({ ...form, price_cny: Number(e.target.value) || 0 })}
                  className={`${editableCls} w-32 font-display text-3xl font-bold text-brand`}
                />
                <span className="text-xs text-ink-soft">对比价 CAD</span>
                <input
                  type="number"
                  value={String(form.compare_price_cad ?? "")}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      compare_price_cad: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className={editableSmCls + " w-24"}
                />
              </div>
              {Number(form.customs_mfn_rate ?? 0) +
                Number(form.customs_gst_rate ?? 0) +
                Number(form.customs_antidumping_rate ?? 0) >
                0 && (
                <div className="mt-2 text-xs text-amber-700">
                  按{" "}
                  {(
                    (Number(form.customs_mfn_rate ?? 0) +
                      Number(form.customs_gst_rate ?? 0) +
                      Number(form.customs_antidumping_rate ?? 0)) *
                    100
                  ).toFixed(1)}
                  % 收取关税（MFN+GST+反倾销）— 在下方「商品规格」区块通过 HS Code 设置
                </div>
              )}
            </div>

            <div className="mt-6">
              <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-soft">
                运输方式（勾选后才会显示在这里）
              </div>
              <div className="grid grid-cols-2 gap-3">
                {routes.length === 0 && <div className="col-span-2 text-xs text-ink-soft">暂无启用中的线路</div>}
                {routes.map((r) => {
                  const Icon =
                    r.shipping_method === "sea"
                      ? Ship
                      : r.shipping_method === "express" || r.shipping_method === "truck"
                        ? Truck
                        : r.shipping_method === "warehouse"
                          ? Warehouse
                          : Plane;
                  const on = (form.available_route_codes ?? []).includes(r.code);
                  return (
                    <label
                      key={r.code}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border-2 border-dashed p-3 text-xs ${on ? "border-brand bg-brand/5" : "border-border bg-muted opacity-60"}`}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleRoute(r.code)} className="shrink-0" />
                      <Icon className="h-3.5 w-3.5 shrink-0 text-ink-soft" />
                      <span className="truncate">{r.name_zh}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-display font-bold">规格选择</div>
                <button
                  onClick={addSwatch}
                  className="inline-flex items-center gap-1 rounded-full border-2 border-dashed border-brand/40 px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/5"
                >
                  <Plus className="h-3 w-3" /> 新规格
                </button>
              </div>
              {variants.length === 0 && <div className="text-xs text-ink-soft">暂无规格，前台不显示"规格选择"</div>}
              <div className="flex flex-col gap-2">
                {variants.map((v, i) => {
                  const open = !!expandedVariant[i];
                  return (
                    <div
                      key={v.id ?? i}
                      className="rounded-xl border-2 border-dashed border-brand/40 bg-brand/5 px-3 py-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          value={v.attrs?.color ?? ""}
                          onChange={(e) => updateVariant(i, { attrs: { ...v.attrs, color: e.target.value } })}
                          placeholder="颜色"
                          className="w-14 bg-transparent outline-none"
                        />
                        <span className="text-ink-soft">/</span>
                        <input
                          value={v.attrs?.size ?? ""}
                          onChange={(e) => updateVariant(i, { attrs: { ...v.attrs, size: e.target.value } })}
                          placeholder="尺寸"
                          className="w-14 bg-transparent outline-none"
                        />
                        <span className="text-ink-soft">·¥</span>
                        <input
                          type="number"
                          value={String(v.price_cny ?? "")}
                          onChange={(e) => updateVariant(i, { price_cny: Number(e.target.value) || 0 })}
                          placeholder="价"
                          className="w-14 bg-transparent outline-none"
                        />
                        <span className="font-mono text-ink-soft">SKU</span>
                        <input
                          value={v.sku ?? ""}
                          onChange={(e) => updateVariant(i, { sku: e.target.value })}
                          className="w-28 bg-transparent font-mono outline-none"
                        />
                        <span className="text-ink-soft">· 库存 {v.stock ?? 0}</span>
                        <button
                          onClick={() => setExpandedVariant({ ...expandedVariant, [i]: !open })}
                          className="ml-auto rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] font-semibold text-ink-soft hover:bg-accent"
                        >
                          {open ? "收起重量/包装 ▲" : "设置重量/包装 ▼"}
                        </button>
                        <button
                          onClick={() => removeVariant(i)}
                          className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-muted text-ink-soft hover:bg-rose-500/20 hover:text-rose-500"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>

                      {open && (
                        <div className="mt-2 space-y-2 border-t border-brand/20 pt-2">
                          <div>
                            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-soft">
                              个人采购 · 单件重量/尺寸（不填则用商品默认值）
                            </div>
                            <div className="grid grid-cols-4 gap-1.5">
                              <VariantNum
                                placeholder="重量 kg"
                                value={v.weight_kg}
                                onChange={(x) => updateVariant(i, { weight_kg: x })}
                              />
                              <VariantNum
                                placeholder="长 cm"
                                value={v.length_cm}
                                onChange={(x) => updateVariant(i, { length_cm: x })}
                              />
                              <VariantNum
                                placeholder="宽 cm"
                                value={v.width_cm}
                                onChange={(x) => updateVariant(i, { width_cm: x })}
                              />
                              <VariantNum
                                placeholder="高 cm"
                                value={v.height_cm}
                                onChange={(x) => updateVariant(i, { height_cm: x })}
                              />
                            </div>
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-soft">
                              商业采购 · 包装件数/重量/尺寸/体积（不填则用商品默认值）
                            </div>
                            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                              <VariantNum
                                placeholder="内件数"
                                value={v.pack_qty}
                                onChange={(x) => updateVariant(i, { pack_qty: x })}
                              />
                              <VariantNum
                                placeholder="重量 kg"
                                value={v.pack_weight_kg}
                                onChange={(x) => updateVariant(i, { pack_weight_kg: x })}
                              />
                              <VariantNum
                                placeholder="长 cm"
                                value={v.pack_length_cm}
                                onChange={(x) => updateVariant(i, { pack_length_cm: x })}
                              />
                              <VariantNum
                                placeholder="宽 cm"
                                value={v.pack_width_cm}
                                onChange={(x) => updateVariant(i, { pack_width_cm: x })}
                              />
                              <VariantNum
                                placeholder="高 cm"
                                value={v.pack_height_cm}
                                onChange={(x) => updateVariant(i, { pack_height_cm: x })}
                              />
                              <VariantNum
                                placeholder="体积 m³"
                                value={v.pack_volume_m3}
                                onChange={(x) => updateVariant(i, { pack_volume_m3: x })}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {variants.length > 0 && (
                <p className="mt-2 text-[10.5px] text-ink-soft">
                  SKU 可手动改；库存请到「库存流水」页面调整。重量/包装留空的规格，下单时按商品默认值计费。
                </p>
              )}
            </div>

            <div className="mt-6 flex items-stretch gap-3 opacity-60">
              <div className="inline-flex items-center rounded-full border border-border bg-muted">
                <span className="grid h-11 w-11 place-items-center text-ink-soft">
                  <Minus className="h-4 w-4" />
                </span>
                <span className="w-10 text-center text-sm font-semibold">1</span>
                <span className="grid h-11 w-11 place-items-center text-ink-soft">
                  <Plus className="h-4 w-4" />
                </span>
              </div>
              <div className="flex flex-1 items-center justify-center gap-2 rounded-full border border-border bg-muted text-xs text-ink-soft">
                <ShoppingCart className="h-3.5 w-3.5" /> 加购按钮 · 前台交互功能，无需设置
              </div>
            </div>
          </div>
        </div>

        {/* ===== 运费与包装规格 —— 合并运费公式 / 个人包装规格 / 线路匹配 ===== */}
        <Card title="运费与包装规格" hint="对应前台「运费试算」">
          {form.allow_personal && (
            <div>
              <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-soft">个人采购运费公式</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>计费方式</Label>
                  <select
                    value={form.personal_freight_mode}
                    onChange={(e) => setForm({ ...form, personal_freight_mode: e.target.value })}
                    className={editableSmCls + " w-full"}
                  >
                    <option value="follow_route">沿用线路（单件计费重 × 线路单价）</option>
                    <option value="per_unit">按数量（预设单件运费）</option>
                  </select>
                </div>
                {form.personal_freight_mode === "per_unit" && (
                  <>
                    <div>
                      <Label>单件预设运费 · 空运 CNY</Label>
                      <input
                        type="number"
                        value={String(form.personal_per_unit_freight_air_cny ?? 0)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            personal_per_unit_freight_air_cny: Number(e.target.value) || 0,
                          })
                        }
                        className={editableSmCls + " w-full"}
                      />
                    </div>
                    <div>
                      <Label>单件预设运费 · 海运 CNY</Label>
                      <input
                        type="number"
                        value={String(form.personal_per_unit_freight_sea_cny ?? 0)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            personal_per_unit_freight_sea_cny: Number(e.target.value) || 0,
                          })
                        }
                        className={editableSmCls + " w-full"}
                      />
                    </div>
                  </>
                )}
              </div>
              <p className="mt-2 text-[11px] text-ink-soft">
                「沿用线路」模式所需的单件重量/尺寸、以及按箱计费所需的「内件数/包装重量/尺寸」，统一在下方「商品规格」区块设置——个人和商业两种采购模式的默认值都在那一张卡片里，不用来回找。
              </p>
            </div>
          )}

          <div className={form.allow_personal ? "mt-5 border-t border-border pt-5" : ""}>
            <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-soft">
              线路匹配（采购模式 × 运输方式 各选一条，用于实际计价）
            </div>
            {routes.length === 0 ? (
              <div className="text-xs text-ink-soft">暂无启用中的线路</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {(
                  [
                    ["personal", "air", "personal_air_route_code", "个人采购 · 空运"],
                    ["personal", "sea", "personal_sea_route_code", "个人采购 · 海运"],
                    ["business", "air", "business_air_route_code", "商业采购 · 空运"],
                    ["business", "sea", "business_sea_route_code", "商业采购 · 海运"],
                  ] as const
                ).map(([mode, method, field, label]) => {
                  const enabled = mode === "personal" ? form.allow_personal : form.allow_business;
                  const candidates = routes.filter(
                    (r) =>
                      r.shipping_method === method && (r.cargo_type ?? "general") === (form.cargo_type ?? "general"),
                  );
                  return (
                    <div key={field}>
                      <Label>
                        {label}
                        {enabled ? "" : "（未启用该采购模式）"}
                      </Label>
                      <select
                        value={form[field] ?? ""}
                        disabled={!enabled}
                        onChange={(e) => setForm({ ...form, [field]: e.target.value || null })}
                        className={editableSmCls + " w-full disabled:opacity-40"}
                      >
                        <option value="">— 未选择 —</option>
                        {candidates.map((r) => (
                          <option key={r.code} value={r.code}>
                            {r.code} · {r.name_zh}
                            {r.destination_code ? ` → ${r.destination_code}` : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-5 border-t border-border pt-5">
            <Label>货物类型（影响上方线路匹配结果）</Label>
            <select
              value={form.cargo_type ?? "general"}
              onChange={(e) => setForm({ ...form, cargo_type: e.target.value })}
              className={editableSmCls + " w-full sm:w-64"}
            >
              <option value="general">普货</option>
              <option value="sensitive">敏感货</option>
            </select>
          </div>
        </Card>

        {/* ===== 货源地 ===== */}
        <Card title="货源地" hint="对应前台「货源信息」卡片">
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-brand">
              <MapPin className="h-4 w-4" />
            </span>
            <div className="flex-1 space-y-1.5">
              <input
                value={form.origin_location ?? ""}
                onChange={(e) => setForm({ ...form, origin_location: e.target.value })}
                placeholder="例：浙江宁波"
                className={editableCls}
              />
              <input
                value={form.origin_location_en ?? ""}
                onChange={(e) => setForm({ ...form, origin_location_en: e.target.value })}
                placeholder="EN · e.g. Ningbo, Zhejiang"
                className={editableCls}
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-ink-soft">
            留空则前台不显示这张卡片；英文留空时英文页面会显示中文原文兜底。跟下面仅后台可见的「生产厂家信息」是两组独立字段。
          </p>
        </Card>

        {/* ===== 生产厂家信息 —— 仅后台可见，不走"可编辑=前台可见"的虚线蓝框样式，
             用中性灰底 + 锁形标注，跟货源地区分开，提醒这组信息不会出现在前台 ===== */}
        <Card title="生产厂家信息" hint="🔒 仅后台可见，不会出现在前台任何位置">
          <div className="grid gap-3 rounded-2xl border border-border bg-muted p-5 sm:grid-cols-2">
            <div>
              <Label>厂家名称</Label>
              <input
                value={form.manufacturer ?? ""}
                onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                className={lockedInputCls}
              />
            </div>
            <div>
              <Label>联系人</Label>
              <input
                value={form.manufacturer_contact?.contact ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    manufacturer_contact: { ...form.manufacturer_contact, contact: e.target.value },
                  })
                }
                className={lockedInputCls}
              />
            </div>
            <div>
              <Label>电话</Label>
              <input
                value={form.manufacturer_contact?.phone ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    manufacturer_contact: { ...form.manufacturer_contact, phone: e.target.value },
                  })
                }
                className={lockedInputCls}
              />
            </div>
            <div>
              <Label>网址</Label>
              <input
                value={form.manufacturer_contact?.website ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    manufacturer_contact: { ...form.manufacturer_contact, website: e.target.value },
                  })
                }
                className={lockedInputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <Label>地址</Label>
              <input
                value={form.manufacturer_contact?.address ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    manufacturer_contact: { ...form.manufacturer_contact, address: e.target.value },
                  })
                }
                className={lockedInputCls}
              />
            </div>
          </div>
        </Card>

        {/* ===== 商品规格 —— 集中显示：品牌已在上面标题区编辑；这里是 HS Code + 个人/商业两种
             采购模式各自的默认重量/尺寸/包装参数。跟「运费与包装规格」「规格选择」里说的一样，
             这一张卡片就是"商品默认值"的唯一出处，某个 SKU 没单独设置时就退回用这里的数值。 ===== */}
        <Card title="商品规格" hint="对应前台「商品规格」表 · 也是个人/商业采购的默认重量与包装值">
          <div className="sm:col-span-2">
            <Label>HS Code（查询后自动带出关税率）</Label>
            <HsCodeField form={form} setForm={setForm} />
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-soft">
              个人采购 · 单件重量/尺寸（默认值，某个规格没单独设置时用这个）
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <Label>重量 kg</Label>
                <input
                  type="number"
                  value={String(form.weight_kg ?? "")}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      weight_kg: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className={editableSmCls + " w-full"}
                />
              </div>
              <div>
                <Label>长 cm</Label>
                <input
                  type="number"
                  value={String(form.length_cm ?? "")}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      length_cm: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className={editableSmCls + " w-full"}
                />
              </div>
              <div>
                <Label>宽 cm</Label>
                <input
                  type="number"
                  value={String(form.width_cm ?? "")}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      width_cm: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className={editableSmCls + " w-full"}
                />
              </div>
              <div>
                <Label>高 cm</Label>
                <input
                  type="number"
                  value={String(form.height_cm ?? "")}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      height_cm: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className={editableSmCls + " w-full"}
                />
              </div>
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-soft">
              商业采购 · 包装件数/重量/尺寸/体积（默认值，某个规格没单独设置时用这个）
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>每包装件数</Label>
                <input
                  type="number"
                  value={String(form.pack_qty ?? 1)}
                  onChange={(e) => setForm({ ...form, pack_qty: Number(e.target.value) || 1 })}
                  className={editableSmCls + " w-full"}
                />
              </div>
              <div>
                <Label>包装重量 kg</Label>
                <input
                  type="number"
                  value={String(form.pack_weight_kg ?? "")}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      pack_weight_kg: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className={editableSmCls + " w-full"}
                />
              </div>
              <div>
                <Label>包装体积 m³</Label>
                <input
                  type="number"
                  value={String(form.pack_volume_m3 ?? "")}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      pack_volume_m3: e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                  className={editableSmCls + " w-full"}
                />
              </div>
              <div>
                <Label>包装长×宽×高 cm</Label>
                <div className="flex gap-1.5">
                  <input
                    type="number"
                    value={String(form.pack_length_cm ?? "")}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        pack_length_cm: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className={editableSmCls + " w-full"}
                  />
                  <input
                    type="number"
                    value={String(form.pack_width_cm ?? "")}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        pack_width_cm: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className={editableSmCls + " w-full"}
                  />
                  <input
                    type="number"
                    value={String(form.pack_height_cm ?? "")}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        pack_height_cm: e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                    className={editableSmCls + " w-full"}
                  />
                </div>
              </div>
            </div>
          </div>
        </Card>

        {/* ===== 包装与发货说明 ===== */}
        <Card title="包装与发货" hint="对应前台「包装与发货」卡片">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>包装规格说明</Label>
              <textarea
                value={form.packaging_note ?? ""}
                onChange={(e) => setForm({ ...form, packaging_note: e.target.value })}
                rows={2}
                placeholder="例：独立吸塑卡装"
                className={editableCls}
              />
              <textarea
                value={form.packaging_note_en ?? ""}
                onChange={(e) => setForm({ ...form, packaging_note_en: e.target.value })}
                rows={2}
                placeholder="EN · e.g. Individually blister-packed"
                className={editableCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label>生产周期说明</Label>
              <textarea
                value={form.lead_time_note ?? ""}
                onChange={(e) => setForm({ ...form, lead_time_note: e.target.value })}
                rows={2}
                placeholder="例：现货 1-2 天发出"
                className={editableCls}
              />
              <textarea
                value={form.lead_time_note_en ?? ""}
                onChange={(e) => setForm({ ...form, lead_time_note_en: e.target.value })}
                rows={2}
                placeholder="EN · e.g. Ships in 1-2 days"
                className={editableCls}
              />
            </div>
            <div className="space-y-1.5">
              <Label>起运地说明</Label>
              <textarea
                value={form.origin_port_note ?? ""}
                onChange={(e) => setForm({ ...form, origin_port_note: e.target.value })}
                rows={2}
                placeholder="例：宁波北仑港"
                className={editableCls}
              />
              <textarea
                value={form.origin_port_note_en ?? ""}
                onChange={(e) => setForm({ ...form, origin_port_note_en: e.target.value })}
                rows={2}
                placeholder="EN · e.g. Ningbo Beilun Port"
                className={editableCls}
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-ink-soft">
            三项都留空则前台不显示这个模块；英文留空时英文页面显示中文原文兜底。
          </p>
        </Card>

        {/* ===== 商品亮点 / 保障文案 ===== */}
        <Card title="商品亮点" hint="逐商品可编辑的前台保障文案">
          <div className="mb-2 flex justify-end">
            <button
              onClick={addTrust}
              className="inline-flex items-center gap-1 rounded-full border-2 border-dashed border-brand/40 px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/5"
            >
              <Plus className="h-3 w-3" /> 添加一行
            </button>
          </div>
          {form.trust_points.length === 0 && <div className="text-xs text-ink-soft">暂无内容，前台不显示该列表</div>}
          <div className="space-y-2">
            {form.trust_points.map((p: any, i: number) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-success">✓</span>
                <input
                  value={p.text ?? ""}
                  onChange={(e) => updateTrust(i, { text: e.target.value })}
                  placeholder="中文"
                  className={editableCls + " flex-1"}
                />
                <input
                  value={p.text_en ?? ""}
                  onChange={(e) => updateTrust(i, { text_en: e.target.value })}
                  placeholder="EN"
                  className={editableCls + " flex-1"}
                />
                <button onClick={() => removeTrust(i)} className="text-rose-500 hover:text-rose-600">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </Card>

        {/* ===== 商品详情（图文/视频） ===== */}
        <Card title="商品详情" hint="图文 / 视频块，对应前台「商品详情」">
          <div className="mb-3 flex gap-2">
            <button
              onClick={() => addBlock("image")}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1.5 text-xs hover:bg-accent"
            >
              <ImageIcon className="h-3 w-3" />
              图片块
            </button>
            <button
              onClick={() => addBlock("video")}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1.5 text-xs hover:bg-accent"
            >
              <Video className="h-3 w-3" />
              视频块
            </button>
            <button
              onClick={() => addBlock("text")}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-3 py-1.5 text-xs hover:bg-accent"
            >
              <FileText className="h-3 w-3" />
              文本块
            </button>
          </div>
          {form.detail_blocks.length === 0 && <div className="text-xs text-ink-soft">暂无详情内容</div>}
          <div className="space-y-3">
            {form.detail_blocks.map((b: any, i: number) => (
              <div key={i} className="rounded-xl border border-border bg-muted p-3">
                <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-soft">
                  <span>
                    #{i + 1} · {b.type}
                  </span>
                  <button onClick={() => removeBlock(i)} className="text-rose-500 hover:text-rose-600">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                {b.type === "text" ? (
                  <div className="space-y-1.5">
                    <textarea
                      value={b.content ?? ""}
                      onChange={(e) => updateBlock(i, { content: e.target.value })}
                      rows={3}
                      className={editableCls}
                    />
                    <textarea
                      value={b.content_en ?? ""}
                      onChange={(e) => updateBlock(i, { content_en: e.target.value })}
                      rows={3}
                      placeholder="EN"
                      className={editableCls}
                    />
                  </div>
                ) : (
                  <MediaUpload
                    value={b.url ?? ""}
                    onChange={(v) => updateBlock(i, { url: v })}
                    accept={b.type === "video" ? "video/*" : "image/*"}
                    variant="light"
                  />
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* ===== 常见问题 FAQ ===== */}
        <Card title="常见问题" hint="以手风琴形式展示在前台">
          <div className="mb-3 flex justify-end">
            <button
              onClick={addFaq}
              className="inline-flex items-center gap-1 rounded-full border-2 border-dashed border-brand/40 px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/5"
            >
              <Plus className="h-3 w-3" /> 添加问题
            </button>
          </div>
          {form.faq_items.length === 0 && <div className="text-xs text-ink-soft">暂无常见问题，前台不显示该模块</div>}
          <div className="space-y-2">
            {form.faq_items.map((f: any, i: number) => (
              <div key={i} className="rounded-xl border border-border bg-muted p-3">
                <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-soft">
                  <span>#{i + 1}</span>
                  <button onClick={() => removeFaq(i)} className="text-rose-500 hover:text-rose-600">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
                <input
                  value={f.q ?? ""}
                  onChange={(e) => updateFaq(i, { q: e.target.value })}
                  placeholder="问题"
                  className={editableCls}
                />
                <textarea
                  value={f.a ?? ""}
                  onChange={(e) => updateFaq(i, { a: e.target.value })}
                  rows={2}
                  placeholder="答案"
                  className={editableCls + " mt-1.5"}
                />
                <input
                  value={f.q_en ?? ""}
                  onChange={(e) => updateFaq(i, { q_en: e.target.value })}
                  placeholder="Question (EN)"
                  className={editableCls + " mt-1.5"}
                />
                <textarea
                  value={f.a_en ?? ""}
                  onChange={(e) => updateFaq(i, { a_en: e.target.value })}
                  rows={2}
                  placeholder="Answer (EN)"
                  className={editableCls + " mt-1.5"}
                />
              </div>
            ))}
          </div>
        </Card>

        <p className="mt-6 text-center text-[11px] text-ink-soft">相关推荐按同分类自动生成，无需在这里设置</p>
      </div>
    </div>
  );
}

const utilInputCls =
  "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-brand focus:outline-none";

function UtilField({ label, children }: { label: string; children: any }) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-soft">{label}</div>
      {children}
    </div>
  );
}

function Label({ children }: { children: any }) {
  return <div className="mb-1 text-[10.5px] uppercase tracking-wider text-ink-soft">{children}</div>;
}

// Small numeric field for the per-variant weight/packaging rows. Empty input = null
// (falls back to the product-level value at checkout), not 0.
function VariantNum({
  value,
  onChange,
  placeholder,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  placeholder: string;
}) {
  return (
    <input
      type="number"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      placeholder={placeholder}
      className="w-full rounded-md border border-border bg-surface px-1.5 py-1 text-[11px] focus:border-brand focus:outline-none"
    />
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: any }) {
  return (
    <section className="mt-10 border-t border-border pt-8">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {hint && <span className="text-[11px] text-ink-soft">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function CoverDropzone({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const handle = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      onChange(await uploadShopMedia(f));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handle(e.dataTransfer.files?.[0]);
      }}
      className={`relative aspect-square overflow-hidden rounded-3xl border-2 border-dashed transition ${drag ? "border-brand bg-brand/10" : "border-brand/40 bg-gradient-to-br from-accent via-surface to-accent"}`}
    >
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      {value ? (
        <img src={value} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="grid h-full place-items-center">
          <div className="text-5xl">🖼️</div>
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 bg-gradient-to-t from-black/50 to-transparent p-4">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-xs font-semibold shadow-elevated disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {value ? "更换封面图" : "上传封面图"}
        </button>
        <span className="text-[10.5px] text-white/80">拖拽图片到此处，或点击上传</span>
      </div>
    </div>
  );
}

function PasteUrlRow({ onSubmit }: { onSubmit: (url: string) => void }) {
  const [url, setUrl] = useState("");
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="或粘贴图片 URL 后按回车"
        onKeyDown={(e) => {
          if (e.key === "Enter" && url.trim()) {
            onSubmit(url.trim());
            setUrl("");
          }
        }}
        className="flex-1 rounded-md border border-border bg-muted px-2 py-1 text-[11px] text-foreground focus:border-brand focus:outline-none"
      />
    </div>
  );
}

function ThumbGrid({
  images,
  onAdd,
  onRemove,
}: {
  images: string[];
  onAdd: (url: string) => void;
  onRemove: (i: number) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const handle = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      onAdd(await uploadShopMedia(f));
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 grid grid-cols-5 gap-2">
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => handle(e.target.files?.[0])} />
      {images.map((url, i) => (
        <div key={i} className="group relative aspect-square overflow-hidden rounded-lg border-2 border-border">
          <img src={url} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition group-hover:opacity-100"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      {images.length < 5 && (
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="grid aspect-square place-items-center rounded-lg border-2 border-dashed border-brand/40 text-brand hover:bg-brand/5 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

// HS Code 搜索 + 选择：选中后把 HS 编码库里的 MFN / GST / 反倾销税率抄一份到
// 商品自己的 customs_*_rate 字段（下单计价直接读这三个字段）。税率只读展示，
// 不再支持逐商品手动敲百分比——要调整某个编码本身的税率，去 HS 编码库改。
function HsCodeField({ form, setForm }: { form: any; setForm: (f: any) => void }) {
  const searchFn = useServerFn(listHsCodes);
  const [open, setOpen] = useState(false);
  const [kw, setKw] = useState("");
  const listQ = useQuery({
    queryKey: ["hs-search-product", kw],
    queryFn: () => searchFn({ data: { search: kw || undefined } }),
    enabled: open,
  });
  const totalRate =
    (Number(form.customs_mfn_rate ?? 0) +
      Number(form.customs_gst_rate ?? 0) +
      Number(form.customs_antidumping_rate ?? 0)) *
    100;

  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          value={form.hs_code ?? ""}
          onChange={(e) => setForm({ ...form, hs_code: e.target.value })}
          className={editableCls}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-3 py-2 text-xs hover:bg-accent"
        >
          <Search className="h-3.5 w-3.5" />
          查询
        </button>
      </div>

      {open && (
        <div className="mt-2 rounded-xl border border-border bg-muted p-2">
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜索 HS 编码 / 品名"
            className="mb-2 w-full rounded-md border border-border bg-surface px-2 py-1 text-xs focus:border-brand focus:outline-none"
          />
          <div className="max-h-56 space-y-0.5 overflow-y-auto text-xs">
            {(listQ.data?.items ?? []).slice(0, 20).map((h: any) => (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  setForm({
                    ...form,
                    hs_code: h.hs_code,
                    customs_mfn_rate: Number(h.mfn_rate) || 0,
                    customs_gst_rate: Number(h.gst_rate) || 0,
                    customs_antidumping_rate: Number(h.anti_dumping_rate) || 0,
                  });
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left hover:bg-accent"
              >
                <span>
                  <span className="font-mono">{h.hs_code}</span> · {h.name_zh}
                </span>
                <span className="text-ink-soft">{(Number(h.mfn_rate) * 100).toFixed(1)}%</span>
              </button>
            ))}
            {(listQ.data?.items ?? []).length === 0 && !listQ.isLoading && (
              <div className="p-2 text-center text-ink-soft">
                无结果 —
                <a
                  href={`/admin/hs-codes${kw ? `?prefill=${encodeURIComponent(kw)}` : ""}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 text-brand hover:underline"
                >
                  去 HS 编码库新增
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg border border-border bg-muted p-2">
          <div className="text-ink-soft">MFN</div>
          <div className="font-semibold">{(Number(form.customs_mfn_rate ?? 0) * 100).toFixed(1)}%</div>
        </div>
        <div className="rounded-lg border border-border bg-muted p-2">
          <div className="text-ink-soft">GST</div>
          <div className="font-semibold">{(Number(form.customs_gst_rate ?? 0) * 100).toFixed(1)}%</div>
        </div>
        <div className="rounded-lg border border-border bg-muted p-2">
          <div className="text-ink-soft">反倾销</div>
          <div className="font-semibold">{(Number(form.customs_antidumping_rate ?? 0) * 100).toFixed(1)}%</div>
        </div>
      </div>
      <p className="mt-1 text-[11px] text-ink-soft">
        合计 {totalRate.toFixed(1)}%。税率来自 HS 编码库，编码本身的税率填错了请去{" "}
        <a href="/admin/hs-codes" target="_blank" rel="noreferrer" className="text-brand hover:underline">
          HS 编码库
        </a>{" "}
        改，用到该编码的商品都会一起更新。
      </p>
    </div>
  );
}
