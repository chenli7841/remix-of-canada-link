import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertOwner(supabase: any, userId: string) {
  const { data: isOwner } = await supabase.rpc("has_role", { _user_id: userId, _role: "owner" });
  if (!isOwner) throw new Error("Forbidden: owner only");
}

const FW_STATUSES = ["pending", "received", "packed", "shipped", "in_transit", "ready_pickup", "delivered"] as const;

const FW_ITEM_TEMPLATES = [
  { name: "服装鞋帽", unit_price: 80 },
  { name: "电子产品配件", unit_price: 250 },
  { name: "美妆护肤品", unit_price: 180 },
  { name: "食品零食", unit_price: 60 },
  { name: "家居日用品", unit_price: 120 },
  { name: "母婴用品", unit_price: 150 },
  { name: "书籍文具", unit_price: 45 },
  { name: "保健品", unit_price: 320 },
];

// Reset + seed FORWARDING ORDERS (集运订单) with items + waybills (含多运单)
export const resetAndSeedWaybills = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { count?: number } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const target = data.count ?? 50;
    const uid = context.userId;
    const zero = "00000000-0000-0000-0000-000000000000";

    // 1. 清理旧的集运订单 / 派生数据（不影响电商订单）
    await supabaseAdmin.from("invoice_items").delete().neq("id", zero);
    await supabaseAdmin.from("invoices").delete().neq("id", zero);
    await supabaseAdmin.from("waybills").delete().is("order_id", null);
    await supabaseAdmin.from("forwarding_items").delete().neq("id", zero);
    await supabaseAdmin.from("forwarding_orders").delete().neq("id", zero);
    await supabaseAdmin.from("detained_packages").delete().neq("id", zero);

    // 2. 当前用户
    const { data: prof } = await supabaseAdmin.from("profiles").select("customer_code").eq("id", uid).maybeSingle();

    // 3. 路线
    const { data: routes } = await supabaseAdmin
      .from("shipping_routes")
      .select("id, code, destination_code, shipping_method")
      .eq("is_active", true);
    if (!routes?.length) throw new Error("no active routes — create at least one route first");

    // 4. 创建集运订单 + 物品 + 运单（30% 多运单）
    const multiIdx = new Set<number>();
    while (multiIdx.size < Math.floor(target * 0.3)) multiIdx.add(Math.floor(Math.random() * target));

    // Batch cache per route (复用同线路同方式批次)
    const batchCache: Record<string, { id: string; batch_no: string }> = {};
    const ensureBatch = async (route: any) => {
      const key = `${route.shipping_method}|${route.destination_code}|${route.code}`;
      if (batchCache[key]) return batchCache[key];
      const { data: b, error: be } = await supabaseAdmin
        .from("batches")
        .insert({
          shipping_method: route.shipping_method,
          destination_code: route.destination_code,
          planned_ship_date: new Date().toISOString().slice(0, 10),
          status: "planning",
        } as any)
        .select("id, batch_no")
        .single();
      if (be) throw new Error(be.message);
      batchCache[key] = { id: (b as any).id, batch_no: (b as any).batch_no };
      return batchCache[key];
    };

    let fwCreated = 0,
      wbCreated = 0,
      itemsCreated = 0;
    for (let i = 0; i < target; i++) {
      const route: any = routes[i % routes.length];
      const status = FW_STATUSES[i % FW_STATUSES.length];
      const itemCount = 1 + Math.floor(Math.random() * 3);

      // pick items
      const picked = Array.from({ length: itemCount }, () => {
        const tpl = FW_ITEM_TEMPLATES[Math.floor(Math.random() * FW_ITEM_TEMPLATES.length)];
        const qty = 1 + Math.floor(Math.random() * 5);
        return { name: tpl.name, qty, unit_price: tpl.unit_price };
      });
      const declared = picked.reduce((s, p) => s + p.unit_price * p.qty, 0);

      // create forwarding_orders
      const { data: fo, error: foe } = await supabaseAdmin
        .from("forwarding_orders")
        .insert({
          user_id: uid,
          warehouse: ["guangzhou", "yiwu", "shenzhen"][i % 3],
          shipping_method: route.shipping_method,
          status,
          customer_code: prof?.customer_code ?? null,
          route_id: route.id,
          route_code: route.code,
          destination_code: route.destination_code,
          domestic_tracking_no: "SF" + Math.floor(Math.random() * 1e10),
          items_desc: picked.map((p) => `${p.name}×${p.qty}`).join(", "),
          declared_value_cad: +(declared * 0.19).toFixed(2),
          payment_status: i % 3 === 0 ? "paid" : "unpaid",
          box_count: itemCount,
        } as any)
        .select("id")
        .single();
      if (foe) throw new Error(foe.message);
      const foId = (fo as any).id;
      fwCreated++;

      // forwarding_items
      for (const p of picked) {
        await supabaseAdmin.from("forwarding_items").insert({
          forwarding_id: foId,
          name: p.name,
          quantity: p.qty,
          unit_price_cny: p.unit_price,
        } as any);
        itemsCreated++;
      }

      // waybills (1 or 2-3 if multi)
      const wbCount = multiIdx.has(i) ? 2 + Math.floor(Math.random() * 2) : 1;
      const needsBatch = ["ready_pickup", "delivered"].includes(status);
      const batch = needsBatch ? await ensureBatch(route) : null;

      for (let w = 0; w < wbCount; w++) {
        await supabaseAdmin.from("waybills").insert({
          user_id: uid,
          forwarding_id: foId,
          weight_kg: +(0.5 + Math.random() * 20).toFixed(2),
          length_cm: 30 + Math.floor(Math.random() * 30),
          width_cm: 20 + Math.floor(Math.random() * 20),
          height_cm: 15 + Math.floor(Math.random() * 25),
          shipping_method: route.shipping_method,
          status,
          payment_status: i % 3 === 0 ? "paid" : "unpaid",
          assigned_batch_id: batch?.id ?? null,
          batch_no: batch?.batch_no ?? null,
        } as any);
        wbCreated++;
      }
    }

    return {
      ok: true,
      forwardingOrders: fwCreated,
      forwardingItems: itemsCreated,
      waybills: wbCreated,
      multiWaybillOrders: multiIdx.size,
      batches: Object.keys(batchCache).length,
    };
  });

// ============================================================
// SHOP SEED — 5 分类 + 20 商品 + 30 购物订单
// ============================================================
const CATS = [
  { name: "服装鞋包", slug: "fashion", name_en: "Fashion" },
  { name: "数码电子", slug: "electronics", name_en: "Electronics" },
  { name: "美妆护肤", slug: "beauty", name_en: "Beauty" },
  { name: "食品保健", slug: "food", name_en: "Food" },
  { name: "家居生活", slug: "home", name_en: "Home" },
];

const PRODUCT_TEMPLATES: Record<string, { name: string; price: number; brand?: string }[]> = {
  fashion: [
    { name: "纯棉印花 T 恤", price: 89, brand: "Uniqlo" },
    { name: "牛仔修身裤", price: 299, brand: "Levis" },
    { name: "羊毛混纺大衣", price: 1299, brand: "Zara" },
    { name: "运动跑步鞋", price: 599, brand: "Nike" },
  ],
  electronics: [
    { name: "无线蓝牙耳机", price: 799, brand: "Sony" },
    { name: "智能手表", price: 1599, brand: "Apple" },
    { name: "便携充电宝 20000mAh", price: 199, brand: "Anker" },
    { name: "USB-C 多功能扩展坞", price: 359, brand: "Belkin" },
  ],
  beauty: [
    { name: "玻尿酸保湿精华", price: 268, brand: "兰蔻" },
    { name: "防晒霜 SPF50", price: 158, brand: "资生堂" },
    { name: "口红礼盒装", price: 459, brand: "YSL" },
    { name: "氨基酸洁面乳", price: 99, brand: "Cerave" },
  ],
  food: [
    { name: "蓝山咖啡豆 500g", price: 188 },
    { name: "云南普洱熟茶饼", price: 268 },
    { name: "纯天然蜂蜜 1kg", price: 128 },
    { name: "进口巧克力礼盒", price: 339, brand: "Lindt" },
  ],
  home: [
    { name: "记忆棉枕头", price: 199 },
    { name: "智能扫地机器人", price: 1999, brand: "石头" },
    { name: "陶瓷餐具六件套", price: 159 },
    { name: "北欧风格台灯", price: 289 },
  ],
};

export const seedShopData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uid = context.userId;
    const zero = "00000000-0000-0000-0000-000000000000";

    // 1. 清理：电商相关订单 + 它们派生的运单 + 库存 + 商品
    await supabaseAdmin.from("shop_refunds").delete().neq("id", zero);
    // 删除 source='shop' 的订单及其 items/waybills（FK CASCADE 处理）
    await supabaseAdmin.from("orders").delete().eq("source", "shop");
    await supabaseAdmin.from("inventory_movements").delete().neq("id", zero);
    await supabaseAdmin.from("product_variants").delete().neq("id", zero);
    await supabaseAdmin.from("products").delete().neq("id", zero);
    await supabaseAdmin.from("product_categories").delete().neq("id", zero);

    // 2. Categories
    const catMap: Record<string, string> = {};
    for (let i = 0; i < CATS.length; i++) {
      const c = CATS[i];
      const { data: row, error } = await supabaseAdmin
        .from("product_categories")
        .insert({ name: c.name, name_en: c.name_en, slug: c.slug, sort_order: i, is_active: true } as any)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      catMap[c.slug] = (row as any).id;
    }

    // 3. Products + variants (with extended fields)
    const productIds: { id: string; price: number }[] = [];
    let pIdx = 0;
    for (const slug of Object.keys(PRODUCT_TEMPLATES)) {
      for (const tpl of PRODUCT_TEMPLATES[slug]) {
        pIdx++;
        const sku = `SKU${String(pIdx).padStart(4, "0")}`;
        const isBusiness = pIdx % 4 === 0;
        const seed1 = `${slug}-${pIdx}`;
        const cover = `https://picsum.photos/seed/${seed1}/800/800`;
        const gallery = [1, 2, 3].map((n) => `https://picsum.photos/seed/${seed1}-${n}/800/800`);
        const { data: p, error } = await supabaseAdmin
          .from("products")
          .insert({
            sku,
            name: tpl.name,
            slug: `${slug}-${pIdx}`,
            category_id: catMap[slug],
            brand: tpl.brand ?? null,
            cover_url: cover,
            images: gallery,
            description: `${tpl.name} — 高品质精选，正品保证，全球直邮。`,
            status: "active",
            price_cny: tpl.price,
            compare_price_cny: tpl.price * 1.3,
            weight_kg: +(0.2 + Math.random() * 2).toFixed(2),
            length_cm: 20 + Math.floor(Math.random() * 30),
            width_cm: 15 + Math.floor(Math.random() * 20),
            height_cm: 10 + Math.floor(Math.random() * 15),
            tags: [slug, tpl.brand ?? "general"].filter(Boolean) as string[],
            hs_code: ["6109.10", "8517.62", "3304.99", "0901.21", "9405.40"][pIdx % 5],
            manufacturer: tpl.brand ? `${tpl.brand} 制造商` : "广东深圳制造",
            purchase_type: isBusiness ? "business" : "personal",
            moq: isBusiness ? 10 : 1,
            customs_mfn_rate: isBusiness ? 0.05 : 0,
            customs_gst_rate: isBusiness ? 0.03 : 0,
            customs_antidumping_rate: 0,
            freight_cny: +(20 + Math.random() * 80).toFixed(2),
            pack_qty: isBusiness ? 10 : 1,
            pack_weight_kg: +(0.5 + Math.random() * 5).toFixed(2),
            pack_length_cm: 30 + Math.floor(Math.random() * 30),
            pack_width_cm: 20 + Math.floor(Math.random() * 20),
            pack_height_cm: 15 + Math.floor(Math.random() * 25),
            pack_volume_m3: +(0.01 + Math.random() * 0.05).toFixed(4),
          } as any)
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        productIds.push({ id: (p as any).id, price: tpl.price });

        const variantCount = 2 + Math.floor(Math.random() * 2);
        const colors = ["黑色", "白色", "灰色", "蓝色", "红色"];
        for (let v = 0; v < variantCount; v++) {
          const stock = 30 + Math.floor(Math.random() * 200);
          await supabaseAdmin.from("product_variants").insert({
            product_id: (p as any).id,
            sku: `${sku}-V${v + 1}`,
            attrs: { color: colors[v % colors.length], size: ["S", "M", "L", "XL"][v % 4] },
            price_cny: tpl.price,
            stock: 0,
            is_active: true,
          } as any);
          const { data: vrow } = await supabaseAdmin
            .from("product_variants")
            .select("id")
            .eq("sku", `${sku}-V${v + 1}`)
            .single();
          if (vrow) {
            await supabaseAdmin.from("inventory_movements").insert({
              variant_id: (vrow as any).id,
              qty_delta: stock,
              reason: "in",
              ref_type: "seed",
              note: "初始库存",
              operator_id: uid,
            } as any);
          }
        }
      }
    }

    // 4. Customers + routes
    const { data: customers } = await supabaseAdmin
      .from("profiles")
      .select("id, customer_code, full_name, email")
      .like("customer_code", "%")
      .limit(5);
    if (!customers?.length) throw new Error("No customers found");
    const { data: routes } = await supabaseAdmin
      .from("shipping_routes")
      .select("id, code, destination_code, shipping_method")
      .eq("is_active", true);
    if (!routes?.length) throw new Error("No active routes — create at least one route first");

    const { data: allVariants } = await supabaseAdmin
      .from("product_variants")
      .select("id, product_id, sku, price_cny, attrs, product:products(name, slug, cover_url)");

    // 5. 50 shop orders, mixed statuses, ~30% with multiple waybills
    // 状态分布: 8 pending / 12 paid / 15 shipped / 10 delivered / 3 cancelled(refund) / 2 cancelled
    const STATUS_PLAN: Array<"pending" | "paid" | "shipped" | "delivered" | "cancelled"> = [
      ...Array(8).fill("pending"),
      ...Array(12).fill("paid"),
      ...Array(15).fill("shipped"),
      ...Array(10).fill("delivered"),
      ...Array(5).fill("cancelled"),
    ];

    let ordersCreated = 0;
    let waybillsCreated = 0;
    const multiWaybillIndices = new Set<number>();
    while (multiWaybillIndices.size < 15) multiWaybillIndices.add(Math.floor(Math.random() * 50));

    // Batch cache per route (for shipped/delivered)
    const batchCache: Record<string, { id: string; batch_no: string }> = {};
    async function getBatch(route: any): Promise<{ id: string; batch_no: string }> {
      const key = `${route.shipping_method}|${route.destination_code}|${route.code}`;
      if (batchCache[key]) return batchCache[key];
      const { data: b, error } = await supabaseAdmin
        .from("batches")
        .insert({
          shipping_method: route.shipping_method,
          destination_code: route.destination_code,
          planned_ship_date: new Date().toISOString().slice(0, 10),
          status: "planning",
        } as any)
        .select("id, batch_no")
        .single();
      if (error) throw new Error(error.message);
      batchCache[key] = { id: (b as any).id, batch_no: (b as any).batch_no };
      return batchCache[key];
    }

    for (let i = 0; i < 50; i++) {
      const cust: any = customers[i % customers.length];
      const status = STATUS_PLAN[i];
      const route: any = routes[i % routes.length];

      const itemCount = 1 + Math.floor(Math.random() * 3);
      const picked: any[] = [];
      let subtotal = 0;
      for (let k = 0; k < itemCount; k++) {
        const v: any = (allVariants as any[])![Math.floor(Math.random() * allVariants!.length)];
        const qty = 1 + Math.floor(Math.random() * 3);
        const line = Number(v.price_cny) * qty;
        subtotal += line;
        picked.push({ v, qty, line });
      }
      const shipping = Math.floor(15 + Math.random() * 35);
      const total = subtotal + shipping;

      const orderPatch: any = {
        source: "shop",
        user_id: cust.id,
        status,
        subtotal_cny: subtotal,
        shipping_cny: shipping,
        total_cny: total,
        display_currency: "CNY",
        fx_rate: 1,
        address_snapshot: { name: cust.full_name ?? "测试客户", phone: "13800138000", address: "测试地址 #" + (i + 1) },
        shipping_method: route.shipping_method,
        route_id: route.id,
        route_code: route.code,
        destination_code: route.destination_code,
        customer_code: cust.customer_code,
        payment_status: status === "pending" || status === "cancelled" ? "unpaid" : "paid",
      };
      if (status !== "pending" && status !== "cancelled")
        orderPatch.paid_at = new Date(Date.now() - i * 86400000).toISOString();
      if (status === "shipped" || status === "delivered")
        orderPatch.shipped_at = new Date(Date.now() - i * 3600_000).toISOString();
      if (status === "delivered") orderPatch.completed_at = new Date().toISOString();

      const { data: order, error: oe } = await supabaseAdmin
        .from("orders")
        .insert(orderPatch)
        .select("id, order_no")
        .single();
      if (oe) throw new Error(oe.message);
      const orderId = (order as any).id;
      ordersCreated++;

      // order_items
      for (const it of picked) {
        await supabaseAdmin.from("order_items").insert({
          order_id: orderId,
          product_id: it.v.product_id,
          variant_id: it.v.id,
          sku: it.v.sku,
          product_slug: it.v.product?.slug ?? "unknown",
          name_zh: it.v.product?.name ?? it.v.sku,
          name_en: it.v.product?.name ?? it.v.sku,
          image_url: it.v.product?.cover_url ?? null,
          unit_price_cny: it.v.price_cny,
          quantity: it.qty,
          attrs_snapshot: it.v.attrs,
          subtotal_cny: it.line,
          purchase_type: "personal",
        } as any);
      }

      // 派生运单：paid/shipped/delivered
      if (status === "paid" || status === "shipped" || status === "delivered") {
        const wbCount = multiWaybillIndices.has(i) ? 2 + Math.floor(Math.random() * 2) : 1;
        let batch: { id: string; batch_no: string } | null = null;
        if (status === "shipped" || status === "delivered") batch = await getBatch(route);

        for (let w = 0; w < wbCount; w++) {
          const wbStatus = status === "paid" ? "received" : status === "shipped" ? "in_transit" : "delivered";
          await supabaseAdmin.from("waybills").insert({
            user_id: cust.id,
            order_id: orderId,
            weight_kg: +(0.5 + Math.random() * 5).toFixed(2),
            length_cm: 30 + Math.floor(Math.random() * 30),
            width_cm: 20 + Math.floor(Math.random() * 20),
            height_cm: 15 + Math.floor(Math.random() * 25),
            shipping_method: route.shipping_method,
            status: wbStatus,
            payment_status: "paid",
            assigned_batch_id: batch?.id ?? null,
            batch_no: batch?.batch_no ?? null,
          } as any);
          waybillsCreated++;
        }
      }
    }

    return {
      ok: true,
      categories: CATS.length,
      products: productIds.length,
      orders: ordersCreated,
      waybills: waybillsCreated,
      multiWaybillOrders: multiWaybillIndices.size,
      batches: Object.keys(batchCache).length,
      customers: customers.length,
    };
  });
