import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { VipLevel } from "@/lib/vip-levels";
import { recordAdminLog } from "@/lib/admin-log";

export type Warehouse = {
  id: string;
  code: string;
  name_zh: string;
  name_en: string | null;
  country: "CN" | "CA" | "US" | "OTHER";
  type: "origin" | "destination" | "transit" | null;
  can_origin: boolean;
  can_destination: boolean;
  can_inventory: boolean;
  storage_fee_cad_per_cbm_day: number;
  storage_free_days: number;
  inout_fee_cad_per_cbm: number;
  address: string | null;
  contact: string | null;
  phone: string | null;
  is_active: boolean;
  sort_order: number;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type ShippingMethod = "air" | "sea" | "express" | "truck" | "storage";
export type WeightMode = "actual" | "volumetric" | "max";
export type PricingMode = "weight" | "pallet";

export type CargoType = "general" | "sensitive";
export type RouteUsageScope = "shop" | "forwarding" | "both";
export type ItemFieldKey =
  | "name"
  | "hscode"
  | "box_count"
  | "inner_qty"
  | "material"
  | "origin"
  | "unit_price"
  | "quantity"
  | "brand"
  | "length_cm"
  | "width_cm"
  | "height_cm"
  | "weight_kg";
export type ShippingRoute = {
  id: string;
  code: string;
  name_zh: string;
  name_en: string | null;
  origin_warehouse_id: string | null;
  destination_warehouse_id: string | null;
  shipping_method: ShippingMethod;
  cargo_type: CargoType;
  usage_scope: RouteUsageScope;
  destination_code: string | null;
  transit_days_min: number | null;
  transit_days_max: number | null;
  is_active: boolean;
  sort_order: number;
  note: string | null;
  item_fields: ItemFieldKey[];
  item_field_required: Partial<Record<ItemFieldKey, boolean>>;
  last_mile_fee_cad: number;
  last_mile_threshold_kg: number;
  last_mile_step_kg: number;
  last_mile_rate_cad: number;
  last_mile_formula: string | null;
  is_bidirectional: boolean;
  sales_tax_enabled: boolean;
  sales_tax_rate_pct: number;
  visible_vip_levels: VipLevel[];
  visible_customer_codes: string[];
  blacklist_vip_levels: VipLevel[];
  blacklist_customer_codes: string[];
  wechat_ai_enabled: boolean;
  wechat_ai_price_text: string | null;
  allowed_items_text: string | null;
  prohibited_items_text: string | null;
};

export type FreightDirection = "forward" | "reverse";

export type FreightRule = {
  id?: string;
  weight_mode: WeightMode;
  volumetric_divisor: number;
  unit_price_cad: number;
  min_charge_cad: number;
  clearance_fee_cad: number;
  insurance_rate_pct: number;
  is_active: boolean;
  note?: string | null;
  pricing_mode?: PricingMode;
  pallet_unit_price_cad?: number;
  pallet_max_length_cm?: number | null;
  pallet_max_width_cm?: number | null;
  pallet_max_height_cm?: number | null;
  pallet_max_weight_kg?: number | null;
  pallet_overflow_factor?: number;
  direction?: FreightDirection;
  /** 最低收费 / 清关费分别在运单级与批次级设置 */
  min_charge_waybill_cad?: number;
  min_charge_batch_cad?: number;
  clearance_fee_waybill_cad?: number;
  clearance_fee_batch_cad?: number;
  /** 末端派送费（批次级）：轻货固定费 + 重货按板/箱计费 */
  delivery_light_max_kg?: number;
  delivery_light_fee_cad?: number;
  delivery_heavy_min_kg?: number;
  delivery_unit_fee_cad?: number;
  /** 派送风险预警阈值 */
  oversize_alert_length_cm?: number;
  overweight_alert_ratio?: number;
  remote_postal_prefixes?: string | null;
};

/**
 * Compute number of pallets given a parcel L/W/H/kg and a freight rule with pallet limits.
 * Rules:
 *  - any dimension > factor × max → throw (oversize)
 *  - footprint pallets = ceil(L/maxL) × ceil(W/maxW)
 *  - height factor = ceil(H/maxH)
 *  - weight factor = ceil(kg/maxKg)
 *  - pallets = max(footprint × height_factor, weight_factor)
 *  - missing dimensions / limits → fallback 1, reason='missing_dims'
 */
export function computePallets(input: {
  L?: number | null;
  W?: number | null;
  H?: number | null;
  kg?: number | null;
  rule: Pick<
    FreightRule,
    | "pallet_max_length_cm"
    | "pallet_max_width_cm"
    | "pallet_max_height_cm"
    | "pallet_max_weight_kg"
    | "pallet_overflow_factor"
  >;
}): { pallets: number; reason?: string } {
  const L = Number(input.L) || 0,
    W = Number(input.W) || 0,
    H = Number(input.H) || 0,
    kg = Number(input.kg) || 0;
  const maxL = Number(input.rule.pallet_max_length_cm) || 0;
  const maxW = Number(input.rule.pallet_max_width_cm) || 0;
  const maxH = Number(input.rule.pallet_max_height_cm) || 0;
  const maxKg = Number(input.rule.pallet_max_weight_kg) || 0;
  const factor = Number(input.rule.pallet_overflow_factor) || 2;
  if (!maxL || !maxW || (!L && !W && !H && !kg)) return { pallets: 1, reason: "missing_dims" };
  if ((maxL && L > factor * maxL) || (maxW && W > factor * maxW)) {
    throw new Error(`超规格：长/宽不能超过标准板尺寸的 ${factor} 倍`);
  }
  const lf = L > 0 ? Math.ceil(L / maxL) : 1;
  const wf = W > 0 ? Math.ceil(W / maxW) : 1;
  const hf = maxH > 0 && H > 0 ? Math.ceil(H / maxH) : 1;
  const kgf = maxKg > 0 && kg > 0 ? Math.ceil(kg / maxKg) : 1;
  const footprint = lf * wf;
  return { pallets: Math.max(footprint * hf, kgf) };
}

export type CustomsRule = {
  id?: string;
  enabled: boolean;
  rate_pct: number;
  threshold_cad: number;
  note?: string | null;
};

async function assertManagerOrOwner(supabase: any, userId: string) {
  const [{ data: isOwner }, { data: isManager }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "manager" }),
  ]);
  if (!isOwner && !isManager) throw new Error("Forbidden: owner or manager only");
}
async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden: staff only");
}

// =================== Warehouses ===================
export const listWarehouses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("warehouses")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("code", { ascending: true });
    if (error) throw new Error(error.message);
    return { warehouses: (data ?? []) as Warehouse[] };
  });

export const upsertWarehouse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; payload: Omit<Warehouse, "id" | "created_at" | "updated_at"> }) => d)
  .handler(async ({ data, context }) => {
    await assertManagerOrOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row = { ...data.payload };
    if (data.id) {
      const { error } = await supabaseAdmin.from("warehouses").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      await recordAdminLog(supabaseAdmin, {
        entity_type: "warehouse",
        entity_id: data.id,
        action: "update",
        after: row,
        operator_id: context.userId,
      });
      return { ok: true, id: data.id };
    } else {
      const { data: inserted, error } = await supabaseAdmin.from("warehouses").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      await recordAdminLog(supabaseAdmin, {
        entity_type: "warehouse",
        entity_id: inserted!.id,
        action: "create",
        after: row,
        operator_id: context.userId,
      });
      return { ok: true, id: inserted!.id };
    }
  });

export const deleteWarehouse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManagerOrOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("warehouses").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("warehouses").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "warehouse",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });

// =================== Routes / Freight / Customs ===================
export const listRoutes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const [routesR, freightR, customsR, whR] = await Promise.all([
      context.supabase
        .from("shipping_routes")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("code", { ascending: true }),
      context.supabase.from("freight_rules").select("*").eq("is_active", true),
      context.supabase.from("customs_rules").select("*"),
      context.supabase.from("warehouses").select("id, code, name_zh, country, type, can_origin, can_destination"),
    ]);
    if (routesR.error) throw new Error(routesR.error.message);
    if (freightR.error) throw new Error(freightR.error.message);
    if (customsR.error) throw new Error(customsR.error.message);
    if (whR.error) throw new Error(whR.error.message);

    const freightByRoute = new Map<string, any>();
    const freightReverseByRoute = new Map<string, any>();
    for (const f of freightR.data ?? []) {
      if ((f as any).direction === "reverse") freightReverseByRoute.set(f.route_id, f);
      else freightByRoute.set(f.route_id, f);
    }
    const customsByRoute = new Map<string, any>();
    for (const c of customsR.data ?? []) customsByRoute.set(c.route_id, c);
    const whById = new Map<string, any>();
    for (const w of whR.data ?? []) whById.set(w.id, w);

    const rows = (routesR.data ?? []).map((r: any) => ({
      ...r,
      origin: r.origin_warehouse_id ? (whById.get(r.origin_warehouse_id) ?? null) : null,
      destination: r.destination_warehouse_id ? (whById.get(r.destination_warehouse_id) ?? null) : null,
      freight: freightByRoute.get(r.id) ?? null,
      freight_reverse: freightReverseByRoute.get(r.id) ?? null,
      customs: customsByRoute.get(r.id) ?? null,
    }));
    return { routes: rows, warehouses: whR.data ?? [] };
  });

export const upsertRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id?: string;
      route: Omit<ShippingRoute, "id">;
      freight: FreightRule;
      freight_reverse?: FreightRule | null;
      customs: CustomsRule;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertManagerOrOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let routeId = data.id;
    if (routeId) {
      const { error } = await supabaseAdmin.from("shipping_routes").update(data.route).eq("id", routeId);
      if (error) throw new Error(error.message);
    } else {
      const { data: ins, error } = await supabaseAdmin.from("shipping_routes").insert(data.route).select("id").single();
      if (error) throw new Error(error.message);
      routeId = ins!.id;
    }

    const freightRow = (f: FreightRule, direction: FreightDirection) => ({
      route_id: routeId,
      direction,
      weight_mode: f.weight_mode,
      volumetric_divisor: f.volumetric_divisor,
      unit_price_cad: f.unit_price_cad,
      min_charge_cad: f.min_charge_cad,
      clearance_fee_cad: f.clearance_fee_cad,
      unit_price_cny: 0,
      min_charge_cny: 0,
      extra_fee_cny: 0,
      insurance_rate_pct: f.insurance_rate_pct ?? 0,
      is_active: true,
      note: f.note ?? null,
      pricing_mode: f.pricing_mode ?? "weight",
      pallet_unit_price_cad: f.pallet_unit_price_cad ?? 0,
      pallet_max_length_cm: f.pallet_max_length_cm ?? null,
      pallet_max_width_cm: f.pallet_max_width_cm ?? null,
      pallet_max_height_cm: f.pallet_max_height_cm ?? null,
      pallet_max_weight_kg: f.pallet_max_weight_kg ?? null,
      pallet_overflow_factor: f.pallet_overflow_factor ?? 2,
      min_charge_waybill_cad: f.min_charge_waybill_cad ?? 0,
      min_charge_batch_cad: f.min_charge_batch_cad ?? 0,
      clearance_fee_waybill_cad: f.clearance_fee_waybill_cad ?? 0,
      clearance_fee_batch_cad: f.clearance_fee_batch_cad ?? 0,
      delivery_light_max_kg: f.delivery_light_max_kg ?? 0,
      delivery_light_fee_cad: f.delivery_light_fee_cad ?? 0,
      delivery_heavy_min_kg: f.delivery_heavy_min_kg ?? 0,
      delivery_unit_fee_cad: f.delivery_unit_fee_cad ?? 0,
      oversize_alert_length_cm: f.oversize_alert_length_cm ?? 0,
      overweight_alert_ratio: f.overweight_alert_ratio ?? 0,
      remote_postal_prefixes: f.remote_postal_prefixes ?? null,
    });

    // Deactivate all prior rules for this route, then insert the active set
    await supabaseAdmin.from("freight_rules").update({ is_active: false }).eq("route_id", routeId);
    const { error: fErr } = await supabaseAdmin
      .from("freight_rules")
      .insert(freightRow(data.freight, "forward") as any);
    if (fErr) throw new Error(fErr.message);
    if (data.route.is_bidirectional && data.freight_reverse) {
      const { error: frErr } = await supabaseAdmin
        .from("freight_rules")
        .insert(freightRow(data.freight_reverse, "reverse") as any);
      if (frErr) throw new Error(frErr.message);
    }

    // upsert customs (unique on route_id)
    const { error: cErr } = await supabaseAdmin.from("customs_rules").upsert(
      {
        route_id: routeId,
        enabled: data.customs.enabled,
        rate_pct: data.customs.rate_pct,
        threshold_cad: data.customs.threshold_cad,
        note: data.customs.note ?? null,
      },
      { onConflict: "route_id" },
    );
    if (cErr) throw new Error(cErr.message);

    await recordAdminLog(supabaseAdmin, {
      entity_type: "shipping_route",
      entity_id: routeId!,
      action: data.id ? "update" : "create",
      after: { route: data.route, freight: data.freight, customs: data.customs },
      operator_id: context.userId,
    });

    return { ok: true, id: routeId };
  });

export const deleteRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManagerOrOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("shipping_routes").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("shipping_routes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "shipping_route",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const quoteFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      route_id: string;
      weight_kg: number;
      volume_cm3: number;
      declared_cad?: number;
      length_cm?: number;
      width_cm?: number;
      height_cm?: number;
      direction?: FreightDirection;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const dir: FreightDirection = data.direction === "reverse" ? "reverse" : "forward";
    const [{ data: rule, error: e1 }, { data: customs }, { data: route }] = await Promise.all([
      context.supabase
        .from("freight_rules")
        .select("*")
        .eq("route_id", data.route_id)
        .eq("is_active", true)
        .eq("direction", dir)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      context.supabase.from("customs_rules").select("*").eq("route_id", data.route_id).maybeSingle(),
      context.supabase
        .from("shipping_routes")
        .select("sales_tax_enabled, sales_tax_rate_pct")
        .eq("id", data.route_id)
        .maybeSingle(),
    ]);
    if (e1) throw new Error(e1.message);
    if (!rule) return { ok: false, reason: "no_active_rule" as const };

    const w = Math.max(0, Number(data.weight_kg) || 0);
    const v = Math.max(0, Number(data.volume_cm3) || 0);
    const volW = rule.volumetric_divisor > 0 ? v / Number(rule.volumetric_divisor) : 0;
    const chargeable = rule.weight_mode === "actual" ? w : rule.weight_mode === "volumetric" ? volW : Math.max(w, volW);
    // Prefer CAD columns; fall back to legacy CNY * 0.19 for older rows.
    const fx = 0.19;
    const unit_cad = Number(rule.unit_price_cad ?? 0) || Number(rule.unit_price_cny ?? 0) * fx;
    // 最低收费 / 清关费按运单级试算（批次级另行结算）
    const min_cad = Number(rule.min_charge_waybill_cad ?? 0);
    const clearance_cad = Number(rule.clearance_fee_waybill_cad ?? 0);

    const pricing_mode = (rule.pricing_mode as PricingMode) ?? "weight";
    let freight_cad = 0;
    let pallets = 0;
    let pallet_reason: string | undefined;
    if (pricing_mode === "pallet") {
      try {
        const r = computePallets({
          L: data.length_cm,
          W: data.width_cm,
          H: data.height_cm,
          kg: w,
          rule: rule as any,
        });
        pallets = r.pallets;
        pallet_reason = r.reason;
        freight_cad = +(pallets * Number(rule.pallet_unit_price_cad ?? 0)).toFixed(2);
      } catch (e: any) {
        return { ok: false as const, reason: "oversize" as const, message: e.message };
      }
    } else {
      freight_cad = +(chargeable * unit_cad).toFixed(2);
    }
    if (freight_cad < min_cad) freight_cad = +min_cad.toFixed(2);

    let duty_cad = 0;
    if (customs?.enabled && data.declared_cad && data.declared_cad >= Number(customs.threshold_cad)) {
      duty_cad = +(data.declared_cad * (Number(customs.rate_pct) / 100)).toFixed(2);
    }

    const insurance_rate_pct = Number(rule.insurance_rate_pct ?? 0);
    const insurance_cad =
      data.declared_cad && insurance_rate_pct > 0 ? +(data.declared_cad * (insurance_rate_pct / 100)).toFixed(2) : 0;

    const sales_tax_rate_pct = route?.sales_tax_enabled ? Number(route?.sales_tax_rate_pct ?? 0) : 0;
    const taxable_base = freight_cad + clearance_cad + duty_cad + insurance_cad;
    const sales_tax_cad = sales_tax_rate_pct > 0 ? +(taxable_base * (sales_tax_rate_pct / 100)).toFixed(2) : 0;

    return {
      ok: true as const,
      pricing_mode,
      pallets,
      pallet_reason,
      chargeable_weight: +chargeable.toFixed(3),
      actual_weight: +w.toFixed(3),
      volumetric_weight: +volW.toFixed(3),
      freight_cad,
      clearance_cad: +clearance_cad.toFixed(2),
      min_charge_cad: +min_cad.toFixed(2),
      duty_cad,
      insurance_cad,
      insurance_rate_pct,
      sales_tax_cad,
      sales_tax_rate_pct,
      total_cad: +(taxable_base + sales_tax_cad).toFixed(2),
    };
  });

// =================== Oversize Rules ===================
export type OversizeRule = {
  id: string;
  name: string;
  shipping_method: string | null;
  route_id: string | null;
  max_length_cm: number | null;
  max_width_cm: number | null;
  max_height_cm: number | null;
  max_single_side_cm: number | null;
  max_weight_kg: number | null;
  max_volume_m3: number | null;
  max_girth_cm: number | null;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export const listOversizeRules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("oversize_rules")
      .select("*")
      .order("route_id", { ascending: true, nullsFirst: false })
      .order("shipping_method", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { rules: (data ?? []) as OversizeRule[] };
  });

export const upsertOversizeRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id?: string; payload: Omit<OversizeRule, "id" | "created_at" | "updated_at"> }) => d)
  .handler(async ({ data, context }) => {
    await assertManagerOrOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row: any = { ...data.payload };
    // Normalize empty strings to null
    for (const k of ["shipping_method", "route_id", "notes"]) if (row[k] === "") row[k] = null;
    for (const k of [
      "max_length_cm",
      "max_width_cm",
      "max_height_cm",
      "max_single_side_cm",
      "max_weight_kg",
      "max_volume_m3",
      "max_girth_cm",
    ]) {
      if (row[k] === "" || row[k] == null || Number.isNaN(Number(row[k]))) row[k] = null;
      else row[k] = Number(row[k]);
    }
    if (data.id) {
      const { error } = await supabaseAdmin.from("oversize_rules").update(row).eq("id", data.id);
      if (error) throw new Error(error.message);
      await recordAdminLog(supabaseAdmin, {
        entity_type: "oversize_rule",
        entity_id: data.id,
        action: "update",
        after: row,
        operator_id: context.userId,
      });
      return { ok: true, id: data.id };
    }
    const { data: ins, error } = await supabaseAdmin.from("oversize_rules").insert(row).select("id").single();
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "oversize_rule",
      entity_id: ins!.id,
      action: "create",
      after: row,
      operator_id: context.userId,
    });
    return { ok: true, id: ins!.id };
  });

export const deleteOversizeRule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManagerOrOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("oversize_rules").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("oversize_rules").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "oversize_rule",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });

/**
 * Pick best matching active oversize rule from a set for a given route_id + shipping_method.
 * Priority: route match > method match > generic (both null).
 */
export function pickOversizeRule(
  rules: OversizeRule[],
  ctx: { route_id?: string | null; shipping_method?: string | null },
): OversizeRule | null {
  const active = rules.filter((r) => r.is_active);
  const byRoute = ctx.route_id ? active.find((r) => r.route_id === ctx.route_id) : null;
  if (byRoute) return byRoute;
  const byMethod = ctx.shipping_method
    ? active.find((r) => !r.route_id && r.shipping_method === ctx.shipping_method)
    : null;
  if (byMethod) return byMethod;
  return active.find((r) => !r.route_id && !r.shipping_method) ?? null;
}

/**
 * Judge whether an item (with optional dims/weight/volume) is oversized under the given rule.
 * Any single threshold breach → oversized.
 */
export function judgeOversize(
  rule: OversizeRule | null,
  item: {
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
    weight_kg?: number | null;
    volume_m3?: number | null;
  },
): { oversize: boolean; reasons: string[] } {
  if (!rule) return { oversize: false, reasons: [] };
  const reasons: string[] = [];
  const L = Number(item.length_cm ?? 0);
  const W = Number(item.width_cm ?? 0);
  const H = Number(item.height_cm ?? 0);
  const kg = Number(item.weight_kg ?? 0);
  const vol = Number(item.volume_m3 ?? 0);
  const single = Math.max(L, W, H);
  if (rule.max_length_cm && L > rule.max_length_cm) reasons.push(`长 ${L} > ${rule.max_length_cm}`);
  if (rule.max_width_cm && W > rule.max_width_cm) reasons.push(`宽 ${W} > ${rule.max_width_cm}`);
  if (rule.max_height_cm && H > rule.max_height_cm) reasons.push(`高 ${H} > ${rule.max_height_cm}`);
  if (rule.max_single_side_cm && single > rule.max_single_side_cm)
    reasons.push(`单边 ${single} > ${rule.max_single_side_cm}`);
  if (rule.max_weight_kg && kg > rule.max_weight_kg) reasons.push(`重量 ${kg}kg > ${rule.max_weight_kg}`);
  if (rule.max_volume_m3 && vol > rule.max_volume_m3) reasons.push(`体积 ${vol}m³ > ${rule.max_volume_m3}`);
  if (rule.max_girth_cm && L && W && H) {
    const girth = L + 2 * (W + H);
    if (girth > rule.max_girth_cm) reasons.push(`周长 ${girth} > ${rule.max_girth_cm}`);
  }
  return { oversize: reasons.length > 0, reasons };
}
