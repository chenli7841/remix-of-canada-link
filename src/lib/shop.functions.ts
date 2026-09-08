import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAdminLog } from "@/lib/admin-log";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden: staff only");
}

// ============ CATEGORIES ============
export const listCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("product_categories").select("*").order("sort_order");
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const saveCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...rest } = data;
    const op = id
      ? supabaseAdmin.from("product_categories").update(rest).eq("id", id)
      : supabaseAdmin.from("product_categories").insert(rest).select("id").single();
    const { data: saved, error } = await op;
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_category",
      entity_id: id ?? (saved as any)?.id ?? "unknown",
      action: id ? "update" : "create",
      after: rest,
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const deleteCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("product_categories").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("product_categories").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_category",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ============ PRODUCTS ============
export const listProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      d: {
        page?: number;
        pageSize?: number;
        q?: string;
        status?: string;
        category_id?: string;
      } = {},
    ) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, data.pageSize ?? 20);
    let q = supabaseAdmin
      .from("products")
      .select("*, category:product_categories(name)", { count: "exact" })
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status as any);
    if (data.category_id) q = q.eq("category_id", data.category_id);
    if (data.q) q = q.or(`name.ilike.%${data.q}%,sku.ilike.%${data.q}%`);
    const { data: rows, error, count } = await q.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    return { items: rows ?? [], total: count ?? 0, page, pageSize };
  });

export const getProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: product }, { data: variants }] = await Promise.all([
      supabaseAdmin.from("products").select("*, category:product_categories(id,name)").eq("id", data.id).maybeSingle(),
      supabaseAdmin.from("product_variants").select("*").eq("product_id", data.id).order("created_at"),
    ]);
    if (!product) throw new Error("Not found");
    const variantIds = (variants ?? []).map((v: any) => v.id);
    let stocks: any[] = [];
    if (variantIds.length) {
      const { data: s } = await supabaseAdmin
        .from("variant_stocks")
        .select("variant_id, warehouse_id, stock, warehouse:warehouses(code, name_zh)")
        .in("variant_id", variantIds);
      stocks = s ?? [];
    }
    return { product, variants: variants ?? [], stocks };
  });

export const saveProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, variants, category, total_stock, sold_count, created_at, updated_at, ...rest } = data;
    // strip joined / computed fields that are not real columns on products
    void category;
    void total_stock;
    void sold_count;
    void created_at;
    void updated_at;
    if (rest.is_featured) {
      let countQ = supabaseAdmin.from("products").select("id", { count: "exact", head: true }).eq("is_featured", true);
      if (id) countQ = countQ.neq("id", id);
      const { count, error: countErr } = await countQ;
      if (countErr) throw new Error(countErr.message);
      if ((count ?? 0) >= 12) throw new Error("本周精选最多只能选择 12 个商品，请先取消其他商品的精选");
    }
    let pid = id;
    if (id) {
      const { error } = await supabaseAdmin.from("products").update(rest).eq("id", id);
      if (error) throw new Error(error.message);
    } else {
      const { data: inserted, error } = await supabaseAdmin.from("products").insert(rest).select("id").single();
      if (error) throw new Error(error.message);
      pid = inserted!.id;
    }
    if (Array.isArray(variants)) {
      for (const v of variants) {
        const { id: vid, ...vrest } = v;
        if (vid && !String(vid).startsWith("new_")) {
          await supabaseAdmin
            .from("product_variants")
            .update({ ...vrest, product_id: pid })
            .eq("id", vid);
        } else {
          await supabaseAdmin.from("product_variants").insert({ ...vrest, product_id: pid });
        }
      }
    }
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_product",
      entity_id: pid,
      action: id ? "update" : "create",
      after: {
        name: rest.name,
        sku: rest.sku,
        status: rest.status,
        variant_count: Array.isArray(variants) ? variants.length : 0,
      },
      operator_id: context.userId,
    });
    return { ok: true, id: pid };
  });

export const setProductStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[]; status: "draft" | "active" | "archived" }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("products").update({ status: data.status }).in("id", data.ids);
    if (error) throw new Error(error.message);
    await Promise.all(
      data.ids.map((pid) =>
        recordAdminLog(supabaseAdmin, {
          entity_type: "shop_product",
          entity_id: pid,
          action: "set_status",
          after: { status: data.status },
          operator_id: context.userId,
          note: data.ids.length > 1 ? `批量更改 ${data.ids.length} 个商品状态` : undefined,
        }),
      ),
    );
    return { ok: true, count: data.ids.length };
  });

// ============ INVENTORY ============
export const adjustStock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { variant_id: string; warehouse_id: string; qty_delta: number; reason: string; note?: string }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    if (!data.warehouse_id) throw new Error("请选择仓库");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("inventory_movements").insert({
      variant_id: data.variant_id,
      warehouse_id: data.warehouse_id,
      qty_delta: data.qty_delta,
      reason: data.reason as any,
      ref_type: "manual",
      operator_id: context.userId,
      note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_stock",
      entity_id: data.variant_id,
      action: "adjust_stock",
      after: { warehouse_id: data.warehouse_id, qty_delta: data.qty_delta, reason: data.reason },
      operator_id: context.userId,
      note: data.note,
    });
    return { ok: true };
  });

export const listInventoryMovements = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { page?: number; pageSize?: number; variant_id?: string; warehouse_id?: string } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, data.pageSize ?? 30);
    let q = supabaseAdmin
      .from("inventory_movements")
      .select("*, variant:product_variants(sku, product:products(name)), warehouse:warehouses(code, name_zh)", {
        count: "exact",
      })
      .order("created_at", { ascending: false });
    if (data.variant_id) q = q.eq("variant_id", data.variant_id);
    if (data.warehouse_id) q = q.eq("warehouse_id", data.warehouse_id);
    const { data: rows, count, error } = await q.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    return { items: rows ?? [], total: count ?? 0, page, pageSize };
  });

// ============ SHOP ORDERS (统一 orders 表, source='shop') ============
const SHOP_STATUS_MAP: Record<string, string> = {
  pending_pay: "pending",
  paid: "paid",
  shipped: "shipped",
  completed: "delivered",
  refunded: "cancelled",
  cancelled: "cancelled",
};

export const listShopOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { page?: number; pageSize?: number; status?: string; q?: string } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, data.pageSize ?? 20);
    let q = supabaseAdmin
      .from("orders")
      .select("*", { count: "exact" })
      .eq("source", "shop")
      .order("created_at", { ascending: false });
    if (data.status) {
      const mapped = SHOP_STATUS_MAP[data.status] ?? data.status;
      q = q.eq("status", mapped as any);
    }
    if (data.q) q = q.ilike("order_no", `%${data.q}%`);
    const { data: rows, error, count } = await q.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id).filter(Boolean)));
    const profMap: Record<string, any> = {};
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, email, customer_code")
        .in("id", userIds);
      for (const p of (profs ?? []) as any[]) profMap[p.id] = p;
    }
    const orderIds = (rows ?? []).map((r: any) => r.id);
    const wbCountMap: Record<string, number> = {};
    if (orderIds.length) {
      const { data: wbs } = await supabaseAdmin.from("waybills").select("order_id").in("order_id", orderIds);
      for (const w of (wbs ?? []) as any[]) if (w.order_id) wbCountMap[w.order_id] = (wbCountMap[w.order_id] ?? 0) + 1;
    }
    const items = (rows ?? []).map((r: any) => ({
      ...r,
      user: profMap[r.user_id] ?? null,
      waybill_count: wbCountMap[r.id] ?? 0,
    }));
    return { items, total: count ?? 0, page, pageSize };
  });

export const getShopOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [orderR, itemsR, refundsR, waybillsR] = await Promise.all([
      supabaseAdmin.from("orders").select("*").eq("id", data.id).maybeSingle(),
      supabaseAdmin.from("order_items").select("*").eq("order_id", data.id),
      supabaseAdmin.from("shop_refunds").select("*").eq("order_id", data.id).order("created_at", { ascending: false }),
      supabaseAdmin
        .from("waybills")
        .select("id, waybill_no, status, payment_status, assigned_batch_id, batch_no")
        .eq("order_id", data.id),
    ]);
    const order: any = orderR.data;
    if (!order) throw new Error("Not found");
    const { data: user } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, email, customer_code")
      .eq("id", order.user_id)
      .maybeSingle();
    return {
      order: { ...order, user },
      items: itemsR.data ?? [],
      refunds: refundsR.data ?? [],
      waybills: waybillsR.data ?? [],
    };
  });

export const updateShopOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const mapped = SHOP_STATUS_MAP[data.status] ?? data.status;
    const patch: any = { status: mapped };
    if (data.status === "paid") patch.paid_at = new Date().toISOString();
    if (data.status === "shipped") patch.shipped_at = new Date().toISOString();
    if (data.status === "completed") patch.completed_at = new Date().toISOString();
    const { error } = await supabaseAdmin.from("orders").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_order",
      entity_id: data.id,
      action: "update_status",
      after: { status: mapped },
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const createRefund = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { order_id: string; amount_cny: number; reason?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("shop_refunds").insert({
      order_id: data.order_id,
      amount_cny: data.amount_cny,
      reason: data.reason ?? null,
      status: "approved",
      operator_id: context.userId,
      processed_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("orders").update({ status: "cancelled" }).eq("id", data.order_id);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_order",
      entity_id: data.order_id,
      action: "refund",
      after: { amount_cny: data.amount_cny, reason: data.reason },
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ============ COUPONS ============
export const listCoupons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("coupons").select("*").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const saveCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...rest } = data;
    const op = id
      ? supabaseAdmin.from("coupons").update(rest).eq("id", id)
      : supabaseAdmin.from("coupons").insert(rest).select("id").single();
    const { data: saved, error } = await op;
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_coupon",
      entity_id: id ?? (saved as any)?.id,
      action: id ? "update" : "create",
      after: rest,
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const deleteCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("coupons").select("*").eq("id", data.id).maybeSingle();
    await supabaseAdmin.from("coupons").delete().eq("id", data.id);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_coupon",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ============ BANNERS ============
export const listBanners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.from("cms_banners").select("*").order("sort_order");
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const saveBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...rest } = data;
    const op = id
      ? supabaseAdmin.from("cms_banners").update(rest).eq("id", id)
      : supabaseAdmin.from("cms_banners").insert(rest).select("id").single();
    const { data: saved, error } = await op;
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_banner",
      entity_id: id ?? (saved as any)?.id,
      action: id ? "update" : "create",
      after: rest,
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const deleteBanner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("cms_banners").select("*").eq("id", data.id).maybeSingle();
    await supabaseAdmin.from("cms_banners").delete().eq("id", data.id);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_banner",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ============ ARTICLES ============
export const listArticles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("cms_articles")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const saveArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: any) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { id, ...rest } = data;
    if (rest.status === "published" && !rest.published_at) rest.published_at = new Date().toISOString();
    const op = id
      ? supabaseAdmin.from("cms_articles").update(rest).eq("id", id)
      : supabaseAdmin
          .from("cms_articles")
          .insert({ ...rest, author_id: context.userId })
          .select("id")
          .single();
    const { data: saved, error } = await op;
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_article",
      entity_id: id ?? (saved as any)?.id,
      action: id ? "update" : "create",
      after: { title: rest.title, status: rest.status },
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const deleteArticle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("cms_articles").select("*").eq("id", data.id).maybeSingle();
    await supabaseAdmin.from("cms_articles").delete().eq("id", data.id);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shop_article",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ============ SHOP DASHBOARD ============
export const getShopDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayISO = today.toISOString();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

    const shopOrders = (q: any) => q.eq("source", "shop");
    const [todayOrdersR, todaySalesR, monthSalesR, pendingShipR, lowStockR, productsR] = await Promise.all([
      shopOrders(supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).gte("created_at", todayISO)),
      shopOrders(
        supabaseAdmin
          .from("orders")
          .select("total_cny")
          .gte("paid_at", todayISO)
          .in("status", ["paid", "shipped", "delivered"] as any),
      ),
      shopOrders(
        supabaseAdmin
          .from("orders")
          .select("total_cny")
          .gte("paid_at", monthStart)
          .in("status", ["paid", "shipped", "delivered"] as any),
      ),
      shopOrders(supabaseAdmin.from("orders").select("id", { count: "exact", head: true }).eq("status", "paid")),
      supabaseAdmin
        .from("product_variants")
        .select("id, sku, stock, product:products(name)")
        .lt("stock", 10)
        .order("stock")
        .limit(10),
      supabaseAdmin.from("products").select("id", { count: "exact", head: true }).eq("status", "active"),
    ]);
    const todaySales = (todaySalesR.data ?? []).reduce((s: number, r: any) => s + Number(r.total_cny || 0), 0);
    const monthSales = (monthSalesR.data ?? []).reduce((s: number, r: any) => s + Number(r.total_cny || 0), 0);

    return {
      kpi: {
        todayOrders: todayOrdersR.count ?? 0,
        todaySalesCNY: +todaySales.toFixed(2),
        monthSalesCNY: +monthSales.toFixed(2),
        pendingShip: pendingShipR.count ?? 0,
        activeProducts: productsR.count ?? 0,
        lowStockCount: (lowStockR.data ?? []).length,
      },
      lowStock: lowStockR.data ?? [],
    };
  });
