import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type WaybillStatus =
  | "procurement"
  | "pending"
  | "received"
  | "storage"
  | "packed"
  | "shipped"
  | "arrived"
  | "in_transit"
  | "ready_pickup"
  | "delivered"
  | "cancelled";
export type OrderStatus =
  | "pending"
  | "paid"
  | "procurement"
  | "received"
  | "storage"
  | "packed"
  | "shipped"
  | "arrived"
  | "in_transit"
  | "ready_pickup"
  | "processing"
  | "delivered"
  | "cancelled";
export type BatchMethod = "air" | "sea" | "express";
export type BatchStatus = "draft" | "locked" | "shipped" | "arrived" | "closed";

async function getLevel(supabase: any, userId: string) {
  const [{ data: isOwner }, { data: isManager }, { data: isStaff }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "manager" }),
    supabase.rpc("is_staff", { _user_id: userId }),
  ]);
  return { isOwner: !!isOwner, isManager: !!isManager, isStaff: !!isStaff };
}
async function assertStaff(supabase: any, userId: string) {
  const { isStaff } = await getLevel(supabase, userId);
  if (!isStaff) throw new Error("Forbidden");
}
async function assertManager(supabase: any, userId: string) {
  const { isOwner, isManager } = await getLevel(supabase, userId);
  if (!isOwner && !isManager) throw new Error("Forbidden: owner/manager only");
}

async function recordLog(
  admin: any,
  opts: {
    entity_type: string;
    entity_id: string;
    action: string;
    before?: any;
    after?: any;
    operator_id: string;
    operator_name?: string;
    note?: string;
  },
) {
  await admin.from("admin_action_logs").insert({
    entity_type: opts.entity_type,
    entity_id: opts.entity_id,
    action: opts.action,
    before: opts.before ?? null,
    after: opts.after ?? null,
    operator_id: opts.operator_id,
    operator_name: opts.operator_name ?? null,
    note: opts.note ?? null,
  });
}

async function getOperatorName(admin: any, userId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return data?.full_name || data?.email || userId;
}

// ====== Freight calculation helper (server-side) ======
// Field logic:
//   freight_rules.unit_price_cad / min_charge_cad / clearance_fee_cad — 主字段 (CAD)
//   freight_rules.unit_price_cny / min_charge_cny / extra_fee_cny     — 兜底字段 (CNY) 若 CAD 缺失
//   FX: 1 CNY ≈ 0.19 CAD (与前端 CNY_TO_CAD ≈ 0.192 一致)
//   forwarding_orders.fee_cny — 最终运费(CNY), = freight_snapshot.freight_cny
//   forwarding_orders.freight_snapshot — 计费明细 JSON, 供前后端展示
//   freight_snapshot.customs_applies — 该线路是否勾选关税规则; false → 显示"包关税/Include"
// Read fx rate from app_settings.fx_rate (JSON {cny_per_cad}) — the admin-controlled global rate.
// Returns CAD per CNY (i.e. 1/cny_per_cad). Fallback 0.19 (~5.26 cny/cad) when unset.
export async function getFxCadPerCny(admin: any): Promise<number> {
  try {
    const { data } = await admin.from("app_settings").select("value").eq("key", "fx_rate").maybeSingle();
    const cnyPerCad = Number((data?.value as any)?.cny_per_cad ?? 0);
    if (cnyPerCad > 0) return +(1 / cnyPerCad).toFixed(6);
  } catch {}
  return 0.19;
}

export async function computeFreight(
  admin: any,
  route_id: string,
  weight_kg: number,
  volume_cm3: number,
  declared_cad: number | null,
) {
  const [{ data: rule }, { data: customs }] = await Promise.all([
    admin
      .from("freight_rules")
      .select("*")
      .eq("route_id", route_id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("customs_rules").select("*").eq("route_id", route_id).maybeSingle(),
  ]);
  if (!rule) return null;
  const w = Math.max(0, weight_kg || 0);
  const v = Math.max(0, volume_cm3 || 0);
  const divisor = Number(rule.volumetric_divisor) || 6000;
  const volW = v / divisor;
  const chargeable = rule.weight_mode === "actual" ? w : rule.weight_mode === "volumetric" ? volW : Math.max(w, volW);
  const fx = await getFxCadPerCny(admin);
  const unit_cad = Number(rule.unit_price_cad ?? 0);
  // 运单级最低收费 / 清关费（批次级另行结算）
  const min_cad = 0;
  const extra_cad = 0;
  const unit_cny = Number(rule.unit_price_cny ?? 0);
  const min_cny = Number(rule.min_charge_cny ?? 0);
  const extra_cny = Number(rule.extra_fee_cny ?? 0);

  let freight_cad = 0,
    freight_cny = 0;
  if (unit_cad > 0 || min_cad > 0 || extra_cad > 0) {
    // CAD-primary calculation
    freight_cad = chargeable * unit_cad + extra_cad;
    if (freight_cad < min_cad) freight_cad = min_cad;
    freight_cny = +(freight_cad / fx).toFixed(2);
    freight_cad = +freight_cad.toFixed(2);
  } else {
    // CNY-primary fallback
    freight_cny = chargeable * unit_cny + extra_cny;
    if (freight_cny < min_cny) freight_cny = min_cny;
    freight_cad = +(freight_cny * fx).toFixed(2);
    freight_cny = +freight_cny.toFixed(2);
  }

  const customs_applies = !!customs?.enabled;
  let duty_cad = 0;
  if (customs_applies && declared_cad && declared_cad >= Number(customs.threshold_cad ?? 0)) {
    duty_cad = +(declared_cad * (Number(customs.rate_pct ?? 0) / 100)).toFixed(2);
  }
  const insurance_rate_pct = Number(rule.insurance_rate_pct ?? 0);
  const insurance_cad =
    declared_cad && insurance_rate_pct > 0 ? +(declared_cad * (insurance_rate_pct / 100)).toFixed(2) : 0;
  return {
    chargeable_weight: +chargeable.toFixed(3),
    actual_weight: +w.toFixed(3),
    volumetric_weight: +volW.toFixed(3),
    freight_cny,
    freight_cad,
    duty_cad,
    customs_applies,
    insurance_cad,
    insurance_rate_pct,
    fx_rate: fx,
    rule_id: rule.id,
    weight_mode: rule.weight_mode,
    unit_price_cad: unit_cad,
    unit_price_cny: unit_cny,
    declared_cad: declared_cad ?? null,
    computed_at: new Date().toISOString(),
  };
}

// ====== Per-waybill fee computation ======
// Declared value 直接以 CAD 计算（用户下单时录入的是 unit_price_cad）。
// 若 items_summary 缺失单价，则回落到 forwarding_items.unit_price_cad（再回落到 unit_price_cny * fx）。
// 每条运单的数量优先用 extras.inner_qty；若无则用 quantity/box_count。
export function computeWaybillDeclaredCad(
  items_summary: any,
  priceMap?: Map<string, { cad: number; cny: number }>,
  fx?: number,
): number {
  const arr: any[] = Array.isArray(items_summary) ? items_summary : [];
  let cad = 0;
  for (const it of arr) {
    let unitCad = Number(it?.unit_price_cad ?? 0);
    let unitCny = Number(it?.unit_price_cny ?? 0);
    if (!(unitCad > 0) && priceMap && it?.name && priceMap.has(it.name)) {
      const m = priceMap.get(it.name)!;
      if (m.cad > 0) unitCad = m.cad;
      if (!(unitCny > 0)) unitCny = m.cny;
    }
    if (!(unitCad > 0) && unitCny > 0 && fx && fx > 0) unitCad = unitCny * fx;
    const inner = Number(it?.extras?.inner_qty ?? 0);
    const boxes = Number(it?.extras?.box_count ?? 0);
    const rawQty = Number(it?.quantity ?? 0);
    const qty = inner > 0 ? inner : boxes > 0 ? rawQty / boxes : rawQty;
    if (unitCad > 0 && qty > 0) cad += unitCad * qty;
  }
  return +cad.toFixed(2);
}

// Deprecated CNY-first helper retained for callers; converts via fx.
export function computeWaybillDeclaredCny(items_summary: any, priceMap?: Map<string, number>, fx = 0.19): number {
  const pm = new Map<string, { cad: number; cny: number }>();
  if (priceMap) for (const [k, v] of priceMap) pm.set(k, { cad: 0, cny: Number(v ?? 0) });
  const cad = computeWaybillDeclaredCad(items_summary, pm, fx);
  return fx > 0 ? +(cad / fx).toFixed(2) : 0;
}

export async function computeAndPersistWaybillFees(admin: any, waybillId: string) {
  const { data: wb } = await admin
    .from("waybills")
    .select("id, forwarding_id, weight_kg, length_cm, width_cm, height_cm, items_summary")
    .eq("id", waybillId)
    .maybeSingle();
  if (!wb || !wb.forwarding_id) return null;
  const { data: fo } = await admin
    .from("forwarding_orders")
    .select("route_id, insured")
    .eq("id", wb.forwarding_id)
    .maybeSingle();
  if (!fo?.route_id) return null;

  const wt = Number(wb.weight_kg ?? 0);
  const vol =
    wb.length_cm && wb.width_cm && wb.height_cm ? Number(wb.length_cm) * Number(wb.width_cm) * Number(wb.height_cm) : 0;

  const fx = await getFxCadPerCny(admin);
  // Price fallback by item name from forwarding_items (both CAD and CNY, CAD is authoritative).
  const { data: foItems } = await admin
    .from("forwarding_items")
    .select("name, unit_price_cad, unit_price_cny")
    .eq("forwarding_id", wb.forwarding_id);
  const priceMap = new Map<string, { cad: number; cny: number }>();
  for (const r of foItems ?? [])
    if (r?.name)
      priceMap.set(r.name, {
        cad: Number((r as any).unit_price_cad ?? 0),
        cny: Number(r.unit_price_cny ?? 0),
      });
  const declared_cad = computeWaybillDeclaredCad(wb.items_summary, priceMap, fx);
  const declared_cny = fx > 0 ? +(declared_cad / fx).toFixed(2) : 0;

  const [{ data: rule }, { data: customs }] = await Promise.all([
    admin
      .from("freight_rules")
      .select("*")
      .eq("route_id", fo.route_id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("customs_rules").select("*").eq("route_id", fo.route_id).maybeSingle(),
  ]);
  if (!rule) return null;

  const divisor = Number(rule.volumetric_divisor) || 6000;
  const volW = vol / divisor;
  const chargeable = rule.weight_mode === "actual" ? wt : rule.weight_mode === "volumetric" ? volW : Math.max(wt, volW);
  const unit_cad = Number(rule.unit_price_cad ?? 0);
  const unit_cny = Number(rule.unit_price_cny ?? 0);
  let freight_cad = 0;
  if (unit_cad > 0) freight_cad = chargeable * unit_cad;
  else if (unit_cny > 0) freight_cad = chargeable * unit_cny * fx;
  // 运单级最低收费 / 清关费：每张运单各判断一次
  const min_charge_waybill_cad = Number(rule.min_charge_waybill_cad ?? 0);
  if (min_charge_waybill_cad > 0 && freight_cad < min_charge_waybill_cad) freight_cad = min_charge_waybill_cad;
  const clearance_cad = +Number(rule.clearance_fee_waybill_cad ?? 0).toFixed(2);
  freight_cad = +freight_cad.toFixed(2);

  // 关税 —— 走 HS 明细口径（duty.server）；customs_rules.rate_pct 已弃用
  let duty_cad = 0;
  const customs_applies = !!customs?.enabled;
  {
    const { computeWaybillDutyBreakdown } = await import("./duty.server");
    const br = await computeWaybillDutyBreakdown(admin, {
      id: waybillId,
      forwarding_id: wb.forwarding_id,
      items_summary: wb.items_summary,
    });
    duty_cad = br.duty_cad;
  }
  const ins_rate = Number(rule.insurance_rate_pct ?? 0);
  const insurance_cad = fo.insured && ins_rate > 0 ? +((declared_cad * ins_rate) / 100).toFixed(2) : 0;

  const snapshot = {
    actual_weight: +wt.toFixed(3),
    volumetric_weight: +volW.toFixed(3),
    chargeable_weight: +chargeable.toFixed(3),
    declared_cny,
    declared_cad,
    freight_cad,
    duty_cad,
    insurance_cad,
    clearance_cad,
    min_charge_waybill_cad,
    fx_rate: fx,
    weight_mode: rule.weight_mode,
    customs_applies,
    insurance_rate_pct: ins_rate,
    computed_at: new Date().toISOString(),
  };
  await admin
    .from("waybills")
    .update({
      freight_cad,
      duty_cad,
      insurance_cad,
      clearance_cad,
      weight_snapshot: snapshot,
    })
    .eq("id", waybillId);
  return snapshot;
}

// ====== Recompute forwarding order totals from its waybills ======
// freight/duty/insurance = Σ waybills (each computed via computeAndPersistWaybillFees)
// surcharges  = forwarding + waybill + pallet
// total_cad   = freight + duty + insurance + surcharges
export async function recomputeForwardingTotal(admin: any, forwardingId: string) {
  const { data: fo } = await admin
    .from("forwarding_orders")
    .select("id, route_id, insured, freight_snapshot")
    .eq("id", forwardingId)
    .maybeSingle();
  if (!fo) return null;
  const { data: wbs } = await admin
    .from("waybills")
    .select("id, weight_kg, pallet_id, freight_cad, duty_cad, insurance_cad")
    .eq("forwarding_id", forwardingId);

  let duty_cad = 0,
    insurance_cad = 0;
  let freight_cad = 0;
  let clearance_cad = 0;
  let totActual = 0,
    totVol = 0,
    totCharge = 0;
  let anyCustomsApplies = false;
  for (const w of wbs ?? []) {
    const s = await computeAndPersistWaybillFees(admin, w.id);
    if (s) {
      duty_cad += s.duty_cad;
      insurance_cad += s.insurance_cad;
      // 运单级：运费（含最低收费）与清关费按每张运单累加
      freight_cad += Number((s as any).freight_cad ?? 0);
      clearance_cad += Number((s as any).clearance_cad ?? 0);
      totActual += s.actual_weight;
      totVol += s.volumetric_weight;
      totCharge += s.chargeable_weight;
      if ((s as any).customs_applies) anyCustomsApplies = true;
    } else {
      duty_cad += Number(w.duty_cad ?? 0);
      insurance_cad += Number(w.insurance_cad ?? 0);
      freight_cad += Number(w.freight_cad ?? 0);
      totActual += Number(w.weight_kg ?? 0);
    }
  }

  const fx = await getFxCadPerCny(admin);
  let weight_mode: string | undefined;
  let min_charge_waybill_cad = 0;
  if (fo.route_id) {
    const { data: rule } = await admin
      .from("freight_rules")
      .select("*")
      .eq("route_id", fo.route_id)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rule) {
      weight_mode = rule.weight_mode;
      const chargeTotal =
        rule.weight_mode === "actual"
          ? totActual
          : rule.weight_mode === "volumetric"
            ? totVol
            : Math.max(totActual, totVol);
      totCharge = chargeTotal;
      min_charge_waybill_cad = Number(rule.min_charge_waybill_cad ?? 0);
    }
  }

  const wbIds = (wbs ?? []).map((w: any) => w.id);
  const palletIds = Array.from(new Set((wbs ?? []).map((w: any) => w.pallet_id).filter(Boolean))) as string[];
  const [foScR, wbScR, plScR] = await Promise.all([
    admin.from("surcharges").select("amount_cny").eq("scope", "forwarding").eq("forwarding_id", forwardingId),
    wbIds.length
      ? admin.from("surcharges").select("amount_cny").eq("scope", "waybill").in("waybill_id", wbIds)
      : Promise.resolve({ data: [] as any[] }),
    palletIds.length
      ? admin.from("surcharges").select("amount_cny").eq("scope", "pallet").in("pallet_id", palletIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const sumCny = [
    ...((foScR as any).data ?? []),
    ...((wbScR as any).data ?? []),
    ...((plScR as any).data ?? []),
  ].reduce((s: number, r: any) => s + Number(r.amount_cny ?? 0), 0);
  const surcharges_cad = +(sumCny * fx).toFixed(2);

  freight_cad = +freight_cad.toFixed(2);
  duty_cad = +duty_cad.toFixed(2);
  insurance_cad = +insurance_cad.toFixed(2);
  clearance_cad = +clearance_cad.toFixed(2);
  const total_cad = +(freight_cad + duty_cad + insurance_cad + clearance_cad + surcharges_cad).toFixed(2);
  const freight_cny = fx > 0 ? +(freight_cad / fx).toFixed(2) : 0;

  const nextSnap = {
    ...(fo.freight_snapshot ?? {}),
    source: "waybill_sum",
    actual_weight: +totActual.toFixed(3),
    volumetric_weight: +totVol.toFixed(3),
    chargeable_weight: +totCharge.toFixed(3),
    freight_cad,
    freight_cny,
    duty_cad,
    insurance_cad,
    clearance_cad,
    min_charge_waybill_cad,
    surcharges_cny: +sumCny.toFixed(2),
    surcharges_cad,
    total_cad,
    insured: !!fo.insured,
    fx_rate: fx,
    weight_mode,
    customs_applies: anyCustomsApplies,
    computed_at: new Date().toISOString(),
  };
  await admin
    .from("forwarding_orders")
    .update({
      freight_snapshot: nextSnap,
      fee_cny: freight_cny,
    })
    .eq("id", forwardingId);
  return nextSnap;
}

// ====== Pallet self-freight: use its own weight/volume against the route's freight rule ======
// self_volume_m3 → cm³ via *1e6 to feed computeFreight (which expects cm³).
export async function computePalletSelfFreight(admin: any, palletId: string) {
  const { data: p } = await admin
    .from("pallets")
    .select(
      "id, route_id, self_weight_kg, self_volume_m3, self_length_cm, self_width_cm, self_height_cm, weight_kg, length_cm, width_cm, height_cm",
    )
    .eq("id", palletId)
    .maybeSingle();
  if (!p?.route_id) return null;
  const wt = Number(p.self_weight_kg ?? p.weight_kg ?? 0);
  let volM3 = Number(p.self_volume_m3 ?? 0);
  if (!volM3 && p.self_length_cm && p.self_width_cm && p.self_height_cm) {
    volM3 = (Number(p.self_length_cm) * Number(p.self_width_cm) * Number(p.self_height_cm)) / 1_000_000;
  }
  if (!volM3 && p.length_cm && p.width_cm && p.height_cm) {
    volM3 = (Number(p.length_cm) * Number(p.width_cm) * Number(p.height_cm)) / 1_000_000;
  }
  if (wt <= 0 || volM3 <= 0) return null;
  const snap = await computeFreight(admin, p.route_id, wt, volM3 * 1_000_000, null);
  if (!snap) return null;
  await admin.from("pallets").update({ self_freight_cny: snap.freight_cny }).eq("id", palletId);
  return snap;
}

export const recalcForwardingTotal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const snapshot = await recomputeForwardingTotal(supabaseAdmin, data.id);
    return { ok: true, snapshot };
  });

// ============================================================
//   ORDERS
// ============================================================
export const listOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      status?: OrderStatus | "all";
      payment_status?: "all" | "paid" | "unpaid";
      search?: string;
      date_from?: string;
      date_to?: string;
      page?: number;
      pageSize?: number;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, data.pageSize ?? 25);
    let q = supabaseAdmin
      .from("orders")
      .select(
        "id, order_no, customer_code, shipping_method, route_code, total_cny, payment_status, status, batch_no, domestic_tracking_no, tracking_no, created_at, user_id",
        { count: "exact" },
      )
      .eq("source", "shop")
      .order("created_at", { ascending: false });
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.payment_status && data.payment_status !== "all") q = q.eq("payment_status", data.payment_status);
    if (data.search?.trim()) {
      const s = data.search.trim();
      q = q.or(
        `order_no.ilike.%${s}%,customer_code.ilike.%${s}%,batch_no.ilike.%${s}%,tracking_no.ilike.%${s}%,domestic_tracking_no.ilike.%${s}%`,
      );
    }
    if (data.date_from) q = q.gte("created_at", data.date_from);
    if (data.date_to) q = q.lte("created_at", data.date_to);
    const { data: rows, error, count } = await q.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    return { orders: rows ?? [], total: count ?? 0, page, pageSize };
  });

export const getOrderDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orderId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [orderR, itemsR, waybillsR, logsR] = await Promise.all([
      supabaseAdmin.from("orders").select("*").eq("id", data.orderId).maybeSingle(),
      supabaseAdmin.from("order_items").select("*").eq("order_id", data.orderId),
      supabaseAdmin.from("waybills").select("*").eq("order_id", data.orderId).order("created_at", { ascending: false }),
      supabaseAdmin
        .from("admin_action_logs")
        .select("*")
        .eq("entity_type", "order")
        .eq("entity_id", data.orderId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (!orderR.data) throw new Error("Order not found");
    let user: any = null;
    if (orderR.data.user_id) {
      const { data: u } = await supabaseAdmin
        .from("profiles")
        .select("id, email, full_name, phone, customer_code")
        .eq("id", orderR.data.user_id)
        .maybeSingle();
      user = u;
    }
    return {
      order: orderR.data,
      items: itemsR.data ?? [],
      waybills: waybillsR.data ?? [],
      logs: logsR.data ?? [],
      user,
    };
  });

export const recalcOrderFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      orderId: string;
      route_id?: string;
      weight_kg?: number;
      volume_cm3?: number;
      declared_cad?: number;
      apply_to_total?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin.from("orders").select("*").eq("id", data.orderId).maybeSingle();
    if (!order) throw new Error("Order not found");
    const route_id = data.route_id ?? order.route_id;
    if (!route_id) throw new Error("No route assigned");
    const snapshot = await computeFreight(
      supabaseAdmin,
      route_id,
      data.weight_kg ?? 0,
      data.volume_cm3 ?? 0,
      data.declared_cad ?? null,
    );
    if (!snapshot) throw new Error("No active freight rule");
    const update: any = {
      route_id,
      freight_snapshot: snapshot,
      freight_recalc_at: new Date().toISOString(),
      freight_recalc_by: context.userId,
    };
    if (data.apply_to_total) {
      update.shipping_cny = snapshot.freight_cny;
      update.total_cny =
        (Number(order.subtotal_cny) || 0) +
        snapshot.freight_cny +
        (Number(order.customs_cny) || 0) +
        (Number(order.insurance_cny) || 0);
    }
    const { error } = await supabaseAdmin.from("orders").update(update).eq("id", data.orderId);
    if (error) throw new Error(error.message);
    await recordLog(supabaseAdmin, {
      entity_type: "order",
      entity_id: data.orderId,
      action: "recalc_freight",
      before: order.freight_snapshot,
      after: snapshot,
      operator_id: context.userId,
      operator_name: await getOperatorName(supabaseAdmin, context.userId),
      note: data.apply_to_total ? "已应用到订单金额" : "仅保存快照",
    });
    return { ok: true, snapshot };
  });

export const cancelOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orderId: string; reason?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("orders").select("status").eq("id", data.orderId).maybeSingle();
    const { error } = await supabaseAdmin.from("orders").update({ status: "cancelled" }).eq("id", data.orderId);
    if (error) throw new Error(error.message);
    await recordLog(supabaseAdmin, {
      entity_type: "order",
      entity_id: data.orderId,
      action: "cancel",
      before,
      after: { status: "cancelled" },
      operator_id: context.userId,
      operator_name: await getOperatorName(supabaseAdmin, context.userId),
      note: data.reason,
    });
    return { ok: true };
  });

// ============================================================
//   FORWARDING ORDERS
// ============================================================
export const listForwardings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { status?: string; payment_status?: string; search?: string; page?: number; pageSize?: number }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, data.pageSize ?? 25);
    let q = supabaseAdmin
      .from("forwarding_orders")
      .select(
        "id, request_no, tracking_no, domestic_tracking_no, customer_code, warehouse, shipping_method, status, payment_status, fee_cny, freight_snapshot, batch_no, intake_at, created_at, box_count, route_code, route_id, destination_code, shipping_routes:route_id(code, name_zh)",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.payment_status && data.payment_status !== "all") q = q.eq("payment_status", data.payment_status);
    if (data.search?.trim()) {
      const s = data.search.trim();
      q = q.or(
        `request_no.ilike.%${s}%,tracking_no.ilike.%${s}%,domestic_tracking_no.ilike.%${s}%,customer_code.ilike.%${s}%,batch_no.ilike.%${s}%`,
      );
    }
    const { data: rows, error, count } = await q.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    // 同时计算每个集运单实际运单数 (作为箱数兜底)
    const ids = (rows ?? []).map((r) => r.id);
    const waybillCounts: Record<string, number> = {};
    if (ids.length) {
      const { data: wbs } = await supabaseAdmin.from("waybills").select("forwarding_id").in("forwarding_id", ids);
      for (const w of wbs ?? []) {
        if (w.forwarding_id) waybillCounts[w.forwarding_id] = (waybillCounts[w.forwarding_id] ?? 0) + 1;
      }
    }
    const items = (rows ?? []).map((r: any) => ({
      ...r,
      route_name: r.shipping_routes?.name_zh ?? null,
      waybill_count: waybillCounts[r.id] ?? 0,
    }));
    return { items, total: count ?? 0, page, pageSize };
  });

export const getForwardingDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [foR, itemsR, waybillsR, logsR] = await Promise.all([
      supabaseAdmin
        .from("forwarding_orders")
        .select("*, shipping_routes:route_id(code, name_zh, name_en)")
        .eq("id", data.id)
        .maybeSingle(),
      supabaseAdmin.from("forwarding_items").select("*").eq("forwarding_id", data.id),
      supabaseAdmin.from("waybills").select("*").eq("forwarding_id", data.id).order("created_at"),
      supabaseAdmin
        .from("admin_action_logs")
        .select("*")
        .eq("entity_type", "forwarding")
        .eq("entity_id", data.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (!foR.data) throw new Error("Forwarding order not found");
    let user: any = null;
    if (foR.data.user_id) {
      const { data: u } = await supabaseAdmin
        .from("profiles")
        .select(
          "id, email, full_name, phone, customer_code, reg_country, reg_province, reg_city, reg_address, reg_postal_code, reg_phone",
        )
        .eq("id", foR.data.user_id)
        .maybeSingle();
      user = u;
    }
    let shippingAddress: any = null;
    if (foR.data.address_id) {
      const { data: addr } = await supabaseAdmin
        .from("addresses")
        .select("*")
        .eq("id", foR.data.address_id)
        .maybeSingle();
      shippingAddress = addr;
    }
    // Timeline: follow the FIRST waybill only (avoids duplicating events per waybill).
    const events: any[] = [];
    const wbList = (waybillsR.data ?? []) as any[];
    const firstWaybillNo = wbList[0]?.waybill_no ?? null;
    if (firstWaybillNo) {
      const { data: ships } = await supabaseAdmin
        .from("shipments")
        .select("id, tracking_no")
        .eq("tracking_no", firstWaybillNo);
      const shipIds = (ships ?? []).map((s: any) => s.id);
      if (shipIds.length) {
        const { data: evs } = await supabaseAdmin
          .from("tracking_events")
          .select("*")
          .in("shipment_id", shipIds)
          .order("event_time", { ascending: true });
        for (const e of evs ?? []) events.push(e);
      }
    }
    // Synthetic "订单已生成" event from forwarding_orders.created_at as the first entry
    events.push({
      id: `synthetic-created-${foR.data.id}`,
      status_zh: "订单已生成",
      status_en: "Order created",
      location_zh: foR.data.warehouse ?? null,
      location_en: foR.data.warehouse ?? null,
      event_time: foR.data.created_at,
      source: "admin_manual",
      source_ref: foR.data.request_no ?? null,
    });
    // Per-waybill surcharge totals (for merged waybill list column)
    const waybillIds = wbList.map((w) => w.id);
    const surTotals: Record<string, { total: number; count: number }> = {};
    if (waybillIds.length) {
      const { data: surs } = await supabaseAdmin
        .from("surcharges")
        .select("waybill_id, amount_cny")
        .eq("scope", "waybill")
        .in("waybill_id", waybillIds);
      for (const s of surs ?? []) {
        const wid = (s as any).waybill_id as string;
        if (!surTotals[wid]) surTotals[wid] = { total: 0, count: 0 };
        surTotals[wid].total += Number((s as any).amount_cny ?? 0);
        surTotals[wid].count += 1;
      }
    }
    const waybills = wbList.map((w) => ({
      ...w,
      surcharge_total_cny: +(surTotals[w.id]?.total ?? 0).toFixed(2),
      surcharge_count: surTotals[w.id]?.count ?? 0,
    }));
    const fo = { ...foR.data, route_name: (foR.data as any).shipping_routes?.name_zh ?? null };
    return {
      fo,
      items: itemsR.data ?? [],
      waybills,
      logs: logsR.data ?? [],
      user,
      shippingAddress,
      events,
    };
  });

export const intakeForwarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { id: string; route_id: string; declared_value_cad?: number; note?: string; apply_fee?: boolean }) => d,
  )
  .handler(async ({ data, context }) => {
    const { isStaff } = await getLevel(context.supabase, context.userId);
    if (!isStaff) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("forwarding_orders").select("*").eq("id", data.id).maybeSingle();
    if (!before) throw new Error("Not found");
    // Aggregate weight/volume from child waybills
    const { data: wbs } = await supabaseAdmin
      .from("waybills")
      .select("weight_kg, length_cm, width_cm, height_cm")
      .eq("forwarding_id", data.id);
    let total_weight = 0,
      total_vol = 0;
    for (const w of wbs ?? []) {
      total_weight += Number(w.weight_kg ?? 0);
      if (w.length_cm && w.width_cm && w.height_cm) {
        total_vol += Number(w.length_cm) * Number(w.width_cm) * Number(w.height_cm);
      }
    }
    if (total_weight <= 0 || total_vol <= 0) throw new Error("请先在集运单下添加运单并录入重量/尺寸");
    const snapshot = await computeFreight(
      supabaseAdmin,
      data.route_id,
      total_weight,
      total_vol,
      data.declared_value_cad ?? null,
    );
    if (!snapshot) throw new Error("线路无运费规则");
    const update: any = {
      route_id: data.route_id,
      actual_weight_kg: total_weight,
      weight_kg: total_weight,
      declared_value_cad: data.declared_value_cad ?? null,
      note: data.note ?? before.note,
      box_count: (wbs ?? []).length || before.box_count,
      freight_snapshot: snapshot,
      intake_at: new Date().toISOString(),
      intake_by: context.userId,
      status: before.status === "pending" || before.status === "draft" ? "received" : before.status,
    };
    if (data.apply_fee !== false) update.fee_cny = snapshot.freight_cny;
    const { error } = await supabaseAdmin.from("forwarding_orders").update(update).eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordLog(supabaseAdmin, {
      entity_type: "forwarding",
      entity_id: data.id,
      action: "intake",
      before: {
        status: before.status,
        fee_cny: before.fee_cny,
        freight_snapshot: before.freight_snapshot,
      },
      after: { status: update.status, fee_cny: update.fee_cny, freight_snapshot: snapshot },
      operator_id: context.userId,
      operator_name: await getOperatorName(supabaseAdmin, context.userId),
      note: "入库：根据运单汇总尺寸/重量并计费",
    });
    await recomputeForwardingTotal(supabaseAdmin, data.id);
    return { ok: true, snapshot, total_weight, total_volume_cm3: total_vol };
  });

// Preview freight without persisting
export const previewForwardingFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; route_id: string; declared_value_cad?: number }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wbs } = await supabaseAdmin
      .from("waybills")
      .select("weight_kg, length_cm, width_cm, height_cm")
      .eq("forwarding_id", data.id);
    let total_weight = 0,
      total_vol = 0;
    for (const w of wbs ?? []) {
      total_weight += Number(w.weight_kg ?? 0);
      if (w.length_cm && w.width_cm && w.height_cm)
        total_vol += Number(w.length_cm) * Number(w.width_cm) * Number(w.height_cm);
    }
    let snapshot: any =
      total_weight > 0 && total_vol > 0
        ? await computeFreight(supabaseAdmin, data.route_id, total_weight, total_vol, data.declared_value_cad ?? null)
        : null;
    // 与 recomputeForwardingTotal 一致：预览运费 = 计费重 * 单价（不加最低收费 / 清关费）
    if (snapshot) {
      const cw = Number(snapshot.chargeable_weight ?? 0);
      const uCad = Number(snapshot.unit_price_cad ?? 0);
      const uCny = Number(snapshot.unit_price_cny ?? 0);
      const fx = Number(snapshot.fx_rate ?? 0.19);
      const f = uCad > 0 ? cw * uCad : uCny > 0 ? cw * uCny * fx : 0;
      snapshot = {
        ...snapshot,
        freight_cad: +f.toFixed(2),
        freight_cny: fx > 0 ? +(f / fx).toFixed(2) : 0,
      };
    }
    return {
      snapshot,
      total_weight,
      total_volume_cm3: total_vol,
      waybill_count: (wbs ?? []).length,
    };
  });

// ============================================================
//   WAYBILLS
// ============================================================
export const listWaybills = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { status?: WaybillStatus | "all"; search?: string; batch_id?: string; page?: number; pageSize?: number }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, data.pageSize ?? 25);
    let q = supabaseAdmin
      .from("waybills")
      .select(
        `
        id, waybill_no, intl_tracking_no, shipping_method, status, payment_status,
        weight_kg, length_cm, width_cm, height_cm, assigned_batch_id, batch_no,
        carton_id, pallet_id, order_id, forwarding_id, user_id, created_at,
        items_summary,
        orders:order_id (id, order_no, customer_code),
        forwarding_orders:forwarding_id (id, request_no, customer_code)
      `,
        { count: "exact" },
      )
      .order("created_at", { ascending: false });
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.batch_id) q = q.eq("assigned_batch_id", data.batch_id);
    if (data.search?.trim()) {
      const s = data.search.trim();
      q = q.or(`waybill_no.ilike.%${s}%,intl_tracking_no.ilike.%${s}%,batch_no.ilike.%${s}%`);
    }
    const { data: rows, error, count } = await q.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    // Resolve profiles separately (no FK from waybills.user_id to profiles)
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id).filter(Boolean) as string[]));
    const profMap = new Map<string, any>();
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, customer_code, full_name")
        .in("id", userIds);
      for (const p of (profs ?? []) as any[]) profMap.set(p.id, p);
    }
    let items = (rows ?? []).map((r: any) => {
      const o = r.orders && !(r.orders as any).code ? r.orders : null;
      const f = r.forwarding_orders && !(r.forwarding_orders as any).code ? r.forwarding_orders : null;
      const prof = profMap.get(r.user_id);
      return {
        ...r,
        parent_no: o?.order_no ?? f?.request_no ?? null,
        parent_kind: o ? "order" : f ? "forwarding" : null,
        parent_id: o?.id ?? f?.id ?? null,
        customer_code: o?.customer_code ?? f?.customer_code ?? prof?.customer_code ?? null,
        customer_name: prof?.full_name ?? null,
      };
    });
    if (data.search?.trim()) {
      const s = data.search.trim().toLowerCase();
      items = items.filter(
        (r: any) =>
          (r.waybill_no ?? "").toLowerCase().includes(s) ||
          (r.intl_tracking_no ?? "").toLowerCase().includes(s) ||
          (r.batch_no ?? "").toLowerCase().includes(s) ||
          (r.parent_no ?? "").toLowerCase().includes(s) ||
          (r.customer_code ?? "").toLowerCase().includes(s),
      );
    }
    return { waybills: items, total: count ?? 0, page, pageSize };
  });

// 用最简分数表达带小数的数量：3.333... => "10/3"（分母限制 <=999，否则回落到小数）。
function toFraction(n: number): {
  display: string;
  numerator: number;
  denominator: number;
  value: number;
} {
  if (!isFinite(n) || n <= 0) return { display: "0", numerator: 0, denominator: 1, value: 0 };
  if (Number.isInteger(n)) return { display: String(n), numerator: n, denominator: 1, value: n };
  // Stern-Brocot / continued fraction, 分母上限 999
  const maxDen = 999;
  const a = Math.floor(n);
  let h1 = 1,
    k1 = 0,
    h = a,
    k = 1;
  let x = n - a;
  while (x > 1e-9) {
    const y = 1 / x;
    const b = Math.floor(y);
    const h2 = b * h + h1;
    const k2 = b * k + k1;
    if (k2 > maxDen) break;
    h1 = h;
    k1 = k;
    h = h2;
    k = k2;
    x = y - b;
  }
  const whole = Math.floor(h / k);
  const rem = h - whole * k;
  const display = whole > 0 && rem > 0 ? `${whole} ${rem}/${k}` : whole > 0 ? String(whole) : `${h}/${k}`;
  return { display, numerator: h, denominator: k, value: h / k };
}

export const getWaybillDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { waybillId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wb } = await supabaseAdmin.from("waybills").select("*").eq("id", data.waybillId).maybeSingle();
    if (!wb) throw new Error("Waybill not found");
    const { data: ship } = await supabaseAdmin
      .from("shipments")
      .select("id")
      .eq("tracking_no", wb.waybill_no)
      .maybeSingle();
    const [eventsR, logsR, scR] = await Promise.all([
      ship
        ? supabaseAdmin
            .from("tracking_events")
            .select("*")
            .eq("shipment_id", ship.id)
            .order("event_time", { ascending: false })
        : Promise.resolve({ data: [] as any[] }),
      supabaseAdmin
        .from("admin_action_logs")
        .select("*")
        .eq("entity_type", "waybill")
        .eq("entity_id", data.waybillId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin.from("surcharges").select("*").eq("scope", "waybill").eq("waybill_id", data.waybillId),
    ]);

    // === 每条运单的品名 / 数量 / 单价 / 申报价 / HS / 关税 ===
    // 走 duty.server 统一口径（与 waybills.duty_cad 落库、批次账单一致）
    let items_breakdown: any[] = [];
    let declared_cad_computed = 0;
    let duty_cad_computed = 0;
    let route_id_for_customs: string | null = null;
    let customs_enabled = false;
    let unmatched_names: string[] = [];
    if (wb.forwarding_id) {
      const { computeWaybillDutyBreakdown } = await import("./duty.server");
      const br = await computeWaybillDutyBreakdown(supabaseAdmin, wb);
      items_breakdown = br.items;
      declared_cad_computed = br.declared_cad;
      duty_cad_computed = br.duty_cad;
      route_id_for_customs = br.route_id;
      customs_enabled = br.customs_enabled;
      unmatched_names = br.unmatched_names;
    }

    // === 目的地：取收件地址的目的地（非线路目的地） ===
    let address_destination_code: string | null = null;
    try {
      if (wb.order_id) {
        const { data: o } = await supabaseAdmin
          .from("orders")
          .select("user_id, address_snapshot")
          .eq("id", wb.order_id)
          .maybeSingle();
        address_destination_code = (o as any)?.address_snapshot?.destination_code ?? null;
        if (!address_destination_code && (o as any)?.user_id) {
          const { data: a } = await supabaseAdmin
            .from("addresses")
            .select("destination_code")
            .eq("user_id", (o as any).user_id)
            .eq("is_default", true)
            .maybeSingle();
          address_destination_code = a?.destination_code ?? null;
        }
      } else if (wb.forwarding_id) {
        const { data: f } = await supabaseAdmin
          .from("forwarding_orders")
          .select("user_id, address_id, address:address_id(destination_code)")
          .eq("id", wb.forwarding_id)
          .maybeSingle();
        address_destination_code = (f as any)?.address?.destination_code ?? null;
        if (!address_destination_code && (f as any)?.user_id) {
          const { data: a } = await supabaseAdmin
            .from("addresses")
            .select("destination_code")
            .eq("user_id", (f as any).user_id)
            .eq("is_default", true)
            .maybeSingle();
          address_destination_code = a?.destination_code ?? null;
        }
      }
    } catch {
      /* ignore */
    }

    return {
      waybill: wb,
      address_destination_code,

      events: (eventsR as any).data ?? [],
      logs: logsR.data ?? [],
      surcharges: (scR as any).data ?? [],
      items_breakdown,
      computed: {
        declared_cad: declared_cad_computed,
        duty_cad: duty_cad_computed,
        route_id: route_id_for_customs,
        customs_enabled,
        unmatched_names,
      },
      shipment_id: ship?.id ?? null,
    };
  });

export const setWaybillStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      waybillIds: string[];
      status: WaybillStatus;
      note?: string;
      public_event?: {
        status_zh: string;
        status_en?: string;
        location_zh?: string;
        location_en?: string;
      };
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    if (!data.waybillIds.length) return { ok: true, count: 0 };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const operator = await getOperatorName(supabaseAdmin, context.userId);
    const { data: before } = await supabaseAdmin
      .from("waybills")
      .select("id, waybill_no, status")
      .in("id", data.waybillIds);
    const { error } = await supabaseAdmin.from("waybills").update({ status: data.status }).in("id", data.waybillIds);
    if (error) throw new Error(error.message);

    for (const w of before ?? []) {
      await recordLog(supabaseAdmin, {
        entity_type: "waybill",
        entity_id: w.id,
        action: "set_status",
        before: { status: w.status },
        after: { status: data.status },
        operator_id: context.userId,
        operator_name: operator,
        note: data.note,
      });
      if (data.public_event) {
        let { data: ship } = await supabaseAdmin
          .from("shipments")
          .select("id")
          .eq("tracking_no", w.waybill_no)
          .maybeSingle();
        if (!ship) {
          const { data: ins } = await supabaseAdmin
            .from("shipments")
            .insert({ tracking_no: w.waybill_no, status: "created" })
            .select("id")
            .single();
          ship = ins;
        }
        if (ship) {
          await supabaseAdmin.from("tracking_events").insert({
            shipment_id: ship.id,
            status_zh: data.public_event.status_zh,
            status_en: data.public_event.status_en ?? data.public_event.status_zh,
            location_zh: data.public_event.location_zh ?? null,
            location_en: data.public_event.location_en ?? null,
            source: "admin_action",
          });
        }
      }
    }
    return { ok: true, count: (before ?? []).length };
  });

export const addTrackingEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      waybillIds: string[];
      event: {
        status_zh: string;
        status_en?: string;
        location_zh?: string;
        location_en?: string;
        event_time?: string;
      };
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { isOwner, isManager, isStaff } = await getLevel(context.supabase, context.userId);
    if (!isStaff) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const operator = await getOperatorName(supabaseAdmin, context.userId);
    const { data: wbs } = await supabaseAdmin.from("waybills").select("id, waybill_no").in("id", data.waybillIds);
    let inserted = 0;
    for (const w of wbs ?? []) {
      let { data: ship } = await supabaseAdmin
        .from("shipments")
        .select("id")
        .eq("tracking_no", w.waybill_no)
        .maybeSingle();
      if (!ship) {
        const { data: ins } = await supabaseAdmin
          .from("shipments")
          .insert({ tracking_no: w.waybill_no, status: "created" })
          .select("id")
          .single();
        ship = ins;
      }
      if (!ship) continue;
      const { error } = await supabaseAdmin.from("tracking_events").insert({
        shipment_id: ship.id,
        status_zh: data.event.status_zh,
        status_en: data.event.status_en ?? data.event.status_zh,
        location_zh: data.event.location_zh ?? null,
        location_en: data.event.location_en ?? null,
        event_time: data.event.event_time ?? new Date().toISOString(),
        source: "admin_action",
      });
      if (!error) {
        inserted++;
        await recordLog(supabaseAdmin, {
          entity_type: "waybill",
          entity_id: w.id,
          action: "add_tracking_event",
          after: data.event,
          operator_id: context.userId,
          operator_name: operator,
        });
      }
    }
    return { ok: true, inserted };
  });

export const editTrackingEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      eventId: string;
      patch: {
        status_zh?: string;
        status_en?: string;
        location_zh?: string;
        location_en?: string;
        event_time?: string;
      };
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("tracking_events").update(data.patch).eq("id", data.eventId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteTrackingEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { eventId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("tracking_events").delete().eq("id", data.eventId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTrackingPresets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("tracking_event_presets")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return { presets: data ?? [] };
  });

export const upsertTrackingPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; payload: any }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.id) {
      const { error } = await supabaseAdmin.from("tracking_event_presets").update(data.payload).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("tracking_event_presets").insert(data.payload);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteTrackingPreset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("tracking_event_presets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============================================================
//   BATCHES
// ============================================================

// ---- Fee summary computation (shared between detail view and persist-on-lock) ----
// Returns: { totals: {freight,customs,insurance,clearance,storage,delivery,inspection,surcharge,grand_total},
//            per_customer: [{...}], unassigned: {...}, independent_clearance: {...} }
export async function computeBatchFeeSummary(admin: any, batchId: string) {
  // === 1. Load raw entities under the batch ===
  const [batchR, directWbsR, cartonsR, palletsR] = await Promise.all([
    admin.from("batches").select("id, batch_no").eq("id", batchId).maybeSingle(),
    admin.from("waybills").select("*").eq("assigned_batch_id", batchId).is("carton_id", null).is("pallet_id", null),
    admin.from("cartons").select("*").eq("batch_id", batchId),
    admin.from("pallets").select("*").eq("batch_id", batchId),
  ]);
  if (!batchR.data) throw new Error("Batch not found");

  const directWbs: any[] = directWbsR.data ?? [];
  const cartons: any[] = cartonsR.data ?? [];
  const pallets: any[] = palletsR.data ?? [];
  const cartonIds = cartons.map((c) => c.id);
  const palletIds = pallets.map((p) => p.id);

  // Waybills nested inside cartons/pallets
  const [cartonWbsR, palletWbsR, palletCartonsR] = await Promise.all([
    cartonIds.length
      ? admin.from("waybills").select("*").in("carton_id", cartonIds)
      : Promise.resolve({ data: [] as any[] }),
    palletIds.length
      ? admin.from("waybills").select("*").in("pallet_id", palletIds).is("carton_id", null)
      : Promise.resolve({ data: [] as any[] }),
    palletIds.length
      ? admin.from("cartons").select("*").in("pallet_id", palletIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const cartonWbs: any[] = cartonWbsR.data ?? [];
  const palletDirectWbs: any[] = palletWbsR.data ?? [];
  const palletCartons: any[] = palletCartonsR.data ?? [];
  const palletCartonIds = palletCartons.map((c) => c.id);
  const palletCartonWbsR = palletCartonIds.length
    ? await admin.from("waybills").select("*").in("carton_id", palletCartonIds)
    : { data: [] as any[] };
  const palletCartonWbs: any[] = (palletCartonWbsR as any).data ?? [];

  const allWbs = [...directWbs, ...cartonWbs, ...palletDirectWbs, ...palletCartonWbs];
  const allCartons = [...cartons, ...palletCartons];

  // === 2. Resolve parents (orders/forwardings/profiles) ===
  const orderIds = Array.from(new Set(allWbs.map((w) => w.order_id).filter(Boolean)));
  const fwdIds = Array.from(new Set(allWbs.map((w) => w.forwarding_id).filter(Boolean)));
  const [ordersR, fwdR] = await Promise.all([
    orderIds.length
      ? admin
          .from("orders")
          .select(
            "id, order_no, customer_code, user_id, route_code, route_id, shipping_cny, customs_cny, insurance_cny, address_snapshot",
          )
          .in("id", orderIds)
      : Promise.resolve({ data: [] as any[] }),
    fwdIds.length
      ? admin
          .from("forwarding_orders")
          .select(
            "id, request_no, customer_code, user_id, route_code, route_id, fee_cny, address_id, address:address_id(postal_code)",
          )
          .in("id", fwdIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const oMap = new Map(((ordersR as any).data ?? []).map((o: any) => [o.id, o]));
  const fMap = new Map(((fwdR as any).data ?? []).map((f: any) => [f.id, f]));

  const userIds = Array.from(
    new Set(
      [
        ...allWbs.map((w) => w.user_id),
        ...allCartons.map((c) => c.customer_user_id),
        ...pallets.map((p) => p.customer_user_id),
      ].filter(Boolean) as string[],
    ),
  );
  const userMap = new Map<string, any>();
  if (userIds.length) {
    const { data: profs } = await admin.from("profiles").select("id, customer_code, full_name").in("id", userIds);
    for (const p of (profs ?? []) as any[]) userMap.set(p.id, p);
  }

  function wbCustomer(w: any): string | null {
    const p: any = (w.order_id && oMap.get(w.order_id)) || (w.forwarding_id && fMap.get(w.forwarding_id));
    if (p?.customer_code) return p.customer_code;
    return w.user_id ? (userMap.get(w.user_id)?.customer_code ?? null) : null;
  }
  function wbRoute(w: any): { code: string | null; id: string | null } {
    const p: any = (w.order_id && oMap.get(w.order_id)) || (w.forwarding_id && fMap.get(w.forwarding_id));
    if (p?.route_code || p?.route_id) return { code: p?.route_code ?? null, id: p?.route_id ?? null };
    // 回退：取所在箱/托盘的线路，避免同一客户被拆成「无线路」和「有线路」两组
    const ct = w.carton_id ? allCartons.find((c: any) => c.id === w.carton_id) : null;
    if (ct?.route_code || ct?.route_id) return { code: ct.route_code ?? null, id: ct.route_id ?? null };
    const pl = w.pallet_id ? pallets.find((x: any) => x.id === w.pallet_id) : null;
    if (pl?.route_code || pl?.route_id) return { code: pl.route_code ?? null, id: pl.route_id ?? null };
    return { code: null, id: null };
  }

  function wbWV(w: any) {
    const wt = Number(w.weight_kg ?? 0);
    const L = Number(w.length_cm ?? 0),
      W = Number(w.width_cm ?? 0),
      H = Number(w.height_cm ?? 0);
    const vol = L && W && H ? (L * W * H) / 1_000_000 : 0;
    return { w: wt, v: vol };
  }
  function wbFreight(w: any): number {
    if (Number(w.freight_cad ?? 0) > 0) return Number(w.freight_cad);
    const o = w.order_id ? (oMap.get(w.order_id) as any) : null;
    const f = w.forwarding_id ? (fMap.get(w.forwarding_id) as any) : null;
    return Number(o?.shipping_cny ?? 0) + Number(f?.fee_cny ?? 0);
  }
  function wbInsurance(w: any): number {
    if (Number(w.insurance_cad ?? 0) > 0) return Number(w.insurance_cad);
    const o = w.order_id ? (oMap.get(w.order_id) as any) : null;
    return Number(o?.insurance_cny ?? 0);
  }
  function wbDuty(w: any): number {
    if (Number(w.duty_cad ?? 0) > 0) return Number(w.duty_cad);
    const o = w.order_id ? (oMap.get(w.order_id) as any) : null;
    return Number(o?.customs_cny ?? 0);
  }

  // === 3. Surcharges ===
  const allWbIds = allWbs.map((w) => w.id);
  const allCartonIdsAll = [...cartonIds, ...palletCartonIds];
  const surchargeMap = {
    waybill: new Map<string, number>(),
    carton: new Map<string, number>(),
    pallet: new Map<string, number>(),
    batchByCustomer: new Map<string, number>(),
    batchUnassigned: 0,
  };
  // 检查费 / 派送费 存为带标记的批次附加费，单独提取，不计入普通附加费
  const inspectionByCustomer = new Map<string, number>();
  const deliveryByCustomer = new Map<string, number>();
  const discountByCustomer = new Map<string, number>();
  const [scWb, scCt, scPl, scBt, settleR] = await Promise.all([
    allWbIds.length
      ? admin.from("surcharges").select("waybill_id, amount_cny").eq("scope", "waybill").in("waybill_id", allWbIds)
      : Promise.resolve({ data: [] as any[] }),
    allCartonIdsAll.length
      ? admin.from("surcharges").select("carton_id, amount_cny").eq("scope", "carton").in("carton_id", allCartonIdsAll)
      : Promise.resolve({ data: [] as any[] }),
    palletIds.length
      ? admin.from("surcharges").select("pallet_id, amount_cny").eq("scope", "pallet").in("pallet_id", palletIds)
      : Promise.resolve({ data: [] as any[] }),
    admin.from("surcharges").select("customer_code, amount_cny, note").eq("scope", "batch").eq("batch_id", batchId),
    admin.from("batch_settlements").select("customer_code, confirmed, confirmed_at").eq("batch_id", batchId),
  ]);
  const confirmedByCustomer = new Map<string, { confirmed: boolean; confirmed_at: string | null }>();
  for (const s of ((settleR as any).data ?? []) as any[])
    confirmedByCustomer.set(s.customer_code, { confirmed: !!s.confirmed, confirmed_at: s.confirmed_at ?? null });
  for (const s of (scWb as any).data ?? [])
    surchargeMap.waybill.set(s.waybill_id, (surchargeMap.waybill.get(s.waybill_id) ?? 0) + Number(s.amount_cny ?? 0));
  for (const s of (scCt as any).data ?? [])
    surchargeMap.carton.set(s.carton_id, (surchargeMap.carton.get(s.carton_id) ?? 0) + Number(s.amount_cny ?? 0));
  for (const s of (scPl as any).data ?? [])
    surchargeMap.pallet.set(s.pallet_id, (surchargeMap.pallet.get(s.pallet_id) ?? 0) + Number(s.amount_cny ?? 0));
  for (const s of (scBt as any).data ?? []) {
    const amt = Number(s.amount_cny ?? 0);
    const note: string = s.note ?? "";
    const code: string | null = s.customer_code ?? null;
    if (code && note.startsWith("[inspection]")) {
      inspectionByCustomer.set(code, (inspectionByCustomer.get(code) ?? 0) + amt);
      continue;
    }
    if (code && note.startsWith("[delivery]")) {
      deliveryByCustomer.set(code, (deliveryByCustomer.get(code) ?? 0) + amt);
      continue;
    }
    if (code && note.startsWith("[discount]")) {
      discountByCustomer.set(code, (discountByCustomer.get(code) ?? 0) + Math.max(0, amt));
      continue;
    }
    if (code) surchargeMap.batchByCustomer.set(code, (surchargeMap.batchByCustomer.get(code) ?? 0) + amt);
    else surchargeMap.batchUnassigned += amt;
  }

  // === 4. Clearance per route ===
  const routeCodesInUse = Array.from(new Set(allWbs.map((w) => wbRoute(w).code).filter(Boolean) as string[]));
  // 清关费 / 最低收费只在批次级生效（运单级已取消）
  const clearanceByRoute = new Map<string, { fee: number; level: "waybill" | "batch"; route_id: string }>();
  const minChargeBatchByRoute = new Map<string, number>();
  const deliveryRuleByRoute = new Map<
    string,
    {
      light_max_kg: number;
      light_fee_cad: number;
      heavy_min_kg: number;
      unit_fee_cad: number;
      oversize_len_cm: number;
      overweight_ratio: number;
      remote_prefixes: string[];
    }
  >();
  if (routeCodesInUse.length) {
    const { data: routes } = await admin.from("shipping_routes").select("id, code").in("code", routeCodesInUse);
    const routeIds = (routes ?? []).map((r: any) => r.id);
    const { data: rules } = routeIds.length
      ? await admin
          .from("freight_rules")
          .select(
            "route_id, clearance_fee_batch_cad, min_charge_batch_cad, delivery_light_max_kg, delivery_light_fee_cad, delivery_heavy_min_kg, delivery_unit_fee_cad, oversize_alert_length_cm, overweight_alert_ratio, remote_postal_prefixes",
          )
          .in("route_id", routeIds)
          .eq("is_active", true)
      : { data: [] as any[] };
    const ruleByRoute = new Map((rules ?? []).map((r: any) => [r.route_id, r]));
    for (const r of routes ?? []) {
      const rule: any = ruleByRoute.get(r.id);
      if (rule) {
        clearanceByRoute.set(r.code, {
          fee: Number(rule.clearance_fee_batch_cad ?? 0),
          level: "batch",
          route_id: r.id,
        });
        minChargeBatchByRoute.set(r.code, Number(rule.min_charge_batch_cad ?? 0));
        deliveryRuleByRoute.set(r.code, {
          light_max_kg: Number(rule.delivery_light_max_kg ?? 0),
          light_fee_cad: Number(rule.delivery_light_fee_cad ?? 0),
          heavy_min_kg: Number(rule.delivery_heavy_min_kg ?? 0),
          unit_fee_cad: Number(rule.delivery_unit_fee_cad ?? 0),
          oversize_len_cm: Number(rule.oversize_alert_length_cm ?? 0),
          overweight_ratio: Number(rule.overweight_alert_ratio ?? 0),
          remote_prefixes: String(rule.remote_postal_prefixes ?? "")
            .split(/[,，\s]+/)
            .map((s: string) => s.trim().toUpperCase())
            .filter(Boolean),
        });
      }
    }
  }

  // === 5. Load customer schemes upfront ===
  const schemeByCustomer = new Map<string, "merged" | "split">();
  {
    const codes = Array.from(
      new Set([
        ...(allWbs.map((w) => wbCustomer(w)).filter(Boolean) as string[]),
        ...(allCartons.map((c) => c.customer_code).filter(Boolean) as string[]),
        ...(pallets.map((p) => p.customer_code).filter(Boolean) as string[]),
      ]),
    );
    if (codes.length) {
      const { data: profs } = await admin
        .from("profiles")
        .select("customer_code, fee_scheme_preference")
        .in("customer_code", codes);
      for (const p of (profs ?? []) as any[]) {
        schemeByCustomer.set(p.customer_code, ((p as any).fee_scheme_preference ?? "split") as "merged" | "split");
      }
    }
  }
  const schemeOf = (code: string | null) => (code ? (schemeByCustomer.get(code) ?? "split") : "split");

  // === 6. Buckets per (customer, route) ===
  type WbDetail = {
    id: string;
    waybill_no: string;
    status: string;
    payment_status: string;
    weight_kg: number;
    volume_m3: number;
    fee_cad: number;
    source: "direct" | "carton" | "pallet";
    carton_id: string | null;
    pallet_id: string | null;
  };
  type CtDetail = {
    id: string;
    carton_no: string;
    weight_kg: number;
    volume_m3: number;
    scheme: "A" | "B";
    fee_cad: number;
    a_cad: number;
    b_cad: number;
    pallet_id: string | null;
    has_customer_code: boolean;
  };
  type PlDetail = {
    id: string;
    pallet_no: string;
    weight_kg: number;
    volume_m3: number;
    scheme: "A" | "B";
    fee_cad: number;
    a_cad: number;
    b_cad: number;
    has_customer_code: boolean;
  };
  type Bucket = {
    customer_code: string | null;
    customer_name: string | null;
    route_code: string | null;
    route_id: string | null;
    waybill_ids: Set<string>;
    freight: number;
    customs: number;
    insurance: number;
    clearance: number;
    surcharge: number;
    inspection: number;
    delivery: number;
    discount: number;
    delivery_suggested: number;
    delivery_note: string | null;
    warnings: { kind: "oversize" | "overweight" | "remote"; ref: string; detail: string }[];
    confirmed: boolean;
    confirmed_at: string | null;
    weight_kg: number;
    volume_m3: number;
    waybills: WbDetail[];
    cartons: CtDetail[];
    pallets: PlDetail[];
    insurance_sources: number;
    surcharge_sources: number;
    clearance_note: {
      route_code: string;
      fee: number;
      level: "waybill" | "batch";
      count?: number;
    }[];
    insurance_details: { ref_type: "waybill"; ref: string; ref_id: string; amount_cad: number }[];
    surcharge_details: {
      scope: "waybill" | "carton" | "pallet" | "batch";
      ref: string;
      ref_id: string | null;
      amount_cad: number;
    }[];
  };
  const buckets = new Map<string, Bucket>();
  function bKey(code: string | null, routeCode: string | null) {
    return `${code ?? "__unassigned__"}||${routeCode ?? ""}`;
  }
  function bucket(code: string | null, routeCode: string | null, routeId: string | null = null): Bucket {
    const k = bKey(code, routeCode);
    let b = buckets.get(k);
    if (!b) {
      let name: string | null = null;
      if (code)
        for (const p of userMap.values())
          if ((p as any).customer_code === code) {
            name = (p as any).full_name;
            break;
          }
      b = {
        customer_code: code,
        customer_name: name,
        route_code: routeCode,
        route_id: routeId,
        waybill_ids: new Set(),
        freight: 0,
        customs: 0,
        insurance: 0,
        clearance: 0,
        surcharge: 0,
        inspection: 0,
        delivery: 0,
        discount: 0,
        delivery_suggested: 0,
        delivery_note: null,
        warnings: [],
        confirmed: code ? (confirmedByCustomer.get(code)?.confirmed ?? false) : false,
        confirmed_at: code ? (confirmedByCustomer.get(code)?.confirmed_at ?? null) : null,
        weight_kg: 0,
        volume_m3: 0,
        waybills: [],
        cartons: [],
        pallets: [],
        insurance_sources: 0,
        surcharge_sources: 0,
        clearance_note: [],
        insurance_details: [],
        surcharge_details: [],
      };
      buckets.set(k, b);
    }
    if (!b.route_id && routeId) b.route_id = routeId;
    return b;
  }

  // === 7. Accumulate insurance/customs/surcharge/clearance from ALL waybills (scheme-independent) ===
  const seenWbId = new Set<string>();
  for (const w of allWbs) {
    if (seenWbId.has(w.id)) continue;
    seenWbId.add(w.id);
    const cc = wbCustomer(w);
    const { code: rc, id: rid } = wbRoute(w);
    const b = bucket(cc, rc, rid);
    b.waybill_ids.add(w.id);
    const ins = wbInsurance(w);
    const duty = wbDuty(w);
    b.insurance += ins;
    b.customs += duty;
    if (ins > 0) {
      b.insurance_sources++;
      b.insurance_details.push({
        ref_type: "waybill",
        ref: w.waybill_no ?? "",
        ref_id: w.id,
        amount_cad: +ins.toFixed(2),
      });
    }
    const sur = surchargeMap.waybill.get(w.id) ?? 0;
    if (sur !== 0) {
      b.surcharge += sur;
      b.surcharge_sources++;
      b.surcharge_details.push({
        scope: "waybill",
        ref: w.waybill_no ?? "",
        ref_id: w.id,
        amount_cad: +sur.toFixed(2),
      });
    }
    // 运单级清关费已取消，清关费只在批次级按 (线路, 客户号) 加一次
  }
  // Batch-level clearance: per (route, customer) once
  const groupSet = new Set<string>();
  const clearanceGroups: any[] = [];
  const independentPerCustomer = new Map<string, number>();
  for (const w of allWbs) {
    const cc = wbCustomer(w);
    const rc = wbRoute(w).code;
    if (!cc || !rc) continue;
    const rule = clearanceByRoute.get(rc);
    if (!rule || rule.level !== "batch" || !rule.fee) continue;
    const k = `${rc}|${cc}`;
    if (groupSet.has(k)) continue;
    groupSet.add(k);
    clearanceGroups.push({ route_code: rc, customer_code: cc, fee_cny: +rule.fee.toFixed(2) });
    const b = bucket(cc, rc);
    b.clearance += rule.fee;
    b.clearance_note.push({ route_code: rc, fee: rule.fee, level: "batch" });
    independentPerCustomer.set(cc, (independentPerCustomer.get(cc) ?? 0) + rule.fee);
  }
  // Carton/pallet surcharges → bucket of the container (if customer-coded) OR each contained waybill's bucket if not
  for (const c of allCartons) {
    const sur = surchargeMap.carton.get(c.id) ?? 0;
    if (sur === 0) continue;
    if (c.customer_code) {
      const b = bucket(c.customer_code, c.route_code ?? null, c.route_id ?? null);
      b.surcharge += sur;
      b.surcharge_sources++;
      b.surcharge_details.push({
        scope: "carton",
        ref: c.carton_no ?? "",
        ref_id: c.id,
        amount_cad: +sur.toFixed(2),
      });
    } else {
      // attribute to first contained waybill's bucket (simplification)
      const contained = allWbs.filter((w) => w.carton_id === c.id);
      if (contained.length) {
        const w0 = contained[0];
        const b = bucket(wbCustomer(w0), wbRoute(w0).code, wbRoute(w0).id);
        b.surcharge += sur;
        b.surcharge_sources++;
        b.surcharge_details.push({
          scope: "carton",
          ref: c.carton_no ?? "",
          ref_id: c.id,
          amount_cad: +sur.toFixed(2),
        });
      }
    }
  }
  for (const p of pallets) {
    const sur = surchargeMap.pallet.get(p.id) ?? 0;
    if (sur === 0) continue;
    if (p.customer_code) {
      const b = bucket(p.customer_code, p.route_code ?? null, p.route_id ?? null);
      b.surcharge += sur;
      b.surcharge_sources++;
      b.surcharge_details.push({
        scope: "pallet",
        ref: p.pallet_no ?? "",
        ref_id: p.id,
        amount_cad: +sur.toFixed(2),
      });
    }
  }
  // Batch-level surcharges by customer
  for (const [code, amt] of surchargeMap.batchByCustomer) {
    const routeBuckets = [...buckets.values()]
      .filter((b) => b.customer_code === code)
      .sort((a, b) => (a.route_code ?? "").localeCompare(b.route_code ?? ""));
    const target = routeBuckets[0] ?? bucket(code, null);
    target.surcharge += amt;
    if (amt !== 0) {
      target.surcharge_sources++;
      target.surcharge_details.push({
        scope: "batch",
        ref: `批次附加费 · ${code}`,
        ref_id: null,
        amount_cad: +amt.toFixed(2),
      });
    }
  }
  // 检查费 / 派送费（批次级、按客户，挂在该客户的第一个线路分组上）
  function firstBucketOf(code: string) {
    const rb = [...buckets.values()]
      .filter((b) => b.customer_code === code)
      .sort((a, b) => (a.route_code ?? "").localeCompare(b.route_code ?? ""));
    return rb[0] ?? bucket(code, null);
  }
  for (const [code, amt] of inspectionByCustomer) firstBucketOf(code).inspection += amt;
  for (const [code, amt] of deliveryByCustomer) firstBucketOf(code).delivery += amt;
  for (const [code, amt] of discountByCustomer) firstBucketOf(code).discount += amt;

  // === 8. Top-level display items with scheme-aware weight/volume/freight ===
  function pushWbDisplay(w: any, source: "direct" | "carton" | "pallet") {
    const cc = wbCustomer(w);
    const { code: rc, id: rid } = wbRoute(w);
    const b = bucket(cc, rc, rid);
    const { w: wt, v: vol } = wbWV(w);
    const fee = wbFreight(w);
    b.weight_kg += wt;
    b.volume_m3 += vol;
    if (schemeOf(cc) === "split") b.freight += fee;
    b.waybills.push({
      id: w.id,
      waybill_no: w.waybill_no ?? "",
      status: w.status ?? "",
      payment_status: w.payment_status ?? "",
      weight_kg: +wt.toFixed(3),
      volume_m3: +vol.toFixed(4),
      fee_cad: +fee.toFixed(2),
      source,
      carton_id: w.carton_id ?? null,
      pallet_id: w.pallet_id ?? null,
    });
  }
  function pushCartonDisplay(c: any, contained: any[]) {
    const cc: string | null =
      c.customer_code ?? (c.customer_user_id ? (userMap.get(c.customer_user_id)?.customer_code ?? null) : null);
    if (!cc) return;
    const rc: string | null = c.route_code ?? null;
    const rid: string | null = c.route_id ?? null;
    const b = bucket(cc, rc, rid);
    const scheme = schemeOf(cc);
    let wt = 0,
      vol = 0,
      fee = 0;
    if (scheme === "merged") {
      wt = Number(c.self_weight_kg ?? 0);
      vol = Number(c.self_volume_m3 ?? 0);
      fee = Number(c.self_freight_cad ?? c.self_freight_cny ?? 0);
    } else {
      for (const w of contained) {
        const wv = wbWV(w);
        wt += wv.w;
        vol += wv.v;
        fee += wbFreight(w);
      }
    }
    b.weight_kg += wt;
    b.volume_m3 += vol;
    if (scheme === "split") b.freight += fee;
    b.cartons.push({
      id: c.id,
      carton_no: c.carton_no ?? "",
      weight_kg: +wt.toFixed(3),
      volume_m3: +vol.toFixed(4),
      scheme: scheme === "merged" ? "A" : "B",
      fee_cad: +fee.toFixed(2),
      a_cad: +(scheme === "merged" ? fee : Number(c.with_customer_total_cad ?? 0)).toFixed(2),
      b_cad: +(scheme === "split" ? fee : Number(c.without_customer_total_cad ?? 0)).toFixed(2),
      pallet_id: c.pallet_id ?? null,
      has_customer_code: true,
    });
  }
  function pushPalletDisplay(p: any, direct: any[], cartonsUnder: { c: any; wbs: any[] }[]) {
    const cc: string | null =
      p.customer_code ?? (p.customer_user_id ? (userMap.get(p.customer_user_id)?.customer_code ?? null) : null);
    if (!cc) return;
    const rc: string | null = p.route_code ?? null;
    const rid: string | null = p.route_id ?? null;
    const b = bucket(cc, rc, rid);
    const scheme = schemeOf(cc);
    let wt = 0,
      vol = 0,
      fee = 0;
    if (scheme === "merged") {
      wt = Number(p.self_weight_kg ?? 0);
      vol = Number(p.self_volume_m3 ?? 0);
      fee = Number(p.self_freight_cad ?? p.self_freight_cny ?? 0);
    } else {
      for (const w of direct) {
        const wv = wbWV(w);
        wt += wv.w;
        vol += wv.v;
        fee += wbFreight(w);
      }
      for (const { wbs } of cartonsUnder)
        for (const w of wbs) {
          const wv = wbWV(w);
          wt += wv.w;
          vol += wv.v;
          fee += wbFreight(w);
        }
    }
    b.weight_kg += wt;
    b.volume_m3 += vol;
    if (scheme === "split") b.freight += fee;
    b.pallets.push({
      id: p.id,
      pallet_no: p.pallet_no ?? "",
      weight_kg: +wt.toFixed(3),
      volume_m3: +vol.toFixed(4),
      scheme: scheme === "merged" ? "A" : "B",
      fee_cad: +fee.toFixed(2),
      a_cad: +(scheme === "merged" ? fee : Number(p.with_customer_total_cad ?? 0)).toFixed(2),
      b_cad: +(scheme === "split" ? fee : Number(p.without_customer_total_cad ?? 0)).toFixed(2),
      has_customer_code: true,
    });
  }

  // Iterate top-level items
  for (const w of directWbs) pushWbDisplay(w, "direct");
  // Direct cartons under batch (pallet_id null)
  for (const c of cartons) {
    const contained = cartonWbs.filter((w) => w.carton_id === c.id);
    if (c.customer_code) pushCartonDisplay(c, contained);
    else for (const w of contained) pushWbDisplay(w, "carton");
  }
  // Pallets under batch
  for (const p of pallets) {
    const direct = palletDirectWbs.filter((w) => w.pallet_id === p.id);
    const cartonsIn = palletCartons
      .filter((c) => c.pallet_id === p.id)
      .map((c) => ({ c, wbs: palletCartonWbs.filter((w) => w.carton_id === c.id) }));
    if (p.customer_code) {
      pushPalletDisplay(p, direct, cartonsIn);
    } else {
      // pallet not customer-coded: waybills/cartons inside become top-level
      for (const w of direct) pushWbDisplay(w, "pallet");
      for (const { c, wbs } of cartonsIn) {
        if (c.customer_code) pushCartonDisplay(c, wbs);
        else for (const w of wbs) pushWbDisplay(w, "carton");
      }
    }
  }

  // === 9. Scheme A: recompute freight via route rate from aggregated weight/volume ===
  for (const b of buckets.values()) {
    if (!b.customer_code) continue;
    if (schemeOf(b.customer_code) !== "merged") continue;
    if (!b.route_id) continue;
    const snap = await computeFreight(admin, b.route_id, b.weight_kg, b.volume_m3 * 1_000_000, null);
    b.freight = snap ? +Number((snap as any).freight_cad ?? 0).toFixed(2) : 0;
  }

  // === 10. Customs items per (customer, route) — HS 明细统一口径 ===
  // 集运运单：computeWaybillDutyBreakdown（与 waybills.duty_cad 落库完全一致）
  // 电商订单：order_items × products.hs_code / hs_codes 名称匹配
  const { computeWaybillDutyBreakdown, buildHsIndex, matchHsForName } = await import("./duty.server");
  const { data: allHs } = await admin
    .from("hs_codes")
    .select("hs_code, name_zh, name_en, aliases, mfn_rate, gst_rate, anti_dumping_rate");
  const hsIndex = buildHsIndex((allHs ?? []) as any[]);

  const itemsByKey = new Map<string, Map<string, any>>(); // key → "name|hs" → merged row
  const unmatchedByKey = new Map<string, Set<string>>();
  function addItem(key: string, row: any) {
    let m = itemsByKey.get(key);
    if (!m) {
      m = new Map();
      itemsByKey.set(key, m);
    }
    const dedupKey = `${row.name}|${row.hs_code ?? ""}`;
    const existing = m.get(dedupKey);
    if (existing) {
      existing.quantity += row.quantity;
      existing.declared_value_cad = +(existing.declared_value_cad + row.declared_value_cad).toFixed(2);
      existing.duty_cad = +(existing.duty_cad + row.duty_cad).toFixed(2);
      existing.cartons_qty += row.cartons_qty;
    } else {
      m.set(dedupKey, { ...row });
    }
  }
  function markUnmatched(key: string, name: string) {
    let s = unmatchedByKey.get(key);
    if (!s) {
      s = new Set();
      unmatchedByKey.set(key, s);
    }
    s.add(name);
  }

  // ---- 集运侧：逐运单调用 duty helper ----
  for (const w of allWbs) {
    if (!w.forwarding_id) continue;
    const cc = wbCustomer(w);
    if (!cc) continue;
    const rc = wbRoute(w).code;
    const key = bKey(cc, rc);
    const br = await computeWaybillDutyBreakdown(admin, w);
    for (const it of br.items) {
      if (!it.hs_code) markUnmatched(key, it.name);
      addItem(key, {
        name: it.name,
        hs_code: it.hs_code,
        mfn_rate: it.mfn_rate,
        gst_rate: it.gst_rate,
        anti_dumping_rate: it.anti_dumping_rate,
        tax_rate: it.tax_rate,
        unit_price_cad: it.unit_price_cad,
        quantity: it.quantity_per_waybill,
        cartons_qty: 1,
        items_per_carton: it.quantity_per_waybill,
        declared_value_cad: it.declared_value_cad,
        duty_cad: it.duty_cad,
      });
    }
  }

  // ---- 电商侧：order_items × products.hs_code / 名称匹配 ----
  const fx = await getFxCadPerCny(admin);
  if (orderIds.length) {
    const { data: items } = await admin
      .from("order_items")
      .select("id, order_id, name_zh, unit_price_cny, quantity, product_id")
      .in("order_id", orderIds);
    const productIds = Array.from(new Set(((items ?? []) as any[]).map((i) => i.product_id).filter(Boolean)));
    const prodMap = new Map<string, any>();
    if (productIds.length) {
      const { data: prods } = await admin
        .from("products")
        .select("id, hs_code, pack_qty, name_zh")
        .in("id", productIds);
      for (const p of (prods ?? []) as any[]) prodMap.set(p.id, p);
    }
    for (const it of (items ?? []) as any[]) {
      const order = oMap.get(it.order_id) as any;
      const cc = order?.customer_code as string | undefined;
      if (!cc) continue;
      const rc: string | null = order?.route_code ?? null;
      const key = bKey(cc, rc);
      const prod = it.product_id ? prodMap.get(it.product_id) : null;
      const explicitHs = prod?.hs_code as string | undefined;
      const { hs, matched } = matchHsForName(it.name_zh ?? "", hsIndex, explicitHs);
      const mfn = Number(hs?.mfn_rate ?? 0),
        gst = Number(hs?.gst_rate ?? 0),
        ad = Number(hs?.anti_dumping_rate ?? 0);
      const rate = mfn + gst + ad;
      const packQty = Number(prod?.pack_qty ?? 1) || 1;
      const qty = Number(it.quantity ?? 0);
      const cartonsQty = Math.ceil(qty / packQty);
      const unitCad = +(Number(it.unit_price_cny ?? 0) * fx).toFixed(4);
      const declared = +(unitCad * qty).toFixed(2);
      const duty = +(declared * rate).toFixed(2);
      if (!hs) markUnmatched(key, it.name_zh ?? "");
      addItem(key, {
        name: it.name_zh,
        hs_code: hs?.hs_code ?? null,
        mfn_rate: mfn,
        gst_rate: gst,
        anti_dumping_rate: ad,
        tax_rate: rate,
        unit_price_cad: unitCad,
        quantity: qty,
        cartons_qty: cartonsQty,
        items_per_carton: packQty,
        declared_value_cad: declared,
        duty_cad: duty,
        _hs_match: matched,
      });
    }
  }

  // Override bucket customs with computed duty
  const itemsMapMerged = new Map<string, any[]>();
  for (const [k, m] of itemsByKey) {
    const arr = [...m.values()];
    itemsMapMerged.set(k, arr);
    const b = buckets.get(k);
    if (b) b.customs = +arr.reduce((s, r) => s + Number(r.duty_cad ?? 0), 0).toFixed(2);
  }

  // 批次级最低收费：同线路同客户号在本批次内合并后判断一次
  for (const b of buckets.values()) {
    const minBatch = b.route_code ? (minChargeBatchByRoute.get(b.route_code) ?? 0) : 0;
    if (minBatch > 0 && b.freight < minBatch) b.freight = +minBatch.toFixed(2);
  }

  const unmatchedMapMerged = new Map<string, string[]>();
  for (const [k, s] of unmatchedByKey) unmatchedMapMerged.set(k, [...s]);

  // === 10.5 末端派送费建议值 + 超长/超重/偏远预警 ===
  {
    const dimsOf = (x: any) => [Number(x?.length_cm ?? 0), Number(x?.width_cm ?? 0), Number(x?.height_cm ?? 0)];
    const postalOf = (w: any): string => {
      const p: any = (w.order_id && oMap.get(w.order_id)) || (w.forwarding_id && fMap.get(w.forwarding_id));
      // orders 有 address_snapshot；forwarding_orders 只有 address_id（内联 addresses）
      const snap: any = p?.address_snapshot ?? p?.address ?? null;
      return String(snap?.postal_code ?? snap?.postal ?? snap?.zip ?? "")
        .replace(/\s+/g, "")
        .toUpperCase();
    };
    for (const b of buckets.values()) {
      if (!b.customer_code) continue;
      const rule = b.route_code ? deliveryRuleByRoute.get(b.route_code) : undefined;
      // 建议派送费
      if (rule) {
        const units = b.cartons.length + b.pallets.length;
        if (rule.light_max_kg > 0 && b.weight_kg < rule.light_max_kg && rule.light_fee_cad > 0) {
          b.delivery_suggested = +rule.light_fee_cad.toFixed(2);
          b.delivery_note = `重量 ${b.weight_kg.toFixed(2)}kg < ${rule.light_max_kg}kg → 固定派送费 ${rule.light_fee_cad}`;
        } else if (rule.heavy_min_kg > 0 && b.weight_kg > rule.heavy_min_kg && rule.unit_fee_cad > 0) {
          b.delivery_suggested = +(rule.unit_fee_cad * units).toFixed(2);
          b.delivery_note = `重量 ${b.weight_kg.toFixed(2)}kg > ${rule.heavy_min_kg}kg → ${units} 板/箱 × ${rule.unit_fee_cad}`;
        }
      }
      // 未手工保存过派送费时，默认采用建议值（与结算抽屉的「实际扣款」保持一致）
      if (!deliveryByCustomer.has(b.customer_code) && b.delivery === 0 && b.delivery_suggested > 0) {
        b.delivery = b.delivery_suggested;
      }

      const wbIds = b.waybill_ids;
      const myWbs = allWbs.filter((w) => wbIds.has(w.id));
      const myCartons = allCartons.filter((c) => c.customer_code === b.customer_code);
      const myPallets = pallets.filter((p) => p.customer_code === b.customer_code);
      const check = (ref: string, x: any) => {
        const dims = dimsOf(x);
        const maxSide = Math.max(...dims, 0);
        const wt = Number(x?.weight_kg ?? 0);
        const vol = dims[0] && dims[1] && dims[2] ? (dims[0]! * dims[1]! * dims[2]!) / 1_000_000 : 0;
        if (rule?.oversize_len_cm && maxSide > rule.oversize_len_cm)
          b.warnings.push({
            kind: "oversize",
            ref,
            detail: `最长边 ${maxSide}cm > ${rule.oversize_len_cm}cm`,
          });
        if (rule?.overweight_ratio && vol > 0 && wt / vol > rule.overweight_ratio)
          b.warnings.push({
            kind: "overweight",
            ref,
            detail: `体积重量比 ${(wt / vol).toFixed(0)}kg/m³ > ${rule.overweight_ratio}`,
          });
      };
      for (const w of myWbs) check(w.waybill_no ?? "运单", w);
      for (const c of myCartons) check(c.carton_no ?? "箱", c);
      for (const p of myPallets) check(p.pallet_no ?? "托盘", p);
      if (rule?.remote_prefixes.length) {
        const remote = new Set<string>();
        for (const w of myWbs) {
          const pc = postalOf(w);
          if (pc && rule.remote_prefixes.some((pre) => pc.startsWith(pre))) remote.add(pc);
        }
        for (const pc of remote) b.warnings.push({ kind: "remote", ref: pc, detail: `收货邮编 ${pc} 属偏远地区` });
      }
    }
  }

  // === 11. Totals & per_customer output ===
  let total_freight = 0,
    total_customs = 0,
    total_insurance = 0,
    total_clearance = 0,
    total_surcharge = 0,
    total_delivery = 0,
    total_inspection = 0,
    total_discount = 0;
  for (const b of buckets.values()) {
    total_freight += b.freight;
    total_customs += b.customs;
    total_insurance += b.insurance;
    total_clearance += b.clearance;
    total_surcharge += b.surcharge;
    total_delivery += b.delivery;
    total_inspection += b.inspection;
    total_discount += b.discount;
  }
  total_surcharge += surchargeMap.batchUnassigned;
  const totals = {
    total_freight_cny: +total_freight.toFixed(2),
    total_customs_cny: +total_customs.toFixed(2),
    total_insurance_cny: +total_insurance.toFixed(2),
    total_clearance_cny: +total_clearance.toFixed(2),
    total_storage_cny: 0,
    total_delivery_cny: +total_delivery.toFixed(2),
    total_inspection_cny: +total_inspection.toFixed(2),
    total_surcharge_cny: +total_surcharge.toFixed(2),
    total_discount_cny: +total_discount.toFixed(2),
  };
  const grand_total_cny = +(
    totals.total_freight_cny +
    totals.total_customs_cny +
    totals.total_insurance_cny +
    totals.total_clearance_cny +
    totals.total_delivery_cny +
    totals.total_inspection_cny +
    totals.total_surcharge_cny -
    totals.total_discount_cny
  ).toFixed(2);

  const per_customer = [...buckets.entries()]
    .filter(([_k, b]) => !!b.customer_code)
    .map(([k, b]) => {
      const grossSubtotal = +(
        b.freight +
        b.customs +
        b.insurance +
        b.clearance +
        b.surcharge +
        b.delivery +
        b.inspection
      ).toFixed(2);
      const discount = Math.min(grossSubtotal, Math.max(0, +b.discount.toFixed(2)));
      const subtotal = Math.max(0, +(grossSubtotal - discount).toFixed(2));
      const scheme = schemeOf(b.customer_code);
      const items = itemsMapMerged.get(k) ?? [];
      return {
        customer_code: b.customer_code,
        customer_name: b.customer_name,
        route_code: b.route_code,
        route_id: b.route_id,
        group_key: k,
        fee_scheme: scheme,
        waybill_count: b.waybills.length,
        carton_count: b.cartons.length,
        pallet_count: b.pallets.length,
        weight_kg: +b.weight_kg.toFixed(3),
        volume_m3: +b.volume_m3.toFixed(4),
        fee_freight_cny: +b.freight.toFixed(2),
        fee_customs_cny: +b.customs.toFixed(2),
        fee_insurance_cny: +b.insurance.toFixed(2),
        fee_clearance_cny: +b.clearance.toFixed(2),
        fee_storage_cny: 0,
        fee_delivery_cny: +b.delivery.toFixed(2),
        fee_inspection_cny: +b.inspection.toFixed(2),
        fee_discount_cny: discount,
        gross_subtotal_cny: grossSubtotal,
        fee_surcharge_cny: +b.surcharge.toFixed(2),
        subtotal_cny: subtotal,
        fee_freight_cad: +b.freight.toFixed(2),
        fee_customs_cad: +b.customs.toFixed(2),
        fee_insurance_cad: +b.insurance.toFixed(2),
        fee_clearance_cad: +b.clearance.toFixed(2),
        fee_surcharge_cad: +b.surcharge.toFixed(2),
        fee_delivery_cad: +b.delivery.toFixed(2),
        fee_inspection_cad: +b.inspection.toFixed(2),
        fee_discount_cad: discount,
        gross_subtotal_cad: grossSubtotal,
        delivery_suggested_cad: +b.delivery_suggested.toFixed(2),
        delivery_note: b.delivery_note,
        warnings: b.warnings,
        price_confirmed: b.confirmed,
        price_confirmed_at: b.confirmed_at,
        subtotal_cad: subtotal,
        insurance_source_count: b.insurance_sources,
        surcharge_source_count: b.surcharge_sources,
        clearance_note: b.clearance_note,
        insurance_details: b.insurance_details,
        surcharge_details: b.surcharge_details,
        waybills: b.waybills,
        cartons: b.cartons,
        pallets: b.pallets,
        items,
        unmatched_hs_names: unmatchedMapMerged.get(k) ?? [],
      };
    })
    .sort((a, b) => {
      const c = (a.customer_code ?? "").localeCompare(b.customer_code ?? "");
      return c !== 0 ? c : (a.route_code ?? "").localeCompare(b.route_code ?? "");
    });

  const unAgg = [...buckets.values()].filter((b) => !b.customer_code);
  const unassigned = unAgg.length
    ? {
        waybill_count: unAgg.reduce((s, b) => s + b.waybill_ids.size, 0),
        weight_kg: +unAgg.reduce((s, b) => s + b.weight_kg, 0).toFixed(3),
        volume_m3: +unAgg.reduce((s, b) => s + b.volume_m3, 0).toFixed(4),
        fee_freight_cny: +unAgg.reduce((s, b) => s + b.freight, 0).toFixed(2),
        fee_customs_cny: +unAgg.reduce((s, b) => s + b.customs, 0).toFixed(2),
        fee_insurance_cny: +unAgg.reduce((s, b) => s + b.insurance, 0).toFixed(2),
        fee_clearance_cny: +unAgg.reduce((s, b) => s + b.clearance, 0).toFixed(2),
        fee_surcharge_cny: +(unAgg.reduce((s, b) => s + b.surcharge, 0) + surchargeMap.batchUnassigned).toFixed(2),
        subtotal_cny: +(
          unAgg.reduce((s, b) => s + b.freight + b.customs + b.insurance + b.clearance + b.surcharge, 0) +
          surchargeMap.batchUnassigned
        ).toFixed(2),
      }
    : null;

  const independent_clearance = {
    groups: clearanceGroups,
    customer_count: independentPerCustomer.size,
    total_fee_cny: +clearanceGroups.reduce((s, g) => s + g.fee_cny, 0).toFixed(2),
    per_customer: [...independentPerCustomer.entries()].map(([customer_code, fee_cny]) => ({
      customer_code,
      fee_cny: +fee_cny.toFixed(2),
    })),
  };

  return {
    totals,
    grand_total_cny,
    per_customer,
    unassigned,
    independent_clearance,
    waybill_total: seenWbId.size,
    direct_waybill_count: directWbs.length,
    carton_count: cartons.length,
    pallet_count: pallets.length,
  };
}

// ---- Shared batch settlement (wallet or offline) ----
// Used by both the staff "扣款" action (wallet or EMT/cash) and the customer
// self-service "钱包支付" action, so both sides create the exact same shape of
// invoice from the exact same authoritative per-waybill numbers. Idempotent:
// only unpaid waybills are considered, so a second call for an already-settled
// batch is a no-op ({ ok:false, reason:'already_paid' }) instead of double-charging.
// 批次级「末端派送费 / 检查费」（按客户）——展示端由 computeBatchFeeSummary 计入总额，
// 结算与账单必须使用同一数值，否则客户看到的金额与实际扣款不一致。
async function batchExtraFeesCad(
  admin: any,
  batchId: string,
  customerCode: string,
): Promise<{ delivery: number; inspection: number; discount: number }> {
  if (!customerCode) return { delivery: 0, inspection: 0, discount: 0 };
  try {
    const summary: any = await computeBatchFeeSummary(admin, batchId);
    let delivery = 0,
      inspection = 0,
      discount = 0;
    for (const p of (summary?.per_customer ?? []) as any[]) {
      if (p.customer_code !== customerCode) continue;
      delivery += Number(p.fee_delivery_cad ?? 0);
      inspection += Number(p.fee_inspection_cad ?? 0);
      discount += Number(p.fee_discount_cad ?? 0);
    }
    return { delivery: +delivery.toFixed(2), inspection: +inspection.toFixed(2), discount: +discount.toFixed(2) };
  } catch {
    return { delivery: 0, inspection: 0, discount: 0 };
  }
}

async function settleBatchForCustomer(
  admin: any,
  params: {
    batchId: string;
    customerUserId: string;
    customerCode: string;
    method: "wallet" | "emt" | "cash";
    discountCad?: number;
    refNo?: string;
    note?: string;
    operatorId: string;
    operatorName: string;
    enforceBalance?: boolean; // true for customer self-service; false for staff override
    awardPoints?: boolean;
  },
): Promise<{
  ok: boolean;
  reason?: string;
  need_cad?: number;
  balance_cad?: number;
  invoice_id?: string;
  invoice_no?: string;
  paid_cad?: number;
  points_earned?: number;
}> {
  const { batchId, customerUserId, customerCode, method } = params;
  const discount = Math.max(0, Number(params.discountCad ?? 0));
  const FX = await getFxCadPerCny(admin);

  const { data: batchRow } = await admin.from("batches").select("batch_no").eq("id", batchId).maybeSingle();
  const batchNo = (batchRow as any)?.batch_no ?? batchId;

  // 1) Locate this customer's UNPAID waybills in the batch (via their orders/forwarding requests —
  // waybills has no customer_code column of its own).
  let wbList: any[] = [];
  if (customerCode) {
    const [oR, fR] = await Promise.all([
      admin.from("orders").select("id").eq("customer_code", customerCode),
      admin.from("forwarding_orders").select("id").eq("customer_code", customerCode),
    ]);
    const oIds = ((oR.data ?? []) as any[]).map((o) => o.id);
    const fIds = ((fR.data ?? []) as any[]).map((f) => f.id);
    const filters: string[] = [];
    if (oIds.length) filters.push(`order_id.in.(${oIds.join(",")})`);
    if (fIds.length) filters.push(`forwarding_id.in.(${fIds.join(",")})`);
    if (filters.length) {
      const { data: wbs } = await admin
        .from("waybills")
        .select(
          "id, waybill_no, order_id, forwarding_id, freight_cad, duty_cad, insurance_cad, clearance_cad, surcharge_cad, payment_status",
        )
        .eq("assigned_batch_id", batchId)
        .or(filters.join(","));
      wbList = ((wbs ?? []) as any[]).filter((w) => w.payment_status !== "paid");
    }
  }
  if (wbList.length === 0) return { ok: false, reason: "already_paid" };

  // 2) Authoritative totals from these waybills (server-computed — never trust a client-supplied amount)
  const { buildInvoiceLineMeta } = await import("./duty.server");
  // One query for every surcharge note across these waybills, so 附加费 rows
  // can show what they're actually for instead of a bare number.
  const { data: surchargeRows } = await admin
    .from("surcharges")
    .select("waybill_id, note, amount_cny")
    .in(
      "waybill_id",
      wbList.map((w) => w.id),
    );
  const surchargeNotesByWaybill = new Map<string, string[]>();
  for (const s of (surchargeRows ?? []) as any[]) {
    if (!s.waybill_id) continue;
    const arr = surchargeNotesByWaybill.get(s.waybill_id) ?? [];
    if (s.note) arr.push(s.note);
    surchargeNotesByWaybill.set(s.waybill_id, arr);
  }

  let f = 0,
    cst = 0,
    ins = 0,
    other = 0;
  const lineItems: any[] = [];
  for (const w of wbList) {
    const wf = Number(w.freight_cad ?? 0),
      wc = Number(w.duty_cad ?? 0),
      wi = Number(w.insurance_cad ?? 0),
      wClearance = Number(w.clearance_cad ?? 0),
      wSurcharge = Number(w.surcharge_cad ?? 0);
    const fCny = +(wf / FX).toFixed(2),
      cCny = +(wc / FX).toFixed(2),
      iCny = +(wi / FX).toFixed(2),
      clearanceCny = +(wClearance / FX).toFixed(2),
      surchargeCny = +(wSurcharge / FX).toFixed(2);
    const oCny = +(clearanceCny + surchargeCny).toFixed(2);
    f += fCny;
    cst += cCny;
    ins += iCny;
    other += oCny;

    const meta = await buildInvoiceLineMeta(admin, w).catch(() => null);
    lineItems.push({
      waybill_id: w.id,
      order_id: w.order_id,
      forwarding_id: w.forwarding_id,
      description: `运单 ${w.waybill_no}`,
      freight_cny: fCny,
      customs_cny: cCny,
      insurance_cny: iCny,
      other_cny: 0,
      amount_cny: +(fCny + cCny + iCny).toFixed(2),
      meta,
    });
    // 清关费/附加费 broken into their own rows (费用类型起行) instead of a
    // combined "other" figure — same waybill reference, own subtotal.
    if (clearanceCny > 0) {
      lineItems.push({
        waybill_id: w.id,
        order_id: w.order_id,
        forwarding_id: w.forwarding_id,
        description: `清关费 · 批次 ${batchNo}`,
        freight_cny: 0,
        customs_cny: 0,
        insurance_cny: 0,
        other_cny: clearanceCny,
        amount_cny: clearanceCny,
        meta: {
          fee_type: "清关费",
          batch_no: batchNo,
          waybill_no: w.waybill_no,
          amount_cad: +wClearance.toFixed(2),
        },
      });
    }
    if (surchargeCny > 0) {
      const notes = surchargeNotesByWaybill.get(w.id) ?? [];
      lineItems.push({
        waybill_id: w.id,
        order_id: w.order_id,
        forwarding_id: w.forwarding_id,
        description: `附加费${notes.length ? ` · ${notes.join("、")}` : ""} · 运单 ${w.waybill_no}`,
        freight_cny: 0,
        customs_cny: 0,
        insurance_cny: 0,
        other_cny: surchargeCny,
        amount_cny: surchargeCny,
        meta: {
          fee_type: "附加费",
          batch_no: batchNo,
          waybill_no: w.waybill_no,
          note: notes.join("、") || null,
          amount_cad: +wSurcharge.toFixed(2),
        },
      });
    }
  }
  // 批次级派送费 / 检查费（展示端已计入总额，这里必须一并收取）
  const extras = await batchExtraFeesCad(admin, batchId, customerCode);
  for (const [label, cad] of [
    ["末端派送费", extras.delivery],
    ["检查费", extras.inspection],
  ] as const) {
    if (!cad) continue;
    const cny = +(cad / FX).toFixed(2);
    other += cny;
    lineItems.push({
      description: `${label} · 批次 ${batchNo}`,
      freight_cny: 0,
      customs_cny: 0,
      insurance_cny: 0,
      other_cny: cny,
      amount_cny: cny,
      meta: { fee_type: label, batch_no: batchNo, amount_cad: +cad.toFixed(2) },
    });
  }
  const subCny = +(f + cst + ins + other).toFixed(2);

  const discountCny = discount > 0 ? +(discount / FX).toFixed(2) : 0;
  const totalCny = +(subCny - discountCny).toFixed(2);
  const subCad = +(subCny * FX).toFixed(2);
  const finalDeduct = +(subCad - discount).toFixed(2);
  if (finalDeduct <= 0) return { ok: false, reason: "nothing_to_pay" };

  if (params.enforceBalance) {
    const { data: w } = await admin.from("wallets").select("balance_cad").eq("user_id", customerUserId).maybeSingle();
    const bal = Number((w as any)?.balance_cad ?? 0);
    if (bal < finalDeduct) return { ok: false, reason: "insufficient", need_cad: finalDeduct, balance_cad: bal };
  }

  const methodLabel = method === "wallet" ? "钱包扣款" : method === "emt" ? "EMT 收款" : "现金收款";

  // 3) wallet_transactions — trigger applies balance change only for method='wallet'
  const { error: txErr } = await admin.from("wallet_transactions").insert({
    user_id: customerUserId,
    type: "spend",
    status: "completed",
    amount_cad: finalDeduct,
    amount_cny: totalCny,
    channel: method,
    ref_no: params.refNo ?? null,
    note: params.note ?? `批次 ${batchNo} · ${methodLabel}${discount > 0 ? ` (含折扣 CA$${discount.toFixed(2)})` : ""}`,
  });
  if (txErr) throw new Error(txErr.message);

  // 4) Discount is already persisted by saveBatchCustomerFeeDraft. Do not add a
  // second negative surcharge during payment, otherwise the batch total is reduced twice.

  // 5) Invoice + items — 价格确认时可能已经生成过一张未付账单（每批次每客户一张），
  // 这里优先复用并把它改成已付，避免同一批次出现两张账单。
  const invoicePayload = {
    user_id: customerUserId,
    type: "batch",
    payment_method: method,
    subtotal_cny: subCny,
    freight_cny: +f.toFixed(2),
    customs_cny: +cst.toFixed(2),
    insurance_cny: +ins.toFixed(2),
    other_cny: +(other - discountCny).toFixed(2),
    total_cny: totalCny,
    paid_cny: totalCny,
    paid_cad: finalDeduct,
    status: "paid",
    fx_rate: FX,
    batch_no: batchNo,
    paid_at: new Date().toISOString(),
    due_date: new Date().toISOString().slice(0, 10),
    created_by: params.operatorId,
    note: `批次 ${batchNo} · ${methodLabel}${discount > 0 ? ` (折扣 CA$${discount.toFixed(2)})` : ""}`,
  } as any;

  const { data: pending } = await admin
    .from("invoices")
    .select("id")
    .eq("user_id", customerUserId)
    .eq("type", "batch")
    .eq("batch_no", batchNo)
    .in("status", ["unpaid", "overdue"])
    .order("created_at", { ascending: true })
    .limit(1);
  const pendingId: string | null = ((pending ?? []) as any[])[0]?.id ?? null;

  let inv: any = null;
  let invErr: any = null;
  if (pendingId) {
    await admin.from("invoice_items").delete().eq("invoice_id", pendingId);
    const r = await admin.from("invoices").update(invoicePayload).eq("id", pendingId).select("*").single();
    inv = r.data;
    invErr = r.error;
  } else {
    const r = await admin.from("invoices").insert(invoicePayload).select("*").single();
    inv = r.data;
    invErr = r.error;
  }
  if (invErr) throw new Error(invErr.message);
  const invoiceId: string | null = inv?.id ?? null;

  if (invoiceId) {
    await admin.from("invoice_items").insert(lineItems.map((li: any) => ({ ...li, invoice_id: invoiceId })));
    if (discountCny > 0) {
      await admin.from("invoice_items").insert({
        invoice_id: invoiceId,
        description: `折扣（${methodLabel}）`,
        freight_cny: 0,
        customs_cny: 0,
        insurance_cny: 0,
        other_cny: -discountCny,
        amount_cny: -discountCny,
        meta: {
          fee_type: "折扣",
          batch_no: batchNo,
          note: methodLabel,
          amount_cad: -+discount.toFixed(2),
        },
      });
    }
  }

  // 6) Mark waybills paid + logs + tracking events
  const wbIds = wbList.map((w) => w.id);
  await admin.from("waybills").update({ payment_status: "paid" }).in("id", wbIds);
  for (const w of wbList) {
    await recordLog(admin, {
      entity_type: "waybill",
      entity_id: w.id,
      action: "wallet_deduct_paid",
      after: { batch_no: batchNo, invoice_id: invoiceId, amount_cad: finalDeduct, method },
      operator_id: params.operatorId,
      operator_name: params.operatorName,
      note: `批次结算（批次 ${batchNo} · ${methodLabel}）`,
    });
    let { data: ship } = await admin.from("shipments").select("id").eq("tracking_no", w.waybill_no).maybeSingle();
    if (!ship) {
      const { data: insShip } = await admin
        .from("shipments")
        .insert({ tracking_no: w.waybill_no, status: "created" })
        .select("id")
        .single();
      ship = insShip;
    }
    if (ship) {
      await admin.from("tracking_events").insert({
        shipment_id: ship.id,
        status_zh: method === "wallet" ? "费用已支付（钱包扣款）" : `费用已支付（${methodLabel}）`,
        status_en: method === "wallet" ? "Payment settled (wallet)" : "Payment settled (offline)",
        event_time: new Date().toISOString(),
        source: "admin_action",
      });
    }
  }
  const orderIds = Array.from(new Set(wbList.map((w) => w.order_id).filter(Boolean)));
  const fwdIds = Array.from(new Set(wbList.map((w) => w.forwarding_id).filter(Boolean)));
  for (const oid of orderIds)
    await recordLog(admin, {
      entity_type: "order",
      entity_id: oid,
      action: "wallet_deduct_paid",
      after: { batch_no: batchNo, invoice_id: invoiceId, amount_cad: finalDeduct, method },
      operator_id: params.operatorId,
      operator_name: params.operatorName,
      note: `批次结算（批次 ${batchNo}）`,
    });
  for (const fid of fwdIds)
    await recordLog(admin, {
      entity_type: "forwarding",
      entity_id: fid,
      action: "wallet_deduct_paid",
      after: { batch_no: batchNo, invoice_id: invoiceId, amount_cad: finalDeduct, method },
      operator_id: params.operatorId,
      operator_name: params.operatorName,
      note: `批次结算（批次 ${batchNo}）`,
    });
  if (invoiceId)
    await recordLog(admin, {
      entity_type: "batch",
      entity_id: batchId,
      action: "invoice_create_and_pay",
      after: {
        invoice_id: invoiceId,
        batch_no: batchNo,
        amount_cad: finalDeduct,
        discount_cad: discount,
        method,
      },
      operator_id: params.operatorId,
      operator_name: params.operatorName,
      note: `生成账单并结清（客户 ${customerCode || customerUserId} · CA$${finalDeduct.toFixed(2)} · ${methodLabel}）`,
    });

  await admin.from("admin_action_logs").insert({
    entity_type: "batch",
    entity_id: batchId,
    action: "wallet_deduct",
    after: {
      user_id: customerUserId,
      customer_code: customerCode,
      amount_cad: finalDeduct,
      discount_cad: discount,
      invoice_id: invoiceId,
      method,
    },
    operator_id: params.operatorId,
    operator_name: params.operatorName,
    note: `客户 ${customerCode || customerUserId} 结算 CA$${finalDeduct.toFixed(2)}${discount > 0 ? `（折扣 CA$${discount.toFixed(2)}）` : ""}（批次 ${batchNo} · ${methodLabel}）`,
  });

  let points_earned = 0;
  if (params.awardPoints) {
    const { data: pts } = await admin.rpc("award_points_for_spend", {
      _user_id: customerUserId,
      _amount_cad: finalDeduct,
    });
    points_earned = Number(pts ?? 0);
  }

  return {
    ok: true,
    invoice_id: invoiceId ?? undefined,
    invoice_no: inv?.invoice_no,
    paid_cad: finalDeduct,
    points_earned,
  };
}

export const listBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const batchIds = (data ?? []).map((b: any) => b.id);
    const [cartonsR, palletsR, wbR, payments] = await Promise.all([
      supabaseAdmin
        .from("cartons")
        .select("id, batch_id")
        .in("batch_id", batchIds.length ? batchIds : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin
        .from("pallets")
        .select("id, batch_id")
        .in("batch_id", batchIds.length ? batchIds : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin.from("waybills").select("id, assigned_batch_id, carton_id, pallet_id"),
      Promise.all(
        (data ?? []).map(async (b: any) => {
          const { data: ps } = await supabaseAdmin.rpc("batch_payment_status", { _batch_id: b.id });
          return ps as string;
        }),
      ),
    ]);
    const cartonBatch = new Map<string, string>();
    for (const c of cartonsR.data ?? []) if (c.batch_id) cartonBatch.set(c.id, c.batch_id);
    const palletBatch = new Map<string, string>();
    for (const p of palletsR.data ?? []) if (p.batch_id) palletBatch.set(p.id, p.batch_id);

    const totals = new Map<string, number>();
    for (const w of wbR.data ?? []) {
      const bid =
        w.assigned_batch_id ||
        (w.carton_id && cartonBatch.get(w.carton_id)) ||
        (w.pallet_id && palletBatch.get(w.pallet_id));
      if (bid) totals.set(bid, (totals.get(bid) ?? 0) + 1);
    }
    const batches = (data ?? []).map((b: any, i: number) => ({
      ...b,
      payment_status: payments[i],
      waybill_total: totals.get(b.id) ?? 0,
      grand_total_cny: Number(b.grand_total_cny ?? 0),
    }));
    return { batches };
  });

export const getBatchDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [batchR, directWaybillsR, logsR] = await Promise.all([
      supabaseAdmin.from("batches").select("*").eq("id", data.batchId).maybeSingle(),
      supabaseAdmin
        .from("waybills")
        .select("*")
        .eq("assigned_batch_id", data.batchId)
        .is("carton_id", null)
        .is("pallet_id", null),
      supabaseAdmin
        .from("admin_action_logs")
        .select("*")
        .eq("entity_type", "batch")
        .eq("entity_id", data.batchId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (!batchR.data) throw new Error("Batch not found");
    const summary = await computeBatchFeeSummary(supabaseAdmin, data.batchId);

    // ---- Enrich direct waybills: customer_code + chargeable_weight_kg + total_cad ----
    const wbList = (directWaybillsR.data ?? []) as any[];
    const wbOrderIds = Array.from(new Set(wbList.map((w) => w.order_id).filter(Boolean)));
    const wbFwdIds = Array.from(new Set(wbList.map((w) => w.forwarding_id).filter(Boolean)));
    const [wbOrdersR, wbFwdR] = await Promise.all([
      wbOrderIds.length
        ? supabaseAdmin.from("orders").select("id, customer_code").in("id", wbOrderIds)
        : Promise.resolve({ data: [] as any[] }),
      wbFwdIds.length
        ? supabaseAdmin.from("forwarding_orders").select("id, customer_code").in("id", wbFwdIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const wbOMap = new Map(((wbOrdersR as any).data ?? []).map((o: any) => [o.id, o.customer_code]));
    const wbFMap = new Map(((wbFwdR as any).data ?? []).map((f: any) => [f.id, f.customer_code]));
    const waybills = wbList.map((w: any) => {
      const L = Number(w.length_cm ?? 0),
        W = Number(w.width_cm ?? 0),
        H = Number(w.height_cm ?? 0);
      const vol = L && W && H ? (L * W * H) / 6000 : 0;
      const chargeable = Math.max(Number(w.weight_kg ?? 0), vol);
      const total_cad =
        Number(w.freight_cad ?? 0) +
        Number(w.duty_cad ?? 0) +
        Number(w.insurance_cad ?? 0) +
        Number(w.clearance_cad ?? 0) +
        Number(w.surcharge_cad ?? 0);
      const customer_code =
        (w.order_id && wbOMap.get(w.order_id)) || (w.forwarding_id && wbFMap.get(w.forwarding_id)) || null;
      return {
        ...w,
        customer_code,
        chargeable_weight_kg: +chargeable.toFixed(3),
        total_cad: +total_cad.toFixed(2),
      };
    });

    // ---- Enrich per_customer with user_id, balance_cad, is_paid ----
    const customerCodes = summary.per_customer.map((c: any) => c.customer_code).filter(Boolean);
    let per_customer = summary.per_customer;
    if (customerCodes.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, customer_code")
        .in("customer_code", customerCodes);
      const profMap = new Map(((profs ?? []) as any[]).map((p) => [p.customer_code, p.id]));
      const userIds = Array.from(profMap.values()) as string[];
      const walletMap = new Map<string, number>();
      if (userIds.length) {
        const { data: ws } = await supabaseAdmin.from("wallets").select("user_id, balance_cad").in("user_id", userIds);
        for (const w of (ws ?? []) as any[]) walletMap.set(w.user_id, Number(w.balance_cad ?? 0));
      }
      // Payment status aggregation per customer in this batch
      // Simple approach: check if any waybill under this customer in this batch is unpaid
      const paidByCustomer = new Map<string, boolean>();
      {
        const allBatchWbsR = await supabaseAdmin
          .from("waybills")
          .select("id, order_id, forwarding_id, payment_status")
          .or(`assigned_batch_id.eq.${data.batchId}`);
        const wbs2: any[] = allBatchWbsR.data ?? [];
        // parent customer for each
        const oIds = Array.from(new Set(wbs2.map((w) => w.order_id).filter(Boolean)));
        const fIds = Array.from(new Set(wbs2.map((w) => w.forwarding_id).filter(Boolean)));
        const [oR, fR] = await Promise.all([
          oIds.length
            ? supabaseAdmin.from("orders").select("id, customer_code").in("id", oIds)
            : Promise.resolve({ data: [] as any[] }),
          fIds.length
            ? supabaseAdmin.from("forwarding_orders").select("id, customer_code").in("id", fIds)
            : Promise.resolve({ data: [] as any[] }),
        ]);
        const oM = new Map(((oR as any).data ?? []).map((o: any) => [o.id, o.customer_code]));
        const fM = new Map(((fR as any).data ?? []).map((f: any) => [f.id, f.customer_code]));
        const stateMap = new Map<string, { total: number; paid: number }>();
        for (const w of wbs2) {
          const cc = (w.order_id && oM.get(w.order_id)) || (w.forwarding_id && fM.get(w.forwarding_id));
          if (!cc) continue;
          const s = stateMap.get(cc) ?? { total: 0, paid: 0 };
          s.total++;
          if (w.payment_status === "paid") s.paid++;
          stateMap.set(cc, s);
        }
        for (const [cc, s] of stateMap) paidByCustomer.set(cc, s.total > 0 && s.paid === s.total);
      }
      per_customer = summary.per_customer.map((c: any) => ({
        ...c,
        user_id: profMap.get(c.customer_code) ?? null,
        balance_cad: profMap.get(c.customer_code) ? (walletMap.get(profMap.get(c.customer_code) as string) ?? 0) : 0,
        is_paid: paidByCustomer.get(c.customer_code) ?? false,
      }));
    }

    return {
      batch: batchR.data,
      waybills,
      logs: logsR.data ?? [],
      waybill_total: summary.waybill_total,
      fee_summary: { ...summary, per_customer },
      independent_clearance: summary.independent_clearance,
    };
  });

export const deductWalletForBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string; userId: string; amountCad: number; discountCad?: number; note?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, customer_code")
      .eq("id", data.userId)
      .maybeSingle();
    if (!profile) throw new Error("客户不存在");
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    const r = await settleBatchForCustomer(supabaseAdmin, {
      batchId: data.batchId,
      customerUserId: data.userId,
      customerCode: (profile as any).customer_code,
      method: "wallet",
      discountCad: data.discountCad,
      note: data.note,
      operatorId: context.userId,
      operatorName: operator_name,
      enforceBalance: false,
      awardPoints: false,
    });
    if (!r.ok) {
      if (r.reason === "already_paid") return { ok: false, reason: "already_paid" as const };
      throw new Error(r.reason ?? "扣款失败");
    }
    return {
      ok: true,
      invoice_id: r.invoice_id,
      deducted_cad: r.paid_cad,
      discount_cad: Math.max(0, Number(data.discountCad ?? 0)),
    };
  });

// Staff-only: settle a batch for a customer via an offline method (EMT / cash).
// Generates the same invoice as the wallet path, but the wallet_transactions
// row it writes is tagged with channel='emt'|'cash', which the apply_wallet_tx
// trigger skips — so wallets.balance_cad is left untouched while the row still
// shows up in the customer's transaction history for reconciliation.
export const deductBatchOffline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      batchId: string;
      userId: string;
      method: "emt" | "cash";
      discountCad?: number;
      refNo?: string;
      note?: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, customer_code")
      .eq("id", data.userId)
      .maybeSingle();
    if (!profile) throw new Error("客户不存在");
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    const r = await settleBatchForCustomer(supabaseAdmin, {
      batchId: data.batchId,
      customerUserId: data.userId,
      customerCode: (profile as any).customer_code,
      method: data.method,
      discountCad: data.discountCad,
      refNo: data.refNo,
      note: data.note,
      operatorId: context.userId,
      operatorName: operator_name,
      enforceBalance: false,
      awardPoints: false,
    });
    if (!r.ok) {
      if (r.reason === "already_paid") return { ok: false, reason: "already_paid" as const };
      throw new Error(r.reason ?? "登记收款失败");
    }
    return {
      ok: true,
      invoice_id: r.invoice_id,
      deducted_cad: r.paid_cad,
      discount_cad: Math.max(0, Number(data.discountCad ?? 0)),
    };
  });

// Customer self-service: pay off their own share of a batch from their wallet.
// Only visible/payable once the batch has shipped (see listMyBatches below) —
// mirrors the staff wallet-deduct path via the same settleBatchForCustomer
// helper, so the amount charged is always identical to what staff would see.
export const payMyBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: batch } = await supabaseAdmin
      .from("batches")
      .select("id, status")
      .eq("id", data.batchId)
      .maybeSingle();
    if (!batch || !["shipped", "arrived", "closed"].includes((batch as any).status)) {
      throw new Error("批次尚未发出，暂不可支付");
    }
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, customer_code, full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    const customerCode = (profile as any)?.customer_code ?? null;
    // 未经客服价格确认的批次不可付款
    if (customerCode) {
      const { data: st } = await supabaseAdmin
        .from("batch_settlements")
        .select("confirmed")
        .eq("batch_id", data.batchId)
        .eq("customer_code", customerCode)
        .maybeSingle();
      if (!(st as any)?.confirmed) throw new Error("该批次费用尚未确认，请联系客服");
    }
    const operatorName = (profile as any)?.full_name || (profile as any)?.email || context.userId;
    const r = await settleBatchForCustomer(supabaseAdmin, {
      batchId: data.batchId,
      customerUserId: context.userId,
      customerCode,
      method: "wallet",
      discountCad: 0,
      operatorId: context.userId,
      operatorName,
      enforceBalance: true,
      awardPoints: true,
    });
    return r;
  });

// Customer self-service: list the batches visible to the caller — a batch only
// appears once staff have moved it to 'shipped' or later, matching the same
// gate used by payMyBatch. Amounts come from computeBatchFeeSummary (the same
// function the staff "扣款" screens use), filtered down to this customer's own
// bucket only — never exposes other customers' figures.
export const listMyBatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("customer_code")
      .eq("id", context.userId)
      .maybeSingle();
    const customerCode = (profile as any)?.customer_code ?? null;

    const { data: myWbs } = await supabaseAdmin
      .from("waybills")
      .select("id, assigned_batch_id, order_id, forwarding_id, waybill_no, status, payment_status, intl_tracking_no")
      .eq("user_id", context.userId)
      .not("assigned_batch_id", "is", null);
    const wbRows = (myWbs ?? []) as any[];
    const batchIds = Array.from(new Set(wbRows.map((w) => w.assigned_batch_id).filter(Boolean)));
    if (!batchIds.length) return { batches: [] };

    const { data: batchRows } = await supabaseAdmin
      .from("batches")
      .select("id, batch_no, status, shipping_method, eta_date")
      .in("id", batchIds)
      .in("status", ["shipped", "arrived", "closed"]);
    const visibleBatches = (batchRows ?? []) as any[];
    if (!visibleBatches.length) return { batches: [] };

    const FX = await getFxCadPerCny(supabaseAdmin);

    const wbByBatch = new Map<string, any[]>();
    for (const w of wbRows) {
      if (!w.assigned_batch_id) continue;
      const arr = wbByBatch.get(w.assigned_batch_id) ?? [];
      arr.push(w);
      wbByBatch.set(w.assigned_batch_id, arr);
    }
    const orderIds = Array.from(new Set(wbRows.map((w) => w.order_id).filter(Boolean)));
    const fwdIds = Array.from(new Set(wbRows.map((w) => w.forwarding_id).filter(Boolean)));
    const [oR, fR] = await Promise.all([
      orderIds.length
        ? supabaseAdmin.from("orders").select("id, order_no, status, tracking_no").in("id", orderIds)
        : Promise.resolve({ data: [] as any[] }),
      fwdIds.length
        ? supabaseAdmin.from("forwarding_orders").select("id, request_no, status, tracking_no").in("id", fwdIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const oMap = new Map<string, any>((((oR as any).data ?? []) as any[]).map((o: any) => [o.id, o]));
    const fMap = new Map<string, any>((((fR as any).data ?? []) as any[]).map((f: any) => [f.id, f]));

    const batches = [];
    for (const b of visibleBatches) {
      const summary = await computeBatchFeeSummary(supabaseAdmin, b.id);
      const mine = customerCode ? summary.per_customer.filter((p: any) => p.customer_code === customerCode) : [];
      const subtotalCny = +mine.reduce((s: number, p: any) => s + p.subtotal_cny, 0).toFixed(2);

      const wbs = wbByBatch.get(b.id) ?? [];
      const items = wbs.map((w: any) => {
        const o = w.order_id ? oMap.get(w.order_id) : null;
        const fo = w.forwarding_id ? fMap.get(w.forwarding_id) : null;
        return {
          kind: w.order_id ? ("order" as const) : ("forwarding" as const),
          id: w.order_id ?? w.forwarding_id ?? w.id,
          no: o?.order_no ?? fo?.request_no ?? w.waybill_no,
          status: o?.status ?? fo?.status ?? w.status,
          tracking_no: w.intl_tracking_no ?? o?.tracking_no ?? fo?.tracking_no ?? null,
          payment_status: w.payment_status,
        };
      });
      const allPaid = wbs.length > 0 && wbs.every((w: any) => w.payment_status === "paid");
      // 只有客服确认价格后，客户端才显示金额并可付款
      const priceConfirmed = mine.length > 0 && mine.every((p: any) => p.price_confirmed);
      batches.push({
        batch_id: b.id,
        batch_no: b.batch_no,
        status: b.status as "shipped" | "arrived" | "closed",
        shipping_method: b.shipping_method,
        eta: b.eta_date,
        // per_customer.subtotal_cny is already CAD (fee_*_cad === fee_*_cny), do not re-convert
        subtotal_cad: priceConfirmed ? subtotalCny : null,
        price_confirmed: priceConfirmed,
        is_paid: allPaid,
        items,
        intl_tracking_nos: Array.from(new Set(wbs.map((w: any) => w.intl_tracking_no).filter(Boolean))) as string[],
      });
    }
    return { batches };
  });

// Save/replace the 检查费 line for a customer within a batch (kept as a surcharge row with a marker note).
export const saveInspectionFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string; customerCode: string; amountCad: number; note?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const marker = "[inspection]";
    // Remove existing inspection lines for this batch/customer
    await supabaseAdmin
      .from("surcharges")
      .delete()
      .eq("scope", "batch")
      .eq("batch_id", data.batchId)
      .eq("customer_code", data.customerCode)
      .like("note", `${marker}%`);
    const amt = +Number(data.amountCad || 0).toFixed(2);
    if (amt !== 0) {
      const { error } = await supabaseAdmin.from("surcharges").insert({
        scope: "batch",
        batch_id: data.batchId,
        customer_code: data.customerCode,
        amount_cny: amt, // CAD-valued in the *_cny column per system convention
        note: `${marker} 检查费${data.note ? " · " + data.note : ""}`,
        created_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// 末端派送费（批次级、按客户），与检查费同样以带标记的批次附加费保存
export const saveDeliveryFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string; customerCode: string; amountCad: number; note?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const marker = "[delivery]";
    await supabaseAdmin
      .from("surcharges")
      .delete()
      .eq("scope", "batch")
      .eq("batch_id", data.batchId)
      .eq("customer_code", data.customerCode)
      .like("note", `${marker}%`);
    const amt = +Number(data.amountCad || 0).toFixed(2);
    if (amt !== 0) {
      const { error } = await supabaseAdmin.from("surcharges").insert({
        scope: "batch",
        batch_id: data.batchId,
        customer_code: data.customerCode,
        amount_cny: amt,
        note: `${marker} 末端派送费${data.note ? " · " + data.note : ""}`,
        created_by: context.userId,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

// Save all editable customer charges as an unconfirmed draft. Saving never changes
// price confirmation; it only refreshes the authoritative batch calculation.
export const saveBatchCustomerFeeDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { batchId: string; customerCode: string; deliveryCad: number; inspectionCad: number; discountCad: number }) =>
      d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const values = [
      { marker: "[delivery]", label: "末端派送费", amount: Math.max(0, Number(data.deliveryCad || 0)) },
      { marker: "[inspection]", label: "检查费", amount: Math.max(0, Number(data.inspectionCad || 0)) },
      { marker: "[discount]", label: "折扣", amount: Math.max(0, Number(data.discountCad || 0)) },
    ];
    for (const value of values) {
      const { error: deleteError } = await supabaseAdmin
        .from("surcharges")
        .delete()
        .eq("scope", "batch")
        .eq("batch_id", data.batchId)
        .eq("customer_code", data.customerCode)
        .like("note", `${value.marker}%`);
      if (deleteError) throw new Error(deleteError.message);
      const amount = +value.amount.toFixed(2);
      if (amount > 0) {
        const { error: insertError } = await supabaseAdmin.from("surcharges").insert({
          scope: "batch",
          batch_id: data.batchId,
          customer_code: data.customerCode,
          amount_cny: amount,
          note: `${value.marker} ${value.label}`,
          created_by: context.userId,
        });
        if (insertError) throw new Error(insertError.message);
      }
    }
    const summary = await computeBatchFeeSummary(supabaseAdmin, data.batchId);
    const customer = (summary.per_customer as any[]).find((x) => x.customer_code === data.customerCode) ?? null;
    const { error: batchUpdateError } = await supabaseAdmin
      .from("batches")
      .update({
        grand_total_cny: summary.grand_total_cny,
        fee_breakdown: { ...summary, computed_at: new Date().toISOString() },
      })
      .eq("id", data.batchId);
    if (batchUpdateError) throw new Error(batchUpdateError.message);
    const { data: settlement } = await supabaseAdmin
      .from("batch_settlements")
      .select("confirmed")
      .eq("batch_id", data.batchId)
      .eq("customer_code", data.customerCode)
      .maybeSingle();
    if ((settlement as any)?.confirmed) {
      await ensureUnpaidBatchInvoice(supabaseAdmin, {
        batchId: data.batchId,
        customerCode: data.customerCode,
        operatorId: context.userId,
      });
    }
    return { ok: true, customer, totals: summary.totals, grand_total_cny: summary.grand_total_cny };
  });

// 每个批次 × 每位客户一张账单：价格确认时自动生成（未付）。
// 金额与 settleBatchForCustomer 使用完全相同的运单 CAD 列，付款时该账单会被复用并改为已付。
async function ensureUnpaidBatchInvoice(
  admin: any,
  params: { batchId: string; customerCode: string; operatorId: string },
): Promise<{ ok: boolean; reason?: string; invoice_id?: string; invoice_no?: string }> {
  const FX = await getFxCadPerCny(admin);
  const { data: batchRow } = await admin.from("batches").select("batch_no").eq("id", params.batchId).maybeSingle();
  const batchNo = (batchRow as any)?.batch_no ?? params.batchId;
  const { data: prof } = await admin
    .from("profiles")
    .select("id")
    .eq("customer_code", params.customerCode)
    .maybeSingle();
  if (!prof) return { ok: false, reason: "customer_not_found" };
  const userId = (prof as any).id;

  // 该客户在此批次内未付款的运单
  const [oR, fR] = await Promise.all([
    admin.from("orders").select("id").eq("customer_code", params.customerCode),
    admin.from("forwarding_orders").select("id").eq("customer_code", params.customerCode),
  ]);
  const oIds = ((oR.data ?? []) as any[]).map((o) => o.id);
  const fIds = ((fR.data ?? []) as any[]).map((f) => f.id);
  const filters: string[] = [];
  if (oIds.length) filters.push(`order_id.in.(${oIds.join(",")})`);
  if (fIds.length) filters.push(`forwarding_id.in.(${fIds.join(",")})`);
  if (!filters.length) return { ok: false, reason: "no_waybills" };
  const { data: wbs } = await admin
    .from("waybills")
    .select(
      "id, waybill_no, order_id, forwarding_id, freight_cad, duty_cad, insurance_cad, clearance_cad, surcharge_cad, payment_status",
    )
    .eq("assigned_batch_id", params.batchId)
    .or(filters.join(","));
  const wbList = ((wbs ?? []) as any[]).filter((w) => w.payment_status !== "paid");
  if (!wbList.length) return { ok: false, reason: "already_paid" };

  const { buildInvoiceLineMeta } = await import("./duty.server");
  let f = 0,
    cst = 0,
    ins = 0,
    other = 0;
  const lineItems: any[] = [];
  for (const w of wbList) {
    const fCny = +(Number(w.freight_cad ?? 0) / FX).toFixed(2);
    const cCny = +(Number(w.duty_cad ?? 0) / FX).toFixed(2);
    const iCny = +(Number(w.insurance_cad ?? 0) / FX).toFixed(2);
    const clearanceCny = +(Number(w.clearance_cad ?? 0) / FX).toFixed(2);
    const surchargeCny = +(Number(w.surcharge_cad ?? 0) / FX).toFixed(2);
    f += fCny;
    cst += cCny;
    ins += iCny;
    other += clearanceCny + surchargeCny;
    const meta = await buildInvoiceLineMeta(admin, w).catch(() => null);
    lineItems.push({
      waybill_id: w.id,
      order_id: w.order_id,
      forwarding_id: w.forwarding_id,
      description: `运单 ${w.waybill_no}`,
      freight_cny: fCny,
      customs_cny: cCny,
      insurance_cny: iCny,
      other_cny: 0,
      amount_cny: +(fCny + cCny + iCny).toFixed(2),
      meta,
    });
    if (clearanceCny > 0) {
      lineItems.push({
        waybill_id: w.id,
        order_id: w.order_id,
        forwarding_id: w.forwarding_id,
        description: `清关费 · 运单 ${w.waybill_no}`,
        freight_cny: 0,
        customs_cny: 0,
        insurance_cny: 0,
        other_cny: clearanceCny,
        amount_cny: clearanceCny,
        meta: { fee_type: "清关费", batch_no: batchNo, waybill_no: w.waybill_no },
      });
    }
    if (surchargeCny > 0) {
      lineItems.push({
        waybill_id: w.id,
        order_id: w.order_id,
        forwarding_id: w.forwarding_id,
        description: `附加费 · 运单 ${w.waybill_no}`,
        freight_cny: 0,
        customs_cny: 0,
        insurance_cny: 0,
        other_cny: surchargeCny,
        amount_cny: surchargeCny,
        meta: { fee_type: "附加费", batch_no: batchNo, waybill_no: w.waybill_no },
      });
    }
  }
  // 批次级派送费 / 检查费，与结算口径保持一致
  const extras = await batchExtraFeesCad(admin, params.batchId, params.customerCode);
  for (const [label, cad] of [
    ["末端派送费", extras.delivery],
    ["检查费", extras.inspection],
  ] as const) {
    if (!cad) continue;
    const cny = +(cad / FX).toFixed(2);
    other += cny;
    lineItems.push({
      description: `${label} · 批次 ${batchNo}`,
      freight_cny: 0,
      customs_cny: 0,
      insurance_cny: 0,
      other_cny: cny,
      amount_cny: cny,
      meta: { fee_type: label, batch_no: batchNo, amount_cad: +cad.toFixed(2) },
    });
  }
  const subCny = +(f + cst + ins + other).toFixed(2);

  const discountCad = Math.min(+(subCny * FX).toFixed(2), Math.max(0, extras.discount));
  const discountCny = +(discountCad / FX).toFixed(2);
  if (discountCny > 0) {
    lineItems.push({
      description: `折扣 · 批次 ${batchNo}`,
      freight_cny: 0,
      customs_cny: 0,
      insurance_cny: 0,
      other_cny: -discountCny,
      amount_cny: -discountCny,
      meta: { fee_type: "折扣", batch_no: batchNo, amount_cad: -discountCad },
    });
  }

  if (subCny <= 0) return { ok: false, reason: "nothing_to_bill" };

  const payload = {
    user_id: userId,
    type: "batch",
    subtotal_cny: subCny,
    freight_cny: +f.toFixed(2),
    customs_cny: +cst.toFixed(2),
    insurance_cny: +ins.toFixed(2),
    other_cny: +(other - discountCny).toFixed(2),
    total_cny: +(subCny - discountCny).toFixed(2),
    status: "unpaid",
    fx_rate: FX,
    batch_no: batchNo,
    due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    created_by: params.operatorId,
    note: `批次 ${batchNo} · 价格已确认`,
  } as any;

  const { data: existingRows } = await admin
    .from("invoices")
    .select("id")
    .eq("user_id", userId)
    .eq("type", "batch")
    .eq("batch_no", batchNo)
    .in("status", ["unpaid", "overdue"])
    .order("created_at", { ascending: true })
    .limit(1);
  const existingId: string | null = ((existingRows ?? []) as any[])[0]?.id ?? null;

  let inv: any = null;
  if (existingId) {
    await admin.from("invoice_items").delete().eq("invoice_id", existingId);
    const r = await admin.from("invoices").update(payload).eq("id", existingId).select("*").single();
    if (r.error) throw new Error(r.error.message);
    inv = r.data;
  } else {
    const r = await admin.from("invoices").insert(payload).select("*").single();
    if (r.error) throw new Error(r.error.message);
    inv = r.data;
  }
  await admin.from("invoice_items").insert(lineItems.map((li) => ({ ...li, invoice_id: inv.id })));
  return { ok: true, invoice_id: inv.id, invoice_no: inv.invoice_no };
}

// 价格确认：只有确认后，客户端才显示该批次账单金额并可付款；确认同时自动生成未付账单
export const setBatchPriceConfirmed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string; customerCode: string; confirmed: boolean }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("batch_settlements").upsert(
      {
        batch_id: data.batchId,
        customer_code: data.customerCode,
        confirmed: data.confirmed,
        confirmed_by: data.confirmed ? context.userId : null,
        confirmed_at: data.confirmed ? new Date().toISOString() : null,
      },
      { onConflict: "batch_id,customer_code" },
    );
    if (error) throw new Error(error.message);

    let invoice_no: string | null = null;
    if (data.confirmed) {
      const r = await ensureUnpaidBatchInvoice(supabaseAdmin, {
        batchId: data.batchId,
        customerCode: data.customerCode,
        operatorId: context.userId,
      }).catch(() => ({ ok: false }) as any);
      invoice_no = r?.invoice_no ?? null;
    } else {
      // 取消确认：撤回尚未支付的自动账单
      const { data: batchRow } = await supabaseAdmin
        .from("batches")
        .select("batch_no")
        .eq("id", data.batchId)
        .maybeSingle();
      const { data: prof } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("customer_code", data.customerCode)
        .maybeSingle();
      if (batchRow && prof) {
        const { data: rows } = await supabaseAdmin
          .from("invoices")
          .select("id")
          .eq("user_id", (prof as any).id)
          .eq("type", "batch")
          .eq("batch_no", (batchRow as any).batch_no)
          .in("status", ["unpaid", "overdue"]);
        const ids = ((rows ?? []) as any[]).map((r) => r.id);
        if (ids.length) {
          await supabaseAdmin.from("invoice_items").delete().in("invoice_id", ids);
          await supabaseAdmin.from("invoices").delete().in("id", ids);
        }
      }
    }
    return { ok: true, confirmed: data.confirmed, invoice_no };
  });

// Confirm every customer price in one batch. This does not collect payment.
export const confirmAllBatchPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const summary = await computeBatchFeeSummary(supabaseAdmin, data.batchId);
    const customerCodes = Array.from(
      new Set((summary.per_customer as any[]).map((x) => String(x.customer_code || "")).filter(Boolean)),
    );
    if (!customerCodes.length) throw new Error("批次内没有可确认的客户账单");
    const confirmedAt = new Date().toISOString();
    const { error } = await supabaseAdmin.from("batch_settlements").upsert(
      customerCodes.map((customerCode) => ({
        batch_id: data.batchId,
        customer_code: customerCode,
        confirmed: true,
        confirmed_by: context.userId,
        confirmed_at: confirmedAt,
      })),
      { onConflict: "batch_id,customer_code" },
    );
    if (error) throw new Error(error.message);
    const invoices: any[] = [];
    for (const customerCode of customerCodes) {
      const result = await ensureUnpaidBatchInvoice(supabaseAdmin, {
        batchId: data.batchId,
        customerCode,
        operatorId: context.userId,
      });
      invoices.push({ customer_code: customerCode, ...result });
    }
    return { ok: true, confirmed_count: customerCodes.length, invoices };
  });

// 计费重量 = max(实重, 体积重)，体积重按 ÷6000 估算（与 ContainerChildList 客户端展示口径一致）。
function chargeableWeightOf(c: { weight_kg?: number; volume_m3?: number }): number {
  const wt = Number(c.weight_kg ?? 0);
  const volKg = (Number(c.volume_m3 ?? 0) * 1_000_000) / 6000;
  return Math.max(wt, volKg);
}

const BULK_DELIVERY_NOTE_PREFIX = "[delivery] 批量派送费";
const BULK_DISCOUNT_NOTE_PREFIX = "[discount] 派送费冲抵";

// 批量添加批次末端派送费（按客户号计费重量筛选），可选与另一批次做「合并计费重量」对比，
// 避免同一客户的货物被拆到两个批次时漏收或重复收派送费。规则（按客户号逐一判断）：
//   1) combinedWeight = 本批次计费重量 + 对比批次计费重量（未选对比批次或对比批次无该客户时为 0）
//   2) combinedWeight <  触发重量                              → 本批次为该客户加入派送费
//   3) combinedWeight >= 触发重量 且 对比批次已为该客户收取过派送费 → 本批次为该客户加入等额折扣（冲抵）
//   4) 其余情况                                                 → 不处理
// 幂等：每次执行先清除上一次本工具写入的记录（按固定 note 前缀区分），不影响客服在客户
// 抽屉里手工填写的派送费 / 折扣（那些使用不同的 note 文案）。
export const bulkApplyBatchDeliveryFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { batchId: string; feeCad: number; triggerWeightKg: number; compareBatchId?: string | null }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const fee = +Number(data.feeCad || 0).toFixed(2);
    const trigger = Number(data.triggerWeightKg || 0);
    if (!(fee > 0)) throw new Error("请填写有效的派送费金额");
    if (!(trigger > 0)) throw new Error("请填写有效的触发重量");
    if (data.compareBatchId && data.compareBatchId === data.batchId) throw new Error("对比批次不能与本批次相同");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const summary = await computeBatchFeeSummary(supabaseAdmin, data.batchId);
    const perCustomer = (summary.per_customer ?? []) as any[];
    if (!perCustomer.length) throw new Error("批次内没有可处理的客户账单");

    const compareByCode = new Map<string, { weight: number; hadDelivery: boolean }>();
    let compareBatchNo: string | null = null;
    if (data.compareBatchId) {
      const [{ data: cmpBatch }, cmpSummary] = await Promise.all([
        supabaseAdmin.from("batches").select("batch_no").eq("id", data.compareBatchId).maybeSingle(),
        computeBatchFeeSummary(supabaseAdmin, data.compareBatchId),
      ]);
      compareBatchNo = (cmpBatch as any)?.batch_no ?? null;
      for (const c of (cmpSummary.per_customer ?? []) as any[]) {
        if (!c.customer_code) continue;
        compareByCode.set(c.customer_code, {
          weight: chargeableWeightOf(c),
          hadDelivery: Number(c.fee_delivery_cad ?? 0) > 0,
        });
      }
    }

    // 清除上一次批量执行写入的记录，避免重复执行时叠加
    await supabaseAdmin
      .from("surcharges")
      .delete()
      .eq("scope", "batch")
      .eq("batch_id", data.batchId)
      .like("note", `${BULK_DELIVERY_NOTE_PREFIX}%`);
    await supabaseAdmin
      .from("surcharges")
      .delete()
      .eq("scope", "batch")
      .eq("batch_id", data.batchId)
      .like("note", `${BULK_DISCOUNT_NOTE_PREFIX}%`);

    const charged: string[] = [];
    const discounted: string[] = [];
    const skipped: string[] = [];
    const rows: any[] = [];
    for (const c of perCustomer) {
      const code = c.customer_code as string | null;
      if (!code) continue;
      const curWeight = chargeableWeightOf(c);
      const cmp = compareByCode.get(code);
      const combined = curWeight + (cmp?.weight ?? 0);
      if (combined < trigger) {
        rows.push({
          scope: "batch",
          batch_id: data.batchId,
          customer_code: code,
          amount_cny: fee,
          note: `${BULK_DELIVERY_NOTE_PREFIX} · 触发${trigger}kg${compareBatchNo ? ` · 合并对比 ${compareBatchNo}` : ""}`,
          created_by: context.userId,
        });
        charged.push(code);
      } else if (cmp?.hadDelivery) {
        rows.push({
          scope: "batch",
          batch_id: data.batchId,
          customer_code: code,
          amount_cny: fee,
          note: `${BULK_DISCOUNT_NOTE_PREFIX} · 已在批次 ${compareBatchNo ?? "对比批次"} 收取`,
          created_by: context.userId,
        });
        discounted.push(code);
      } else {
        skipped.push(code);
      }
    }
    if (rows.length) {
      const { error } = await supabaseAdmin.from("surcharges").insert(rows);
      if (error) throw new Error(error.message);
    }

    const newSummary = await computeBatchFeeSummary(supabaseAdmin, data.batchId);
    await supabaseAdmin
      .from("batches")
      .update({
        grand_total_cny: newSummary.grand_total_cny,
        fee_breakdown: { ...newSummary, computed_at: new Date().toISOString() },
      })
      .eq("id", data.batchId);

    // 已确认价格的客户账单需要同步重算，保持金额与刚写入的派送费/折扣一致
    const touched = [...charged, ...discounted];
    if (touched.length) {
      const { data: settled } = await supabaseAdmin
        .from("batch_settlements")
        .select("customer_code, confirmed")
        .eq("batch_id", data.batchId)
        .in("customer_code", touched);
      for (const s of (settled ?? []) as any[]) {
        if (!s.confirmed) continue;
        await ensureUnpaidBatchInvoice(supabaseAdmin, {
          batchId: data.batchId,
          customerCode: s.customer_code,
          operatorId: context.userId,
        }).catch(() => null);
      }
    }

    return {
      ok: true,
      charged_count: charged.length,
      discounted_count: discounted.length,
      skipped_count: skipped.length,
      charged,
      discounted,
      skipped,
      grand_total_cny: newSummary.grand_total_cny,
    };
  });

export const createBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      display_name?: string;
      planned_ship_date: string;
      shipping_method: BatchMethod;
      cargo_type?: string;
      destination_code?: string;
      notes?: string;
      waybill_ids?: string[];
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ins, error } = await supabaseAdmin
      .from("batches")
      .insert({
        display_name: data.display_name?.trim() || null,
        planned_ship_date: data.planned_ship_date,
        shipping_method: data.shipping_method,
        cargo_type: data.cargo_type ?? null,
        destination_code: data.destination_code ?? null,
        notes: data.notes ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    if (data.waybill_ids?.length) {
      await supabaseAdmin
        .from("waybills")
        .update({ assigned_batch_id: ins.id, batch_no: ins.batch_no })
        .in("id", data.waybill_ids);
    }
    await recordLog(supabaseAdmin, {
      entity_type: "batch",
      entity_id: ins.id,
      action: "create",
      after: ins,
      operator_id: context.userId,
      operator_name: await getOperatorName(supabaseAdmin, context.userId),
    });
    return { ok: true, batch: ins };
  });

export const assignWaybillsToBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string; waybillIds: string[]; remove?: boolean }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.remove) {
      const { error } = await supabaseAdmin
        .from("waybills")
        .update({ assigned_batch_id: null, batch_no: null })
        .in("id", data.waybillIds);
      if (error) throw new Error(error.message);
    } else {
      const { data: b } = await supabaseAdmin.from("batches").select("batch_no").eq("id", data.batchId).single();
      const { error } = await supabaseAdmin
        .from("waybills")
        .update({ assigned_batch_id: data.batchId, batch_no: b?.batch_no ?? null })
        .in("id", data.waybillIds);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const updateBatchStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string; status: BatchStatus }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const update: any = { status: data.status };
    if (data.status === "closed") update.closed_at = new Date().toISOString();
    // Persist fee summary whenever status crosses lock boundary OR unlocks.
    // (Any transition triggers a recompute so the snapshot stays in sync.)
    try {
      const summary = await computeBatchFeeSummary(supabaseAdmin, data.batchId);
      update.grand_total_cny = summary.grand_total_cny;
      update.fee_breakdown = {
        totals: summary.totals,
        per_customer: summary.per_customer,
        unassigned: summary.unassigned,
        independent_clearance: summary.independent_clearance,
        waybill_total: summary.waybill_total,
        computed_at: new Date().toISOString(),
        status_at_compute: data.status,
      };
    } catch (e) {
      // If summary fails, still persist the status change but log
      console.error("computeBatchFeeSummary failed during status change:", e);
    }
    const { error } = await supabaseAdmin.from("batches").update(update).eq("id", data.batchId);
    if (error) throw new Error(error.message);
    // Sync waybills under this batch: shipped → 'shipped', arrived → 'arrived'.
    // Skip terminal/downstream statuses so we don't regress 已签收 etc.
    const targetWb = data.status === "shipped" ? "shipped" : data.status === "arrived" ? "arrived" : null;
    if (targetWb) {
      await supabaseAdmin
        .from("waybills")
        .update({ status: targetWb })
        .eq("assigned_batch_id", data.batchId)
        .not("status", "in", "(delivered,cancelled,in_transit,ready_pickup)");
    }
    await recordLog(supabaseAdmin, {
      entity_type: "batch",
      entity_id: data.batchId,
      action: "set_status",
      after: {
        status: data.status,
        waybills_synced: targetWb,
        grand_total_cny: update.grand_total_cny,
      },
      operator_id: context.userId,
      operator_name: await getOperatorName(supabaseAdmin, context.userId),
    });
    return { ok: true, grand_total_cny: update.grand_total_cny };
  });

// ===== Shop order: staff flips procurement → pending (已发货等待入库) =====
export const adminShipShopOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orderId: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!ok) throw new Error("Forbidden");
    const { data: res, error } = await context.supabase.rpc("admin_ship_shop_order", {
      _order_id: data.orderId,
    });
    if (error) throw new Error(error.message);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await recordLog(supabaseAdmin, {
      entity_type: "order",
      entity_id: data.orderId,
      action: "ship_shop_order",
      after: res,
      operator_id: context.userId,
      operator_name: await getOperatorName(supabaseAdmin, context.userId),
    });
    return res as any;
  });

// ===== Procurement aggregated by product (for shop admin) =====
export const listProcurementByProduct = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: ok } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!ok) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: orders, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id, order_no, customer_code, box_count, total_cny, route_code, shipping_method, destination_code, created_at, note, order_items(id, product_id, product_slug, sku, name_zh, image_url, unit_price_cny, quantity, subtotal_cny, purchase_type, products:product_id(pack_qty))",
      )
      .eq("source", "shop")
      .eq("status", "procurement")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const groups = new Map<string, any>();
    for (const o of orders ?? []) {
      for (const it of (o as any).order_items ?? []) {
        const key = it.product_id ?? it.sku ?? it.name_zh ?? "unknown";
        const packQty = Math.max(Number(it.products?.pack_qty ?? 1) || 1, 1);
        const lineBoxes = Math.ceil((Number(it.quantity) || 0) / packQty);
        if (!groups.has(key)) {
          groups.set(key, {
            product_id: it.product_id,
            sku: it.sku,
            name_zh: it.name_zh,
            image_url: it.image_url,
            unit_price_cny: it.unit_price_cny,
            pack_qty: packQty,
            total_qty: 0,
            total_orders: 0,
            total_boxes: 0,
            lines: [] as any[],
          });
        }
        const g = groups.get(key);
        g.total_qty += Number(it.quantity ?? 0);
        g.total_orders += 1;
        g.total_boxes += lineBoxes;
        g.lines.push({
          order_id: (o as any).id,
          order_no: (o as any).order_no,
          customer_code: (o as any).customer_code,
          quantity: it.quantity,
          box_count: lineBoxes,
          pack_qty: packQty,
          route_code: (o as any).route_code,
          shipping_method: (o as any).shipping_method,
          destination_code: (o as any).destination_code,
          purchase_type: it.purchase_type,
          created_at: (o as any).created_at,
          note: (o as any).note,
        });
      }
    }
    const products = Array.from(groups.values()).sort((a, b) => b.total_qty - a.total_qty);
    return { products, total_orders: orders?.length ?? 0 };
  });

// ===== Batch: update meta (eta, vessel_no, notes, cargo_type, destination_code) =====
export const updateBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      batchId: string;
      patch: {
        display_name?: string | null;
        eta_date?: string | null;
        vessel_no?: string | null;
        notes?: string | null;
        cargo_type?: string | null;
        destination_code?: string | null;
      };
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("batches").update(data.patch).eq("id", data.batchId);
    if (error) throw new Error(error.message);
    await recordLog(supabaseAdmin, {
      entity_type: "batch",
      entity_id: data.batchId,
      action: "update",
      after: data.patch,
      operator_id: context.userId,
      operator_name: await getOperatorName(supabaseAdmin, context.userId),
    });
    return { ok: true };
  });

// ===== Batch ops: bulk status / tracking for all waybills under a batch =====
export const batchUpdateWaybillsByBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      batchId: string;
      status?: WaybillStatus;
      event?: {
        status_zh: string;
        status_en?: string;
        location_zh?: string;
        location_en?: string;
        event_time?: string;
      };
      note?: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wbs } = await supabaseAdmin
      .from("waybills")
      .select("id, waybill_no, status")
      .eq("assigned_batch_id", data.batchId);
    if (!wbs?.length) return { ok: true, count: 0 };
    const operator = await getOperatorName(supabaseAdmin, context.userId);
    if (data.status) {
      const { error } = await supabaseAdmin
        .from("waybills")
        .update({ status: data.status })
        .eq("assigned_batch_id", data.batchId);
      if (error) throw new Error(error.message);
      for (const w of wbs) {
        await recordLog(supabaseAdmin, {
          entity_type: "waybill",
          entity_id: w.id,
          action: "set_status_batch",
          before: { status: w.status },
          after: { status: data.status },
          operator_id: context.userId,
          operator_name: operator,
          note: data.note,
        });
      }
    }
    if (data.event) {
      for (const w of wbs) {
        let { data: ship } = await supabaseAdmin
          .from("shipments")
          .select("id")
          .eq("tracking_no", w.waybill_no)
          .maybeSingle();
        if (!ship) {
          const { data: ins } = await supabaseAdmin
            .from("shipments")
            .insert({ tracking_no: w.waybill_no, status: "created" })
            .select("id")
            .single();
          ship = ins;
        }
        if (!ship) continue;
        await supabaseAdmin.from("tracking_events").insert({
          shipment_id: ship.id,
          status_zh: data.event.status_zh,
          status_en: data.event.status_en ?? data.event.status_zh,
          location_zh: data.event.location_zh ?? null,
          location_en: data.event.location_en ?? null,
          event_time: data.event.event_time ?? new Date().toISOString(),
          source: "admin_action",
        });
        await recordLog(supabaseAdmin, {
          entity_type: "waybill",
          entity_id: w.id,
          action: "add_tracking_batch",
          after: data.event,
          operator_id: context.userId,
          operator_name: operator,
        });
      }
    }
    return { ok: true, count: wbs.length };
  });

// ===== Forwarding: add waybills (single or batch, each with dims/weight) =====
export const addWaybillsToForwarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      forwardingId: string;
      rows: {
        weight_kg?: number;
        length_cm?: number;
        width_cm?: number;
        height_cm?: number;
        note?: string;
      }[];
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: fo } = await supabaseAdmin
      .from("forwarding_orders")
      .select("*")
      .eq("id", data.forwardingId)
      .maybeSingle();
    if (!fo) throw new Error("Forwarding not found");
    const operator = await getOperatorName(supabaseAdmin, context.userId);
    const inserted: any[] = [];
    for (const row of data.rows) {
      const { data: ins, error } = await supabaseAdmin
        .from("waybills")
        .insert({
          forwarding_id: data.forwardingId,
          user_id: fo.user_id,
          shipping_method: fo.shipping_method,
          weight_kg: row.weight_kg ?? null,
          length_cm: row.length_cm ?? null,
          width_cm: row.width_cm ?? null,
          height_cm: row.height_cm ?? null,
          note: row.note ?? null,
          status: "received",
          payment_status: fo.payment_status ?? "unpaid",
        } as any)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      inserted.push(ins);
      await recordLog(supabaseAdmin, {
        entity_type: "waybill",
        entity_id: ins.id,
        action: "create_from_forwarding",
        after: {
          weight_kg: row.weight_kg,
          length_cm: row.length_cm,
          width_cm: row.width_cm,
          height_cm: row.height_cm,
        },
        operator_id: context.userId,
        operator_name: operator,
      });
    }
    await recomputeForwardingTotal(supabaseAdmin, data.forwardingId);
    return { ok: true, waybills: inserted };
  });

// ===== Label generation: returns plain data, UI renders + prints =====
export const getLabelData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { entityType: "order" | "forwarding"; entityId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let parent: any,
      waybills: any[] = [],
      address: any = null,
      user: any = null,
      entityNo = "";
    if (data.entityType === "order") {
      const { data: o } = await supabaseAdmin.from("orders").select("*").eq("id", data.entityId).maybeSingle();
      if (!o) throw new Error("Order not found");
      parent = o;
      entityNo = o.order_no;
      address = (o as any).address_snapshot;
      // Label destination must come from the recipient address; if the snapshot
      // predates the destination_code field, fall back to the user's default address.
      if (address && !(address as any).destination_code && (o as any).user_id) {
        const { data: a } = await supabaseAdmin
          .from("addresses")
          .select("destination_code")
          .eq("user_id", (o as any).user_id)
          .eq("is_default", true)
          .maybeSingle();
        if (a?.destination_code) address = { ...(address as any), destination_code: a.destination_code };
      }

      const { data: w } = await supabaseAdmin
        .from("waybills")
        .select("*")
        .eq("order_id", data.entityId)
        .order("created_at");
      waybills = w ?? [];
      if (o.user_id) {
        const { data: u } = await supabaseAdmin
          .from("profiles")
          .select("id, email, full_name, phone, customer_code")
          .eq("id", o.user_id)
          .maybeSingle();
        user = u;
      }
    } else {
      const { data: f } = await supabaseAdmin
        .from("forwarding_orders")
        .select("*")
        .eq("id", data.entityId)
        .maybeSingle();
      if (!f) throw new Error("Forwarding not found");
      parent = f;
      entityNo = f.request_no || f.tracking_no || "";
      if (f.address_id) {
        const { data: a } = await supabaseAdmin.from("addresses").select("*").eq("id", f.address_id).maybeSingle();
        address = a;
      }
      const { data: w } = await supabaseAdmin
        .from("waybills")
        .select("*")
        .eq("forwarding_id", data.entityId)
        .order("created_at");
      waybills = w ?? [];
      if (f.user_id) {
        const { data: u } = await supabaseAdmin
          .from("profiles")
          .select("id, email, full_name, phone, customer_code")
          .eq("id", f.user_id)
          .maybeSingle();
        user = u;
      }
    }
    return {
      entityType: data.entityType,
      entityNo,
      parent,
      waybills,
      address,
      user,
      total: waybills.length,
    };
  });

// ====== Toggle insurance flag on a forwarding (with admin log) ======
export const setForwardingInsured = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; insured: boolean; note?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("forwarding_orders")
      .select("insured")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) throw new Error("Not found");
    const { error } = await supabaseAdmin.from("forwarding_orders").update({ insured: data.insured }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordLog(supabaseAdmin, {
      entity_type: "forwarding",
      entity_id: data.id,
      action: "set_insured",
      before: { insured: (before as any).insured },
      after: { insured: data.insured },
      operator_id: context.userId,
      operator_name: await getOperatorName(supabaseAdmin, context.userId),
      note: data.note ?? (data.insured ? "标记为已购买保险" : "取消购买保险"),
    });
    await recomputeForwardingTotal(supabaseAdmin, data.id);
    return { ok: true };
  });

export const updateOrderDomesticTrackingNo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orderId: string; domestic_tracking_no: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const value = (data.domestic_tracking_no ?? "").trim();
    const { data: before } = await supabaseAdmin
      .from("orders")
      .select("domestic_tracking_no")
      .eq("id", data.orderId)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ domestic_tracking_no: value || null })
      .eq("id", data.orderId);
    if (error) throw new Error(error.message);
    await recordLog(supabaseAdmin, {
      entity_type: "order",
      entity_id: data.orderId,
      action: "update_domestic_tracking_no",
      before: before ?? null,
      after: { domestic_tracking_no: value || null },
      operator_id: context.userId,
      operator_name: await getOperatorName(supabaseAdmin, context.userId),
      note: "修改国内单号",
    });
    return { ok: true };
  });

export const updateWaybillDomesticTrackingNo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { waybillId: string; domestic_tracking_no: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const value = (data.domestic_tracking_no ?? "").trim();
    const { data: wb } = await supabaseAdmin
      .from("waybills")
      .select("id, forwarding_id, order_id")
      .eq("id", data.waybillId)
      .maybeSingle();
    if (!wb) throw new Error("Not found");
    // 国内单号存在父级（集运单 / 电商订单）上，运单本身不存该字段
    if (wb.forwarding_id) {
      const { error } = await supabaseAdmin
        .from("forwarding_orders")
        .update({ domestic_tracking_no: value })
        .eq("id", wb.forwarding_id);
      if (error) throw new Error(error.message);
    } else if (wb.order_id) {
      const { error } = await supabaseAdmin
        .from("orders")
        .update({ domestic_tracking_no: value || null })
        .eq("id", wb.order_id);
      if (error) throw new Error(error.message);
    } else {
      throw new Error("该运单没有关联的集运单或订单，无法修改国内单号");
    }
    await recordLog(supabaseAdmin, {
      entity_type: "waybill",
      entity_id: data.waybillId,
      action: "update_domestic_tracking_no",
      after: { domestic_tracking_no: value || null },
      operator_id: context.userId,
      operator_name: await getOperatorName(supabaseAdmin, context.userId),
      note: "修改国内单号",
    });
    return { ok: true };
  });

export const updateForwardingBasicInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      forwardingId: string;
      patch: Partial<{
        warehouse: string;
        shipping_method: string;
        destination_code: string;
        domestic_tracking_no: string;
        intl_tracking_no: string;
      }>;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const allowed = [
      "warehouse",
      "shipping_method",
      "destination_code",
      "domestic_tracking_no",
      "intl_tracking_no",
    ] as const;
    const patch: Record<string, any> = {};
    for (const k of allowed) {
      const v = (data.patch as any)?.[k];
      if (v === undefined) continue;
      const s = String(v).trim();
      patch[k] = s || null;
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { data: before } = await supabaseAdmin
      .from("forwarding_orders")
      .select(allowed.join(", "))
      .eq("id", data.forwardingId)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("forwarding_orders")
      .update(patch as any)
      .eq("id", data.forwardingId);
    if (error) throw new Error(error.message);
    await recordLog(supabaseAdmin, {
      entity_type: "forwarding",
      entity_id: data.forwardingId,
      action: "update_basic_info",
      before: before ?? null,
      after: patch,
      operator_id: context.userId,
      operator_name: await getOperatorName(supabaseAdmin, context.userId),
      note: "修改基础信息",
    });
    return { ok: true };
  });
