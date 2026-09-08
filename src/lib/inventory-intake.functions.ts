// ============ 库存发货订单的入库扫描 ============
// 「从库存发货」的集运订单（前台 /forwarding 的库存带入，后台客户视图的代客发货）
// 本身不会生成新运单 —— 货物已经以 status='storage' 的运单躺在仓库里。
// 这里提供入库扫描页需要的三件事：
//   1. 列出待入库的库存发货订单（items.extras.inv_box_count 是库存带入的标记）
//   2. 逐个校验扫描到的运单号（SKU 是否属于该订单、箱数是否超出）
//   3. 全部箱数正确后一次性入库：运单 storage → arrived（已到达集运仓），
//      并挂到新的集运订单下；原订单若已无任何运单则自动删除。
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

const norm = (v: any) => String(v ?? "").trim().toLowerCase();

function requiredBoxes(extras: any, quantity: number): number {
  const inv = Number(extras?.inv_box_count ?? 0);
  if (inv > 0) return Math.floor(inv);
  const box = Number(extras?.box_count ?? 0);
  if (box > 0) return Math.floor(box);
  const inner = Number(extras?.inner_qty ?? 0);
  if (inner > 0 && quantity > 0) return Math.max(1, Math.ceil(quantity / inner));
  return 1;
}

function itemKey(name: string, sku: any) {
  return `${norm(sku) || "-"}__${norm(name)}`;
}

async function loadOrder(admin: any, forwardingId: string) {
  const { data: order } = await admin
    .from("forwarding_orders")
    .select("id, request_no, user_id, customer_code, warehouse, route_id, route_code, destination_code, address_id, shipping_method, status")
    .eq("id", forwardingId)
    .maybeSingle();
  if (!order) throw new Error("订单不存在");
  const { data: items } = await admin
    .from("forwarding_items")
    .select("id, name, quantity, extras")
    .eq("forwarding_id", forwardingId);
  return { order, items: (items ?? []) as any[] };
}

// ====== 1. 待入库的库存发货订单列表 ======
export const listInventoryIntakeOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invItems } = await supabaseAdmin
      .from("forwarding_items")
      .select("id, forwarding_id, name, quantity, extras")
      .not("extras->>inv_box_count", "is", null)
      .order("created_at", { ascending: false })
      .limit(600);
    // extras 里可能存在 inv_box_count: null（普通集运单也会写入该键），必须排除
    const rows = ((invItems ?? []) as any[]).filter((r) => Number(r.extras?.inv_box_count ?? 0) > 0);
    const ids = Array.from(new Set(rows.map((r) => r.forwarding_id)));
    if (!ids.length) return { orders: [] as any[] };
    const { data: orders } = await supabaseAdmin
      .from("forwarding_orders")
      .select("id, request_no, customer_code, warehouse, route_code, status, created_at, user_id")
      .in("id", ids)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    return {
      orders: (orders ?? []).map((o: any) => ({
        ...o,
        items: rows
          .filter((r) => r.forwarding_id === o.id)
          .map((r) => ({
            id: r.id,
            name: r.name,
            sku: r.extras?.sku ?? null,
            required_boxes: requiredBoxes(r.extras, Number(r.quantity ?? 0)),
            inner_qty: r.extras?.inner_qty ?? null,
            hs_code: r.extras?.hscode ?? null,
          })),
      })),
    };
  });

// ====== 2. 校验单个扫描到的运单号 ======
export const inventoryIntakeCheckWaybill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { forwardingId: string; code: string; alreadyIds?: string[] }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code.trim();
    if (!code) throw new Error("空扫描");
    const { order, items } = await loadOrder(supabaseAdmin, data.forwardingId);

    const { data: wb } = await supabaseAdmin
      .from("waybills")
      .select("id, waybill_no, status, user_id, items_summary, forwarding_id")
      .ilike("waybill_no", code)
      .maybeSingle();
    if (!wb) throw new Error(`运单 ${code} 不存在`);
    if ((wb as any).user_id !== order.user_id) throw new Error(`运单 ${code} 不属于该客户`);
    if ((wb as any).status !== "storage") throw new Error(`运单 ${code} 当前状态为 ${(wb as any).status}，不在仓储中`);
    if ((data.alreadyIds ?? []).includes((wb as any).id)) throw new Error(`运单 ${code} 已扫描过`);

    const summary = Array.isArray((wb as any).items_summary) ? (wb as any).items_summary : [];
    const first = summary[0] ?? {};
    const wSku = first?.sku ?? null;
    const wName = first?.name ?? "";
    const hit =
      items.find((it) => wSku && norm(it.extras?.sku) === norm(wSku)) ??
      items.find((it) => norm(it.name) === norm(wName));
    if (!hit) throw new Error(`运单 ${code} 的物品「${wName || wSku || "未知"}」不在该订单的发货清单内`);

    return {
      ok: true,
      waybillId: (wb as any).id,
      waybillNo: (wb as any).waybill_no,
      itemId: hit.id,
      itemKey: itemKey(hit.name, hit.extras?.sku),
      name: hit.name,
      sku: hit.extras?.sku ?? null,
      requiredBoxes: requiredBoxes(hit.extras, Number(hit.quantity ?? 0)),
    };
  });

// ====== 3. 全部核对无误 → 入库 ======
export const inventoryIntakeCommit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { forwardingId: string; waybillIds: string[]; makePallet?: boolean }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { order, items } = await loadOrder(supabaseAdmin, data.forwardingId);
    const ids = Array.from(new Set(data.waybillIds ?? []));
    if (!ids.length) throw new Error("请先扫描运单");

    const { data: wbs } = await supabaseAdmin
      .from("waybills")
      .select("id, waybill_no, status, user_id, items_summary, forwarding_id, shipping_method")
      .in("id", ids);
    const rows = (wbs ?? []) as any[];
    if (rows.length !== ids.length) throw new Error("部分运单不存在");

    // 按 SKU/品名归组，逐项核对箱数
    const counted = new Map<string, number>();
    for (const w of rows) {
      if (w.user_id !== order.user_id) throw new Error(`运单 ${w.waybill_no} 不属于该客户`);
      if (w.status !== "storage") throw new Error(`运单 ${w.waybill_no} 不在仓储中`);
      const first = (Array.isArray(w.items_summary) ? w.items_summary : [])[0] ?? {};
      const hit =
        items.find((it) => first?.sku && norm(it.extras?.sku) === norm(first.sku)) ??
        items.find((it) => norm(it.name) === norm(first?.name));
      if (!hit) throw new Error(`运单 ${w.waybill_no} 的物品不在该订单清单内`);
      const k = itemKey(hit.name, hit.extras?.sku);
      counted.set(k, (counted.get(k) ?? 0) + 1);
    }
    const mismatches = items
      .map((it) => {
        const need = requiredBoxes(it.extras, Number(it.quantity ?? 0));
        const got = counted.get(itemKey(it.name, it.extras?.sku)) ?? 0;
        return { name: it.name, sku: it.extras?.sku ?? null, need, got };
      })
      .filter((m) => m.need !== m.got);
    if (mismatches.length)
      throw new Error(
        `箱数不符：${mismatches.map((m) => `${m.name}${m.sku ? `(${m.sku})` : ""} 需 ${m.need} 箱，已扫 ${m.got} 箱`).join("；")}`,
      );

    const sourceFwdIds = Array.from(new Set(rows.map((w) => w.forwarding_id).filter(Boolean))) as string[];

    // 运单：仓储 → 已到达集运仓，并挂到本次库存发货订单下
    await supabaseAdmin
      .from("waybills")
      .update({
        status: "arrived",
        forwarding_id: order.id,
        shipping_method: order.shipping_method ?? null,
      })
      .in("id", ids);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    const operatorName = (profile as any)?.full_name || (profile as any)?.email || context.userId.slice(0, 8);
    const wh = order.warehouse || "集运仓";

    for (const w of rows) {
      let { data: ship } = await supabaseAdmin
        .from("shipments")
        .select("id")
        .eq("tracking_no", w.waybill_no)
        .maybeSingle();
      if (!ship) {
        const { data: s2 } = await supabaseAdmin
          .from("shipments")
          .insert({ tracking_no: w.waybill_no, status: "created" })
          .select("id")
          .single();
        ship = s2;
      }
      if (ship)
        await supabaseAdmin.from("tracking_events").insert({
          shipment_id: (ship as any).id,
          status_zh: `已到达集运仓 — ${wh} / 操作员 ${operatorName}`,
          status_en: `Arrived at consolidation warehouse — ${wh} / by ${operatorName}`,
          location_zh: wh,
          location_en: wh,
          event_time: new Date().toISOString(),
          source: "admin_action",
          source_ref: context.userId,
        });
    }

    await supabaseAdmin
      .from("forwarding_orders")
      .update({ status: "arrived", intake_at: new Date().toISOString(), intake_by: context.userId })
      .eq("id", order.id);

    // 可选：入库同时直接成托盘（与正常入库扫描后的装托一致）
    let palletNo: string | null = null;
    if (data.makePallet) {
      let addr: any = null;
      if ((order as any).address_id) {
        const { data: a } = await supabaseAdmin
          .from("addresses")
          .select("*")
          .eq("id", (order as any).address_id)
          .maybeSingle();
        addr = a ?? null;
      }
      const { data: pal, error: palErr } = await supabaseAdmin
        .from("pallets")
        .insert({
          route_id: (order as any).route_id ?? null,
          route_code: (order as any).route_code ?? null,
          customer_user_id: order.user_id ?? null,
          customer_code: order.customer_code ?? null,
          pickup_warehouse: order.warehouse ?? null,
          destination_code: (order as any).destination_code ?? null,
          address_snapshot: addr,
          notes: `库存发货入库自动成托: ${order.request_no}`,
          created_by: context.userId,
        } as any)
        .select("id, pallet_no")
        .single();
      if (palErr) throw new Error(`成托失败: ${palErr.message}`);
      palletNo = (pal as any).pallet_no;
      const { error: asgErr } = await supabaseAdmin
        .from("waybills")
        .update({ pallet_id: (pal as any).id })
        .in("id", ids);
      if (asgErr) throw new Error(`装托失败: ${asgErr.message}`);
    }


    // 原库存订单若已无任何运单 → 自动删除
    const deleted: string[] = [];
    for (const fid of sourceFwdIds) {
      if (fid === order.id) continue;
      const { count } = await supabaseAdmin
        .from("waybills")
        .select("id", { count: "exact", head: true })
        .eq("forwarding_id", fid);
      if ((count ?? 0) === 0) {
        const { data: old } = await supabaseAdmin
          .from("forwarding_orders")
          .select("request_no")
          .eq("id", fid)
          .maybeSingle();
        await supabaseAdmin.from("forwarding_orders").delete().eq("id", fid);
        if ((old as any)?.request_no) deleted.push((old as any).request_no);
      }
    }

    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "forwarding",
      entity_id: order.id,
      action: "inventory_intake",
      after: { waybills: rows.map((w) => w.waybill_no), deleted_source_orders: deleted, pallet_no: palletNo },
      operator_id: context.userId,
      operator_name: operatorName,
      note: `库存发货入库: ${order.request_no} 共 ${rows.length} 箱，运单转为已到达集运仓${palletNo ? `；已直接成托 ${palletNo}` : ""}${deleted.length ? `；自动删除空订单 ${deleted.join(", ")}` : ""}`,
    });

    return { ok: true, count: rows.length, requestNo: order.request_no, deletedOrders: deleted, palletNo };
  });
