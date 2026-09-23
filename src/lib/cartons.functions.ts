import { uniqueWaybills } from "./insurance";
import { effectiveWaybillInsurance } from "./insurance.server";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getFxCadPerCny, markBatchFeesDirty, markBatchFeesDirtyMany, resolveWaybillBatchIds } from "@/lib/orders.functions";

// 箱号"当前实际所属批次"：在托盘里就跟托盘走，否则用箱号自己的 batch_id
// （与 computeBatchFeeSummary 的分组口径一致：cartonsR 按 batch_id 取顶层箱号，
// palletCartons 按托盘取托盘内箱号）。
async function effectiveCartonBatchId(
  admin: any,
  row: { batch_id?: string | null; pallet_id?: string | null } | null | undefined,
): Promise<string | null> {
  if (!row) return null;
  if (row.pallet_id) {
    const { data: p } = await admin.from("pallets").select("batch_id").eq("id", row.pallet_id).maybeSingle();
    return (p as any)?.batch_id ?? row.batch_id ?? null;
  }
  return row.batch_id ?? null;
}

// resolveWaybillBatchIds 定义在 orders.functions.ts（scan.functions.ts 的量尺称重写路径也要用，
// 避免两处口径分叉）。这里是它针对整箱进出托盘场景的同类实现。
async function resolveCartonBatchIds(admin: any, cartonIds: string[]): Promise<string[]> {
  if (!cartonIds.length) return [];
  const { data: cs } = await admin.from("cartons").select("id, batch_id, pallet_id").in("id", cartonIds);
  const rows = (cs ?? []) as any[];
  const palletIds = Array.from(new Set(rows.map((c) => c.pallet_id).filter(Boolean)));
  const palletBatch = new Map<string, string | null>();
  if (palletIds.length) {
    const { data: ps } = await admin.from("pallets").select("id, batch_id").in("id", palletIds);
    for (const p of (ps ?? []) as any[]) palletBatch.set(p.id, p.batch_id ?? null);
  }
  const out = new Set<string>();
  for (const c of rows) {
    const b: string | null = c.pallet_id ? (palletBatch.get(c.pallet_id) ?? c.batch_id ?? null) : (c.batch_id ?? null);
    if (b) out.add(b);
  }
  return Array.from(out);
}

// 非致命：批次不存在/查询失败不应该挡住主操作，只是快照过期标记没打上，
// 最坏情况是客户暂时还看着旧金额，而不是这次箱号/托盘操作直接失败。
async function safeMarkDirtyMany(admin: any, batchIds: (string | null | undefined)[]) {
  try {
    await markBatchFeesDirtyMany(admin, batchIds);
  } catch (e) {
    console.error("markBatchFeesDirtyMany failed:", e);
  }
}

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

async function getOperatorName(admin: any, userId: string): Promise<string> {
  const { data } = await admin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return data?.full_name || data?.email || userId;
}

async function logAssign(
  admin: any,
  opts: {
    container: "carton" | "pallet";
    containerId: string | null;
    action: "assign" | "remove";
    childKind: "waybill" | "order" | "forwarding" | "carton";
    childIds: string[];
    operator_id: string;
    operator_name: string;
  },
) {
  if (!opts.childIds.length) return;
  let containerNo: string | null = null;
  if (opts.containerId) {
    const table = opts.container === "carton" ? "cartons" : "pallets";
    const col = opts.container === "carton" ? "carton_no" : "pallet_no";
    const { data } = await admin.from(table).select(col).eq("id", opts.containerId).maybeSingle();
    containerNo = (data as any)?.[col] ?? null;
  }
  const childMap: Record<typeof opts.childKind, { table: string; col: string }> = {
    waybill: { table: "waybills", col: "waybill_no" },
    order: { table: "orders", col: "order_no" },
    forwarding: { table: "forwarding_orders", col: "request_no" },
    carton: { table: "cartons", col: "carton_no" },
  };
  const m = childMap[opts.childKind];
  // For waybills, also fetch parent order_id/forwarding_id/carton_id so we can cascade logs
  const selectCols =
    opts.childKind === "waybill"
      ? `id, ${m.col}, order_id, forwarding_id, carton_id`
      : opts.childKind === "carton"
        ? `id, ${m.col}, pallet_id`
        : `id, ${m.col}`;
  const { data: childRows } = await admin.from(m.table).select(selectCols).in("id", opts.childIds);
  const rows = (childRows ?? []) as any[];
  const actionLabel = opts.action === "assign" ? (opts.containerId ? "加入" : "移出") : "踢出";
  const containerLabel = opts.container === "carton" ? "箱号" : "托盘";
  const childLabel: Record<string, string> = {
    waybill: "运单",
    order: "订单",
    forwarding: "集运",
    carton: "箱号",
  };
  const inserts: any[] = [];
  for (const r of rows) {
    const noteText = `${actionLabel}${childLabel[opts.childKind]} ${r[m.col]}${containerNo ? `（${containerLabel} ${containerNo}）` : `（原${containerLabel}）`}`;
    const payload = {
      child_id: r.id,
      [m.col]: r[m.col],
      container_no: containerNo,
      container_id: opts.containerId,
    };
    // Log on container
    inserts.push({
      entity_type: opts.container,
      entity_id: opts.containerId ?? r.id,
      action: `${opts.action}_${opts.childKind}`,
      before: null,
      after: payload,
      operator_id: opts.operator_id,
      operator_name: opts.operator_name,
      note: noteText,
    });
    // Log on child too (waybill/order/forwarding/carton)
    inserts.push({
      entity_type: opts.childKind,
      entity_id: r.id,
      action: `${opts.action}_to_${opts.container}`,
      before: null,
      after: payload,
      operator_id: opts.operator_id,
      operator_name: opts.operator_name,
      note: `${childLabel[opts.childKind]} ${r[m.col]} ${actionLabel} ${containerLabel} ${containerNo ?? "—"}`,
    });
    // Cascade to parent order/forwarding when child is a waybill
    if (opts.childKind === "waybill") {
      if (r.order_id) {
        const { data: o } = await admin.from("orders").select("order_no").eq("id", r.order_id).maybeSingle();
        inserts.push({
          entity_type: "order",
          entity_id: r.order_id,
          action: `waybill_${opts.action}_to_${opts.container}`,
          before: null,
          after: { waybill_id: r.id, waybill_no: r.waybill_no, container_no: containerNo },
          operator_id: opts.operator_id,
          operator_name: opts.operator_name,
          note: `订单 ${(o as any)?.order_no ?? ""} 的运单 ${r.waybill_no} ${actionLabel} ${containerLabel} ${containerNo ?? "—"}`,
        });
      }
      if (r.forwarding_id) {
        const { data: f } = await admin
          .from("forwarding_orders")
          .select("request_no")
          .eq("id", r.forwarding_id)
          .maybeSingle();
        inserts.push({
          entity_type: "forwarding",
          entity_id: r.forwarding_id,
          action: `waybill_${opts.action}_to_${opts.container}`,
          before: null,
          after: { waybill_id: r.id, waybill_no: r.waybill_no, container_no: containerNo },
          operator_id: opts.operator_id,
          operator_name: opts.operator_name,
          note: `集运单 ${(f as any)?.request_no ?? ""} 的运单 ${r.waybill_no} ${actionLabel} ${containerLabel} ${containerNo ?? "—"}`,
        });
      }
    }
  }
  if (inserts.length) await admin.from("admin_action_logs").insert(inserts);
}

async function aggregatePayment(admin: any, kind: "carton" | "pallet" | "batch", id: string): Promise<string> {
  const fn =
    kind === "carton" ? "carton_payment_status" : kind === "pallet" ? "pallet_payment_status" : "batch_payment_status";
  const params = kind === "carton" ? { _carton_id: id } : kind === "pallet" ? { _pallet_id: id } : { _batch_id: id };
  const { data } = await admin.rpc(fn, params);
  return (data as string) ?? "empty";
}

// ============================================================
// 费用计算规则（统一 CAD，不再使用 CNY）
//   有客户号 · 方案 A · 合并  = 自身运费 + Σ下属(关税 + 保险) + 附加费(自身+下属) + 末端派送费
//   无客户号 · 方案 B · 不合并 = Σ下属(运费 + 关税 + 保险 + 清关费) + 下属附加费 + 末端派送费
//   实际"采用"方案由 profiles.fee_scheme_preference 决定，默认 split (方案 B)
// 下属 = waybills.{freight_cad,duty_cad,insurance_cad,clearance_cad,surcharge_cad}
//   + 对于托盘: 子箱号的"采用运费"(有客户号取 self_freight_cad，无客户号取子箱下运单运费之和)
// ============================================================

// Compute self_freight_cad from route freight rule using self dims + self weight.
// min_charge_level=batch → 自身运费不套用最低收费（最低收费在批次层单独计算）。
async function computeSelfFreightCad(
  admin: any,
  routeId: string | null | undefined,
  weightKg: number,
  volumeM3: number,
): Promise<number> {
  if (!routeId) return 0;
  const { data: rule } = await admin
    .from("freight_rules")
    .select("*")
    .eq("route_id", routeId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rule) return 0;
  const w = Math.max(0, weightKg || 0);
  const volCm3 = Math.max(0, volumeM3 || 0) * 1_000_000;
  const divisor = Number(rule.volumetric_divisor) || 6000;
  const volW = volCm3 / divisor;
  const chargeable = rule.weight_mode === "actual" ? w : rule.weight_mode === "volumetric" ? volW : Math.max(w, volW);
  const fx = await getFxCadPerCny(admin);
  const unit_cad = Number(rule.unit_price_cad ?? 0) || Number(rule.unit_price_cny ?? 0) * fx;
  // 运单/箱自身层不再套用最低收费（只在订单级、批次级结算）
  const min_cad = 0;
  let freight = chargeable * unit_cad;
  if (freight < min_cad) freight = min_cad;
  return +freight.toFixed(2);
}

// When updating self dims/weight on a carton/pallet, derive volume & freight (CAD) automatically.
async function applySelfDerivations(admin: any, table: "cartons" | "pallets", id: string, patch: any) {
  const dimKeys = ["self_length_cm", "self_width_cm", "self_height_cm", "self_weight_kg"];
  const touched = dimKeys.some((k) => k in patch);
  if (!touched) return patch;
  const { data: row } = await admin
    .from(table)
    .select("self_length_cm, self_width_cm, self_height_cm, self_weight_kg, route_id")
    .eq("id", id)
    .maybeSingle();
  if (!row) return patch;
  const merged = { ...row, ...patch };
  const L = Number(merged.self_length_cm ?? 0);
  const W = Number(merged.self_width_cm ?? 0);
  const H = Number(merged.self_height_cm ?? 0);
  const weight = Number(merged.self_weight_kg ?? 0);
  const vol = L && W && H ? +((L * W * H) / 1_000_000).toFixed(4) : 0;
  const freightCad = await computeSelfFreightCad(admin, merged.route_id, weight, vol);
  return { ...patch, self_volume_m3: vol, self_freight_cad: freightCad, self_freight_cny: 0 };
}

async function sumSurcharges(
  admin: any,
  scope: "waybill" | "carton" | "pallet" | "batch",
  id: string,
): Promise<number> {
  const col = `${scope}_id`;
  const { data } = await admin.from("surcharges").select("amount_cny").eq("scope", scope).eq(col, id);
  const fx = await getFxCadPerCny(admin);
  return (data ?? []).reduce((s: number, r: any) => {
    const cad = Number(r.amount_cad ?? 0);
    if (cad > 0) return s + cad;
    return s + Number(r.amount_cny ?? 0) * fx;
  }, 0);
}

async function sumSurchargesForWaybills(admin: any, wbIds: string[]): Promise<number> {
  if (!wbIds.length) return 0;
  const { data } = await admin.from("surcharges").select("amount_cny").eq("scope", "waybill").in("waybill_id", wbIds);
  const fx = await getFxCadPerCny(admin);
  return (data ?? []).reduce((s: number, r: any) => {
    const cad = Number(r.amount_cad ?? 0);
    if (cad > 0) return s + cad;
    return s + Number(r.amount_cny ?? 0) * fx;
  }, 0);
}

async function computeChargeable(admin: any, routeId: string | null | undefined, weightKg: number, volumeM3: number) {
  let divisor = 6000;
  let mode: string = "greater";
  if (routeId) {
    const { data: fr } = await admin
      .from("freight_rules")
      .select("volumetric_divisor, weight_mode")
      .eq("route_id", routeId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (fr) {
      divisor = Number(fr.volumetric_divisor) || 6000;
      mode = fr.weight_mode || "greater";
    }
  }
  const volW = (Math.max(0, volumeM3 || 0) * 1_000_000) / divisor;
  const w = Math.max(0, weightKg || 0);
  const chargeable = mode === "actual" ? w : mode === "volumetric" ? volW : Math.max(w, volW);
  return { chargeable, volumetric: volW, mode, divisor };
}

async function getLastMileFeeCad(
  admin: any,
  routeId: string | null | undefined,
  chargeableKg: number,
  units = 1,
): Promise<number> {
  if (!routeId || !chargeableKg || chargeableKg <= 0) return 0;
  // 新口径：读取运费公式（freight_rules）里的末端派送费设置
  const { data: r } = await admin
    .from("freight_rules")
    .select("delivery_light_max_kg, delivery_light_fee_cad, delivery_heavy_min_kg, delivery_unit_fee_cad")
    .eq("route_id", routeId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!r) return 0;
  const lightMax = Number(r.delivery_light_max_kg ?? 0);
  const lightFee = Number(r.delivery_light_fee_cad ?? 0);
  const heavyMin = Number(r.delivery_heavy_min_kg ?? 0);
  const unitFee = Number(r.delivery_unit_fee_cad ?? 0);
  if (lightMax > 0 && chargeableKg < lightMax && lightFee > 0) return +lightFee.toFixed(2);
  if (heavyMin > 0 && chargeableKg > heavyMin && unitFee > 0)
    return +(unitFee * Math.max(1, units)).toFixed(2);
  return 0;
}


function composeCad(
  selfCad: number,
  cfCad: number,
  ccCad: number,
  ciCad: number,
  clrCad: number,
  surSelfCad: number,
  surChildCad: number,
  hasCustomer: boolean,
  lastMileCad: number,
) {
  const with_customer_total_cad = +(selfCad + ccCad + ciCad + surSelfCad + surChildCad + lastMileCad).toFixed(2);
  const without_customer_total_cad = +(cfCad + ccCad + ciCad + clrCad + surChildCad + lastMileCad).toFixed(2);
  return {
    // legacy CNY 字段保留为 0 (系统已切换到 CAD)
    self_freight_cny: 0,
    child_freight_cny: 0,
    child_customs_cny: 0,
    child_insurance_cny: 0,
    clearance_fee_cny: 0,
    surcharge_cny: 0,
    self_surcharge_cny: 0,
    child_surcharge_cny: 0,
    with_customer_total_cny: 0,
    without_customer_total_cny: 0,
    total_fee_cny: 0,
    // CAD (权威)
    self_freight_cad: +selfCad.toFixed(2),
    child_freight_cad: +cfCad.toFixed(2),
    child_customs_cad: +ccCad.toFixed(2),
    child_insurance_cad: +ciCad.toFixed(2),
    clearance_fee_cad: +clrCad.toFixed(2),
    self_surcharge_cad: +surSelfCad.toFixed(2),
    child_surcharge_cad: +surChildCad.toFixed(2),
    surcharge_cad: +(surSelfCad + surChildCad).toFixed(2),
    last_mile_cad: +lastMileCad.toFixed(2),
    with_customer_total_cad,
    without_customer_total_cad,
    has_customer: hasCustomer,
    total_fee_cad: hasCustomer ? with_customer_total_cad : without_customer_total_cad,
  };
}

async function feeTotalsForCarton(admin: any, row: any) {
  // 直挂运单 = 扫描加入本箱下的运单
  const { data: wbs } = await admin
    .from("waybills")
    .select(
      "id, forwarding_id, payment_status, weight_kg, length_cm, width_cm, height_cm, freight_cad, duty_cad, insurance_cad, clearance_cad, surcharge_cad",
    )
    .eq("carton_id", row.id);
  const list = await effectiveWaybillInsurance(admin, wbs ?? []);
  const wbIds = list.map((w: any) => w.id);
  let cf = 0,
    cc = 0,
    ci = 0,
    clr = 0,
    childSurWb = 0;
  for (const w of list) {
    cf += Number(w.freight_cad ?? 0);
    cc += Number(w.duty_cad ?? 0);
    ci += Number(w.insurance_cad ?? 0);
    clr += Number(w.clearance_cad ?? 0);
    childSurWb += Number(w.surcharge_cad ?? 0);
  }
  const wbSurchargeExtra = await sumSurchargesForWaybills(admin, wbIds);
  const selfSurcharge = await sumSurcharges(admin, "carton", row.id);
  const childSurcharge = Math.max(childSurWb, wbSurchargeExtra);

  const self = await computeChargeable(
    admin,
    row.route_id,
    Number(row.self_weight_kg ?? 0),
    Number(row.self_volume_m3 ?? 0),
  );
  let childChargeable = 0;
  for (const w of list) {
    const L = Number(w.length_cm ?? 0),
      W = Number(w.width_cm ?? 0),
      H = Number(w.height_cm ?? 0);
    const vol = L && W && H ? (L * W * H) / 1_000_000 : 0;
    const c = await computeChargeable(admin, row.route_id, Number(w.weight_kg ?? 0), vol);
    childChargeable += c.chargeable;
  }
  const hasCustomer = !!row.customer_code;
  const chargeableUsedKg = hasCustomer ? +self.chargeable.toFixed(3) : +childChargeable.toFixed(3);
  const lastMileCad = await getLastMileFeeCad(admin, row.route_id, chargeableUsedKg);
  let selfFreightCad = Number(row.self_freight_cad ?? 0);
  if (
    selfFreightCad === 0 &&
    row.route_id &&
    (Number(row.self_weight_kg ?? 0) > 0 || Number(row.self_volume_m3 ?? 0) > 0)
  ) {
    selfFreightCad = await computeSelfFreightCad(
      admin,
      row.route_id,
      Number(row.self_weight_kg ?? 0),
      Number(row.self_volume_m3 ?? 0),
    );
    if (selfFreightCad > 0) await admin.from("cartons").update({ self_freight_cad: selfFreightCad }).eq("id", row.id);
  }
  const composed = composeCad(selfFreightCad, cf, cc, ci, clr, selfSurcharge, childSurcharge, hasCustomer, lastMileCad);
  const fx = await getFxCadPerCny(admin);
  return {
    ...composed,
    fx_rate: fx,
    self_chargeable_kg: +self.chargeable.toFixed(3),
    child_chargeable_kg: +childChargeable.toFixed(3),
    chargeable_weight_kg: chargeableUsedKg,
    waybill_count: list.length,
  };
}

async function feeTotalsForPallet(admin: any, row: any) {
  const { data: directWbs } = await admin
    .from("waybills")
    .select(
      "id, forwarding_id, payment_status, weight_kg, length_cm, width_cm, height_cm, freight_cad, duty_cad, insurance_cad, clearance_cad, surcharge_cad",
    )
    .eq("pallet_id", row.id);
  const { data: cns } = await admin
    .from("cartons")
    .select("id, customer_code, self_freight_cad")
    .eq("pallet_id", row.id);
  const cartonList = cns ?? [];
  const cartonIds = cartonList.map((c: any) => c.id);
  let cnWbs: any[] = [];
  if (cartonIds.length) {
    const { data } = await admin
      .from("waybills")
      .select(
        "id, forwarding_id, payment_status, weight_kg, length_cm, width_cm, height_cm, freight_cad, duty_cad, insurance_cad, clearance_cad, surcharge_cad, carton_id",
      )
      .in("carton_id", cartonIds);
    cnWbs = data ?? [];
  }
  const allWbs = await effectiveWaybillInsurance(admin, uniqueWaybills<any>([...(directWbs ?? []), ...cnWbs]));
  const wbIds = allWbs.map((w: any) => w.id);

  // 关税/保险/清关：全部 leaf waybill 之和（两方案通用）
  let cc = 0,
    ci = 0,
    clr = 0,
    childSurWb = 0;
  for (const w of allWbs) {
    cc += Number(w.duty_cad ?? 0);
    ci += Number(w.insurance_cad ?? 0);
    clr += Number(w.clearance_cad ?? 0);
    childSurWb += Number(w.surcharge_cad ?? 0);
  }
  // cf_A 方案A（合并/有客户号）"下属运费"：
  //   直挂运单 → 采用运单的 freight_cad
  //   下属箱号有客户号 → 采用箱号 self_freight_cad（该箱号自身走 A 方案）
  //   下属箱号无客户号 → 展开累加该箱下运单 freight_cad（该箱号自身走 B 方案）
  let cfA = 0;
  for (const w of directWbs ?? []) cfA += Number(w.freight_cad ?? 0);
  for (const c of cartonList) {
    if (c.customer_code) {
      cfA += Number(c.self_freight_cad ?? 0);
    } else {
      for (const w of cnWbs) if (w.carton_id === c.id) cfA += Number(w.freight_cad ?? 0);
    }
  }
  // cf_B 方案B（不合并）"下属运费" = Σ 全部 leaf 运单 freight_cad
  let cfB = 0;
  for (const w of allWbs) cfB += Number(w.freight_cad ?? 0);

  const wbSurchargeExtra = await sumSurchargesForWaybills(admin, wbIds);
  const selfSurcharge = await sumSurcharges(admin, "pallet", row.id);
  let cartonSurcharge = 0;
  if (cartonIds.length) {
    const { data: ss } = await admin
      .from("surcharges")
      .select("amount_cny, amount_cad")
      .eq("scope", "carton")
      .in("carton_id", cartonIds);
    const fx0 = await getFxCadPerCny(admin);
    cartonSurcharge = (ss ?? []).reduce((s: number, r: any) => {
      const cad = Number(r.amount_cad ?? 0);
      return s + (cad > 0 ? cad : Number(r.amount_cny ?? 0) * fx0);
    }, 0);
  }
  const childSurcharge = Math.max(childSurWb, wbSurchargeExtra) + cartonSurcharge;

  const self = await computeChargeable(
    admin,
    row.route_id,
    Number(row.self_weight_kg ?? 0),
    Number(row.self_volume_m3 ?? 0),
  );
  let childChargeable = 0;
  for (const w of allWbs) {
    const L = Number(w.length_cm ?? 0),
      W = Number(w.width_cm ?? 0),
      H = Number(w.height_cm ?? 0);
    const vol = L && W && H ? (L * W * H) / 1_000_000 : 0;
    const c = await computeChargeable(admin, row.route_id, Number(w.weight_kg ?? 0), vol);
    childChargeable += c.chargeable;
  }
  const hasCustomer = !!row.customer_code;
  const chargeableUsedKg = hasCustomer ? +self.chargeable.toFixed(3) : +childChargeable.toFixed(3);
  const lastMileCad = await getLastMileFeeCad(admin, row.route_id, chargeableUsedKg);
  let selfFreightCad = Number(row.self_freight_cad ?? 0);
  if (
    selfFreightCad === 0 &&
    row.route_id &&
    (Number(row.self_weight_kg ?? 0) > 0 || Number(row.self_volume_m3 ?? 0) > 0)
  ) {
    selfFreightCad = await computeSelfFreightCad(
      admin,
      row.route_id,
      Number(row.self_weight_kg ?? 0),
      Number(row.self_volume_m3 ?? 0),
    );
    if (selfFreightCad > 0) await admin.from("pallets").update({ self_freight_cad: selfFreightCad }).eq("id", row.id);
  }
  // 托盘 A/B 总费用（用户明确规则）：
  //   A = 自身运费 + Σ下属运费(采用方案) + Σ关税 + Σ保险 + 附加费(自身+下属) + 末端派送费
  //   B = Σ全部leaf运费          + Σ关税 + Σ保险 + Σ清关费 + 下属附加费 + 末端派送费
  const with_customer_total_cad = +(
    selfFreightCad +
    cfA +
    cc +
    ci +
    selfSurcharge +
    childSurcharge +
    lastMileCad
  ).toFixed(2);
  const without_customer_total_cad = +(cfB + cc + ci + clr + childSurcharge + lastMileCad).toFixed(2);
  const composed = composeCad(
    selfFreightCad,
    cfB,
    cc,
    ci,
    clr,
    selfSurcharge,
    childSurcharge,
    hasCustomer,
    lastMileCad,
  );
  const fx = await getFxCadPerCny(admin);
  return {
    ...composed,
    // 覆盖为托盘自定义 A/B 结果
    child_freight_cad: cfB,
    child_freight_cad_a: +cfA.toFixed(2),
    child_freight_cad_b: +cfB.toFixed(2),
    with_customer_total_cad,
    without_customer_total_cad,
    total_fee_cad: hasCustomer ? with_customer_total_cad : without_customer_total_cad,
    fx_rate: fx,
    self_chargeable_kg: +self.chargeable.toFixed(3),
    child_chargeable_kg: +childChargeable.toFixed(3),
    chargeable_weight_kg: chargeableUsedKg,
    volumetric_weight_kg: +self.volumetric.toFixed(3),
    waybill_count: allWbs.length,
    carton_count: cartonList.length,
  };
}

async function childMetricsForCarton(admin: any, cartonId: string) {
  const { data: wbs } = await admin
    .from("waybills")
    .select("weight_kg, length_cm, width_cm, height_cm")
    .eq("carton_id", cartonId);
  let w = 0,
    v = 0;
  for (const x of wbs ?? []) {
    w += Number(x.weight_kg ?? 0);
    const L = Number(x.length_cm ?? 0),
      W = Number(x.width_cm ?? 0),
      H = Number(x.height_cm ?? 0);
    if (L && W && H) v += (L * W * H) / 1_000_000;
  }
  return { child_weight_kg: +w.toFixed(3), child_volume_m3: +v.toFixed(4) };
}

async function childMetricsForPallet(admin: any, palletId: string) {
  const { data: directWbs } = await admin
    .from("waybills")
    .select("weight_kg, length_cm, width_cm, height_cm")
    .eq("pallet_id", palletId);
  const { data: cns } = await admin.from("cartons").select("id").eq("pallet_id", palletId);
  const cartonIds = (cns ?? []).map((c: any) => c.id);
  let cnWbs: any[] = [];
  if (cartonIds.length) {
    const { data } = await admin
      .from("waybills")
      .select("weight_kg, length_cm, width_cm, height_cm")
      .in("carton_id", cartonIds);
    cnWbs = data ?? [];
  }
  let w = 0,
    v = 0;
  for (const x of [...(directWbs ?? []), ...cnWbs]) {
    w += Number(x.weight_kg ?? 0);
    const L = Number(x.length_cm ?? 0),
      W = Number(x.width_cm ?? 0),
      H = Number(x.height_cm ?? 0);
    if (L && W && H) v += (L * W * H) / 1_000_000;
  }
  return { child_weight_kg: +w.toFixed(3), child_volume_m3: +v.toFixed(4) };
}

// ===== CARTONS =====
export const listCartons = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      search?: string;
      status?: string;
      batch_id?: string;
      pallet_id?: string;
      customer_code?: string;
      route_code?: string;
      batch_no?: string;
      showClosed?: boolean;
      page?: number;
      pageSize?: number;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, data.pageSize ?? 25);
    let batchIdsFromSearch: string[] | null = null;
    if (data.search?.trim()) {
      const s = data.search.trim();
      const { data: bs } = await supabaseAdmin.from("batches").select("id").ilike("batch_no", `%${s}%`);
      batchIdsFromSearch = (bs ?? []).map((b: any) => b.id);
    }
    let q = supabaseAdmin.from("cartons").select("*", { count: "exact" }).order("created_at", { ascending: false });
    if (data.search?.trim()) {
      const s = data.search.trim();
      const parts = [
        `carton_no.ilike.%${s}%`,
        `display_name.ilike.%${s}%`,
        `customer_code.ilike.%${s}%`,
        `route_code.ilike.%${s}%`,
        `destination_code.ilike.%${s}%`,
      ];
      if (batchIdsFromSearch && batchIdsFromSearch.length) parts.push(`batch_id.in.(${batchIdsFromSearch.join(",")})`);
      q = q.or(parts.join(","));
    }
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    else if (!data.showClosed) q = q.not("status", "in", "(closed,cancelled,delivered)");
    if (data.customer_code?.trim()) q = q.ilike("customer_code", `%${data.customer_code.trim()}%`);
    if (data.route_code?.trim()) q = q.ilike("route_code", `%${data.route_code.trim()}%`);
    if (data.batch_id) q = q.eq("batch_id", data.batch_id);
    if (data.pallet_id) q = q.eq("pallet_id", data.pallet_id);

    const { data: rows, error, count } = await q.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r: any) => r.id);
    const palletIds = Array.from(new Set((rows ?? []).map((r: any) => r.pallet_id).filter(Boolean)));
    const batchIds = Array.from(new Set((rows ?? []).map((r: any) => r.batch_id).filter(Boolean)));
    const [pallets, batches, payments, fees] = await Promise.all([
      palletIds.length
        ? supabaseAdmin.from("pallets").select("id, pallet_no").in("id", palletIds)
        : Promise.resolve({ data: [] as any[] }),
      batchIds.length
        ? supabaseAdmin.from("batches").select("id, batch_no").in("id", batchIds)
        : Promise.resolve({ data: [] as any[] }),
      Promise.all(ids.map((id) => aggregatePayment(supabaseAdmin, "carton", id))),
      Promise.all((rows ?? []).map((r: any) => feeTotalsForCarton(supabaseAdmin, r))),
    ]);
    const palMap = new Map((pallets.data ?? []).map((p: any) => [p.id, p.pallet_no]));
    const batMap = new Map((batches.data ?? []).map((b: any) => [b.id, b.batch_no]));
    const items = (rows ?? []).map((r: any, i: number) => ({
      ...r,
      pallet_no: r.pallet_id ? palMap.get(r.pallet_id) : null,
      batch_no: r.batch_id ? batMap.get(r.batch_id) : null,
      payment_status: payments[i],
      ...fees[i],
    }));
    return { items, total: count ?? 0, page, pageSize };
  });

export const getCartonDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [c, w, o, f] = await Promise.all([
      supabaseAdmin.from("cartons").select("*").eq("id", data.id).maybeSingle(),
      supabaseAdmin
        .from("waybills")
        .select(
          "id, waybill_no, status, payment_status, weight_kg, length_cm, width_cm, height_cm, freight_cad, duty_cad, insurance_cad, clearance_cad, order_id, forwarding_id",
        )
        .eq("carton_id", data.id),
      supabaseAdmin.from("orders").select("id, order_no, customer_code, total_cny").eq("carton_id", data.id),
      supabaseAdmin
        .from("forwarding_orders")
        .select("id, request_no, tracking_no, customer_code, fee_cny")
        .eq("carton_id", data.id),
    ]);
    if (!c.data) throw new Error("Carton not found");
    const payment = await aggregatePayment(supabaseAdmin, "carton", data.id);
    let pallet_no: string | null = null,
      batch_no: string | null = null,
      batch_status: string | null = null;
    if (c.data.pallet_id) {
      const { data: p } = await supabaseAdmin
        .from("pallets")
        .select("pallet_no")
        .eq("id", c.data.pallet_id)
        .maybeSingle();
      pallet_no = p?.pallet_no ?? null;
    }
    if (c.data.batch_id) {
      const { data: b } = await supabaseAdmin
        .from("batches")
        .select("batch_no, status")
        .eq("id", c.data.batch_id)
        .maybeSingle();
      batch_no = b?.batch_no ?? null;
      batch_status = (b as any)?.status ?? null;
    }
    const fees = await feeTotalsForCarton(supabaseAdmin, c.data);
    let customer_fee_scheme: "merged" | "split" | null = null;
    if (c.data.customer_user_id) {
      const { data: pr } = await supabaseAdmin
        .from("profiles")
        .select("fee_scheme_preference")
        .eq("id", c.data.customer_user_id)
        .maybeSingle();
      customer_fee_scheme = ((pr as any)?.fee_scheme_preference ?? "split") as "merged" | "split";
    }
    (fees as any).customer_fee_scheme = customer_fee_scheme;
    const childMetrics = await childMetricsForCarton(supabaseAdmin, data.id);
    // Enrich waybills with surcharge sum + volume
    const wbList = (w.data ?? []) as any[];
    const wbIds = wbList.map((x) => x.id);
    const surchargeMap = new Map<string, number>();
    if (wbIds.length) {
      const { data: ss } = await supabaseAdmin
        .from("surcharges")
        .select("waybill_id, amount_cny")
        .eq("scope", "waybill")
        .in("waybill_id", wbIds);
      for (const s of (ss ?? []) as any[])
        surchargeMap.set(s.waybill_id, (surchargeMap.get(s.waybill_id) ?? 0) + Number(s.amount_cny ?? 0));
    }
    const fx = (fees as any).fx_rate ?? 1;
    const waybillsEnriched = wbList.map((x) => {
      const L = Number(x.length_cm ?? 0),
        W = Number(x.width_cm ?? 0),
        H = Number(x.height_cm ?? 0);
      const volume_m3 = L && W && H ? +((L * W * H) / 1_000_000).toFixed(4) : 0;
      const surcharge_cny = surchargeMap.get(x.id) ?? 0;
      return { ...x, volume_m3, surcharge_cny, surcharge_cad: +(surcharge_cny * fx).toFixed(2) };
    });
    return {
      carton: {
        ...c.data,
        payment_status: payment,
        pallet_no,
        batch_no,
        batch_status,
        ...fees,
        ...childMetrics,
      },
      fees,
      waybills: waybillsEnriched,
      orders: o.data ?? [],
      forwardings: f.data ?? [],
    };
  });

export const createCarton = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      display_name?: string;
      notes?: string;
      batch_id?: string;
      pallet_id?: string;
      weight_kg?: number;
      route_id?: string;
      route_code?: string;
      customer_user_id?: string;
      customer_code?: string;
      pickup_warehouse?: string;
      destination_code?: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nz = (v: any) => (v === "" || v === undefined ? null : v);
    const { data: ins, error } = await supabaseAdmin
      .from("cartons")
      .insert({
        display_name: nz(data.display_name),
        notes: nz(data.notes),
        batch_id: nz(data.batch_id),
        pallet_id: nz(data.pallet_id),
        weight_kg: nz(data.weight_kg),
        route_id: nz(data.route_id),
        route_code: nz(data.route_code),
        customer_user_id: nz(data.customer_user_id),
        customer_code: nz(data.customer_code),
        pickup_warehouse: nz(data.pickup_warehouse),
        destination_code: nz(data.destination_code),
        created_by: context.userId,
      } as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "carton",
      entity_id: ins.id,
      action: "create",
      before: null,
      after: ins,
      operator_id: context.userId,
      operator_name,
      note: `新建箱号 ${ins.carton_no}`,
    });
    const effBatch = await effectiveCartonBatchId(supabaseAdmin, ins);
    if (effBatch) await safeMarkDirtyMany(supabaseAdmin, [effBatch]);
    return { ok: true, carton: ins };
  });

async function assertContainerEditable(admin: any, table: "cartons" | "pallets", row: any) {
  if (!row?.batch_id) return;
  if (row.unlocked) return;
  const { data: b } = await admin.from("batches").select("status").eq("id", row.batch_id).maybeSingle();
  const status = (b as any)?.status;
  if (status && status !== "draft") {
    throw new Error(`所属批次为 ${status}（非草稿），请先在详情页 "人工解锁" 后再编辑`);
  }
}

export const updateCarton = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; patch: any }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("cartons").select("*").eq("id", data.id).maybeSingle();
    await assertContainerEditable(supabaseAdmin, "cartons", before);
    const patch = await applySelfDerivations(supabaseAdmin, "cartons", data.id, data.patch ?? {});
    const { error } = await supabaseAdmin.from("cartons").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    const changedKeys = Object.keys(patch);
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "carton",
      entity_id: data.id,
      action: "update",
      before,
      after: patch,
      operator_id: context.userId,
      operator_name,
      note: `更新箱号 ${(before as any)?.carton_no ?? ""} 字段：${changedKeys.join(", ")}`,
    });
    // 量尺称重/线路/托盘归属等任何字段变动都可能影响该箱号所在批次的费用汇总——
    // 改动前后的批次都打脏（万一这次改动顺带把箱号挪到了别的批次）。
    const beforeBatch = await effectiveCartonBatchId(supabaseAdmin, before);
    const afterBatch = await effectiveCartonBatchId(supabaseAdmin, { ...(before as any), ...patch });
    await safeMarkDirtyMany(supabaseAdmin, [beforeBatch, afterBatch]);
    return { ok: true };
  });

export const setContainerUnlock = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: "carton" | "pallet"; id: string; unlocked: boolean }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const table = data.kind === "carton" ? "cartons" : "pallets";
    const noCol = data.kind === "carton" ? "carton_no" : "pallet_no";
    const { data: row } = await supabaseAdmin
      .from(table)
      .select(`id, ${noCol}, unlocked, batch_id`)
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("对象不存在");
    await supabaseAdmin.from(table).update({ unlocked: data.unlocked }).eq("id", data.id);
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: data.kind,
      entity_id: data.id,
      action: data.unlocked ? "unlock" : "lock",
      before: { unlocked: (row as any).unlocked },
      after: { unlocked: data.unlocked },
      operator_id: context.userId,
      operator_name,
      note: `${data.unlocked ? "人工解锁" : "重新锁定"} ${data.kind === "carton" ? "箱号" : "托盘"} ${(row as any)[noCol]}`,
    });
    return { ok: true };
  });

export const deleteCarton = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { assertManagerLevel } = await import("./admin-delete.server");
    await assertManagerLevel(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("cartons").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("cartons").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "carton",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
      operator_name,
      note: `删除箱号 ${(before as any)?.carton_no ?? ""}`,
    });
    const effBatch = await effectiveCartonBatchId(supabaseAdmin, before);
    if (effBatch) await safeMarkDirtyMany(supabaseAdmin, [effBatch]);
    return { ok: true };
  });

// Canonical string for comparing two addresses regardless of which snapshot
// shape they came from (orders.address_snapshot vs an `addresses` table row) —
// same street/city/province/postal/country always compares equal.
function addressKey(a: any): string | null {
  if (!a) return null;
  const parts = [
    a.line1 ?? a.address1,
    a.line2 ?? a.address2 ?? "",
    a.city,
    a.province ?? a.state,
    a.postal_code ?? a.zip,
    a.country,
  ].map((v) => (v ?? "").toString().trim().toLowerCase());
  return parts.some(Boolean) ? parts.join("|") : null;
}

// Validate matching: waybill's route/customer/pickup/destination/address must equal
// carton's, when the carton already has those set. The address check only kicks in
// once the carton has a customer_code — a carton with no customer bound yet (a
// deliberately mixed carton) accepts anything, per the existing customer_code gate.
function mismatchReason(
  carton: any,
  ctx: {
    route_code?: string | null;
    customer_code?: string | null;
    pickup_warehouse?: string | null;
    destination_code?: string | null;
    address?: any;
  },
  no: string,
) {
  if (carton.route_code && ctx.route_code && carton.route_code !== ctx.route_code)
    return `${no}: 线路不匹配（箱号要求 ${carton.route_code}，单为 ${ctx.route_code}）`;
  if (carton.customer_code && ctx.customer_code && carton.customer_code !== ctx.customer_code)
    return `${no}: 客户号不匹配（箱号要求 ${carton.customer_code}）`;
  if (carton.pickup_warehouse && ctx.pickup_warehouse && carton.pickup_warehouse !== ctx.pickup_warehouse)
    return `${no}: 取货点不匹配`;
  if (carton.destination_code && ctx.destination_code && carton.destination_code !== ctx.destination_code)
    return `${no}: 目的地不匹配`;
  if (carton.customer_code) {
    const cartonKey = addressKey(carton.address_snapshot);
    const itemKey = addressKey(ctx.address);
    if (cartonKey && itemKey && cartonKey !== itemKey) return `${no}: 收货地址与箱号内其他运单不一致，无法加入同一箱`;
  }
  return null;
}

export const assignToCarton = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      cartonId: string | null;
      waybillIds?: string[];
      orderIds?: string[];
      forwardingIds?: string[];
      force?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let carton: any = null;
    if (data.cartonId) {
      const { data: c } = await supabaseAdmin.from("cartons").select("*").eq("id", data.cartonId).maybeSingle();
      carton = c;
    }
    // Gathered up front so we can both validate against the carton AND (when the
    // carton has no customer bound yet) lock it onto the first item's address below.
    let lockCandidate: {
      customer_code: string | null;
      customer_user_id: string | null;
      address: any;
    } | null = null;
    if (data.cartonId && carton && !data.force) {
      const addrIds: string[] = [];
      let wbs: any[] = [];
      if (data.waybillIds?.length) {
        const { data: rows } = await supabaseAdmin
          .from("waybills")
          .select(
            `
          id, waybill_no,
          orders:order_id(route_code, customer_code, user_id, address_snapshot, destination_code),
          forwarding_orders:forwarding_id(route_code, customer_code, user_id, address_id, destination_code, warehouse)
        `,
          )
          .in("id", data.waybillIds);
        wbs = rows ?? [];
        for (const w of wbs) {
          const fwd = (w as any).forwarding_orders;
          if (fwd?.address_id) addrIds.push(fwd.address_id);
        }
      }
      let os: any[] = [];
      if (data.orderIds?.length) {
        const { data: rows } = await supabaseAdmin
          .from("orders")
          .select("id, order_no, route_code, customer_code, user_id, address_snapshot, destination_code")
          .in("id", data.orderIds);
        os = rows ?? [];
      }
      let fs: any[] = [];
      if (data.forwardingIds?.length) {
        const { data: rows } = await supabaseAdmin
          .from("forwarding_orders")
          .select("id, request_no, route_code, customer_code, user_id, address_id, destination_code, warehouse")
          .in("id", data.forwardingIds);
        fs = rows ?? [];
        for (const f of fs) if (f.address_id) addrIds.push(f.address_id);
      }
      const addrMap = new Map<string, any>();
      if (addrIds.length) {
        const { data: addrs } = await supabaseAdmin
          .from("addresses")
          .select("*")
          .in("id", Array.from(new Set(addrIds)));
        for (const a of addrs ?? []) addrMap.set(a.id, a);
      }

      const noteLock = (customer_code: string | null, customer_user_id: string | null, address: any, no: string) => {
        if (carton.customer_code) return; // carton already bound — nothing to lock in
        if (!customer_code || !address) return; // can't lock onto an item with no resolvable customer/address
        if (!lockCandidate) {
          lockCandidate = { customer_code, customer_user_id, address };
          return;
        }
        if (addressKey(lockCandidate.address) !== addressKey(address)) {
          throw new Error(
            `${no}: 收货地址与本次一起加入的其他运单不一致——箱号还没绑定客户，第一批加入的必须是同一收货地址`,
          );
        }
      };

      for (const w of wbs) {
        const parent: any = (w as any).orders ?? (w as any).forwarding_orders ?? {};
        const address = parent.address_snapshot ?? (parent.address_id ? addrMap.get(parent.address_id) : null);
        const reason = mismatchReason(
          carton,
          {
            route_code: parent.route_code,
            customer_code: parent.customer_code,
            pickup_warehouse: parent.warehouse,
            destination_code: parent.destination_code,
            address,
          },
          w.waybill_no,
        );
        if (reason) throw new Error(reason);
        noteLock(parent.customer_code ?? null, parent.user_id ?? null, address, w.waybill_no);
      }
      for (const o of os) {
        const reason = mismatchReason(
          carton,
          {
            route_code: o.route_code,
            customer_code: o.customer_code,
            destination_code: o.destination_code,
            address: o.address_snapshot,
          },
          o.order_no,
        );
        if (reason) throw new Error(reason);
        noteLock(o.customer_code ?? null, o.user_id ?? null, o.address_snapshot, o.order_no);
      }
      for (const f of fs) {
        const address = f.address_id ? addrMap.get(f.address_id) : null;
        const reason = mismatchReason(
          carton,
          {
            route_code: f.route_code,
            customer_code: f.customer_code,
            destination_code: f.destination_code,
            pickup_warehouse: f.warehouse,
            address,
          },
          f.request_no ?? "",
        );
        if (reason) throw new Error(reason);
        noteLock(f.customer_code ?? null, f.user_id ?? null, address, f.request_no ?? "");
      }
    }
    // 运单进箱/出箱会改变它计入哪个批次的费用汇总——改动前先记下"原来在哪"，
    // 连同目标箱号所在批次一起，改动成功后统一打脏。
    const sourceBatchIds = data.waybillIds?.length ? await resolveWaybillBatchIds(supabaseAdmin, data.waybillIds) : [];
    const targetBatchId = data.cartonId ? await effectiveCartonBatchId(supabaseAdmin, carton) : null;

    const action: "assign" | "remove" = data.cartonId ? "assign" : "remove";
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    const logCtx = {
      container: "carton" as const,
      containerId: data.cartonId,
      action,
      operator_id: context.userId,
      operator_name,
    };
    if (data.waybillIds?.length) {
      const { error } = await supabaseAdmin
        .from("waybills")
        .update({ carton_id: data.cartonId })
        .in("id", data.waybillIds);
      if (error) throw new Error(error.message);
      await logAssign(supabaseAdmin, {
        ...logCtx,
        childKind: "waybill",
        childIds: data.waybillIds,
      });
    }
    if (data.orderIds?.length) {
      const { error } = await supabaseAdmin.from("orders").update({ carton_id: data.cartonId }).in("id", data.orderIds);
      if (error) throw new Error(error.message);
      await logAssign(supabaseAdmin, { ...logCtx, childKind: "order", childIds: data.orderIds });
    }
    if (data.forwardingIds?.length) {
      const { error } = await supabaseAdmin
        .from("forwarding_orders")
        .update({ carton_id: data.cartonId })
        .in("id", data.forwardingIds);
      if (error) throw new Error(error.message);
      await logAssign(supabaseAdmin, {
        ...logCtx,
        childKind: "forwarding",
        childIds: data.forwardingIds,
      });
    }
    // First customer item just went in — lock the carton onto its actual shipping
    // address so every later add is checked against it (see mismatchReason above).
    if (lockCandidate && data.cartonId) {
      await supabaseAdmin
        .from("cartons")
        .update({
          customer_code: (lockCandidate as any).customer_code,
          customer_user_id: (lockCandidate as any).customer_user_id,
          address_snapshot: (lockCandidate as any).address,
        })
        .eq("id", data.cartonId);
    }
    if (data.waybillIds?.length) {
      await safeMarkDirtyMany(supabaseAdmin, [...sourceBatchIds, targetBatchId]);
    }
    return { ok: true };
  });

// ===== PALLETS =====
export const listPallets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      search?: string;
      status?: string;
      batch_id?: string;
      customer_code?: string;
      route_code?: string;
      batch_no?: string;
      showClosed?: boolean;
      page?: number;
      pageSize?: number;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, data.pageSize ?? 25);
    let batchIdsFromSearch: string[] | null = null;
    if (data.search?.trim()) {
      const s = data.search.trim();
      const { data: bs } = await supabaseAdmin.from("batches").select("id").ilike("batch_no", `%${s}%`);
      batchIdsFromSearch = (bs ?? []).map((b: any) => b.id);
    }
    let q = supabaseAdmin.from("pallets").select("*", { count: "exact" }).order("created_at", { ascending: false });
    if (data.search?.trim()) {
      const s = data.search.trim();
      const parts = [
        `pallet_no.ilike.%${s}%`,
        `display_name.ilike.%${s}%`,
        `customer_code.ilike.%${s}%`,
        `route_code.ilike.%${s}%`,
        `destination_code.ilike.%${s}%`,
      ];
      if (batchIdsFromSearch && batchIdsFromSearch.length) parts.push(`batch_id.in.(${batchIdsFromSearch.join(",")})`);
      q = q.or(parts.join(","));
    }
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    else if (!data.showClosed) q = q.not("status", "in", "(closed,cancelled,delivered)");
    if (data.customer_code?.trim()) q = q.ilike("customer_code", `%${data.customer_code.trim()}%`);
    if (data.route_code?.trim()) q = q.ilike("route_code", `%${data.route_code.trim()}%`);
    if (data.batch_id) q = q.eq("batch_id", data.batch_id);

    const { data: rows, error, count } = await q.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    const ids = (rows ?? []).map((r: any) => r.id);
    const batchIds = Array.from(new Set((rows ?? []).map((r: any) => r.batch_id).filter(Boolean)));
    const [batches, payments, fees, childMetrics] = await Promise.all([
      batchIds.length
        ? supabaseAdmin.from("batches").select("id, batch_no").in("id", batchIds)
        : Promise.resolve({ data: [] as any[] }),
      Promise.all(ids.map((id) => aggregatePayment(supabaseAdmin, "pallet", id))),
      Promise.all((rows ?? []).map((r: any) => feeTotalsForPallet(supabaseAdmin, r))),
      Promise.all(ids.map((id) => childMetricsForPallet(supabaseAdmin, id))),
    ]);
    const batMap = new Map((batches.data ?? []).map((b: any) => [b.id, b.batch_no]));
    const items = (rows ?? []).map((r: any, i: number) => ({
      ...r,
      batch_no: r.batch_id ? batMap.get(r.batch_id) : null,
      payment_status: payments[i],
      ...fees[i],
      ...childMetrics[i],
    }));
    return { items, total: count ?? 0, page, pageSize };
  });

export const getPalletDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [p, c, w, o, f] = await Promise.all([
      supabaseAdmin.from("pallets").select("*").eq("id", data.id).maybeSingle(),
      supabaseAdmin.from("cartons").select("*").eq("pallet_id", data.id),

      supabaseAdmin
        .from("waybills")
        .select(
          "id, waybill_no, status, weight_kg, length_cm, width_cm, height_cm, freight_cad, duty_cad, insurance_cad, clearance_cad, payment_status",
        )
        .eq("pallet_id", data.id),
      supabaseAdmin.from("orders").select("id, order_no, customer_code").eq("pallet_id", data.id),
      supabaseAdmin
        .from("forwarding_orders")
        .select("id, request_no, tracking_no, customer_code")
        .eq("pallet_id", data.id),
    ]);
    if (!p.data) throw new Error("Pallet not found");
    const payment = await aggregatePayment(supabaseAdmin, "pallet", data.id);
    let batch_no: string | null = null,
      batch_status: string | null = null;
    if (p.data.batch_id) {
      const { data: b } = await supabaseAdmin
        .from("batches")
        .select("batch_no, status")
        .eq("id", p.data.batch_id)
        .maybeSingle();
      batch_no = b?.batch_no ?? null;
      batch_status = (b as any)?.status ?? null;
    }
    const fees = await feeTotalsForPallet(supabaseAdmin, p.data);
    let customer_fee_scheme: "merged" | "split" | null = null;
    if (p.data.customer_user_id) {
      const { data: pr } = await supabaseAdmin
        .from("profiles")
        .select("fee_scheme_preference")
        .eq("id", p.data.customer_user_id)
        .maybeSingle();
      customer_fee_scheme = ((pr as any)?.fee_scheme_preference ?? "split") as "merged" | "split";
    }
    (fees as any).customer_fee_scheme = customer_fee_scheme;
    const childMetrics = await childMetricsForPallet(supabaseAdmin, data.id);
    const wbList = (w.data ?? []) as any[];
    const wbIds = wbList.map((x) => x.id);
    const surchargeMap = new Map<string, number>();
    if (wbIds.length) {
      const { data: ss } = await supabaseAdmin
        .from("surcharges")
        .select("waybill_id, amount_cny")
        .eq("scope", "waybill")
        .in("waybill_id", wbIds);
      for (const s of (ss ?? []) as any[])
        surchargeMap.set(s.waybill_id, (surchargeMap.get(s.waybill_id) ?? 0) + Number(s.amount_cny ?? 0));
    }
    const fx = (fees as any).fx_rate ?? 1;
    const waybillsEnriched = wbList.map((x) => {
      const L = Number(x.length_cm ?? 0),
        W = Number(x.width_cm ?? 0),
        H = Number(x.height_cm ?? 0);
      const volume_m3 = L && W && H ? +((L * W * H) / 1_000_000).toFixed(4) : 0;
      const surcharge_cny = surchargeMap.get(x.id) ?? 0;
      return { ...x, volume_m3, surcharge_cny, surcharge_cad: +(surcharge_cny * fx).toFixed(2) };
    });
    // 计算每个下属箱号的费用（供 CartonCompactList 使用）
    const cartonRows = (c.data ?? []) as any[];
    const cartonFees = await Promise.all(cartonRows.map((cr) => feeTotalsForCarton(supabaseAdmin, cr)));
    const cartonPayments = await Promise.all(cartonRows.map((cr) => aggregatePayment(supabaseAdmin, "carton", cr.id)));
    const cartonsEnriched = cartonRows.map((cr, i) => ({
      ...cr,
      payment_status: cartonPayments[i],
      ...cartonFees[i],
    }));
    return {
      pallet: {
        ...p.data,
        payment_status: payment,
        batch_no,
        batch_status,
        ...fees,
        ...childMetrics,
      },
      fees,
      cartons: cartonsEnriched,
      waybills: waybillsEnriched,
      orders: o.data ?? [],
      forwardings: f.data ?? [],
    };
  });

export const createPallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      display_name?: string;
      notes?: string;
      batch_id?: string;
      weight_kg?: number;
      route_id?: string;
      route_code?: string;
      customer_user_id?: string;
      customer_code?: string;
      pickup_warehouse?: string;
      destination_code?: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nz = (v: any) => (v === "" || v === undefined ? null : v);
    const { data: ins, error } = await supabaseAdmin
      .from("pallets")
      .insert({
        display_name: nz(data.display_name),
        notes: nz(data.notes),
        batch_id: nz(data.batch_id),
        weight_kg: nz(data.weight_kg),
        route_id: nz(data.route_id),
        route_code: nz(data.route_code),
        customer_user_id: nz(data.customer_user_id),
        customer_code: nz(data.customer_code),
        pickup_warehouse: nz(data.pickup_warehouse),
        destination_code: nz(data.destination_code),
        created_by: context.userId,
      } as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "pallet",
      entity_id: ins.id,
      action: "create",
      before: null,
      after: ins,
      operator_id: context.userId,
      operator_name,
      note: `新建托盘 ${ins.pallet_no}`,
    });
    if (ins.batch_id) await safeMarkDirtyMany(supabaseAdmin, [ins.batch_id]);
    return { ok: true, pallet: ins };
  });

export const updatePallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; patch: any }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("pallets").select("*").eq("id", data.id).maybeSingle();
    await assertContainerEditable(supabaseAdmin, "pallets", before);
    const patch = await applySelfDerivations(supabaseAdmin, "pallets", data.id, data.patch ?? {});
    const { error } = await supabaseAdmin.from("pallets").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    const changedKeys = Object.keys(patch);
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "pallet",
      entity_id: data.id,
      action: "update",
      before,
      after: patch,
      operator_id: context.userId,
      operator_name,
      note: `更新托盘 ${(before as any)?.pallet_no ?? ""} 字段：${changedKeys.join(", ")}`,
    });
    await safeMarkDirtyMany(supabaseAdmin, [(before as any)?.batch_id ?? null, patch.batch_id ?? (before as any)?.batch_id ?? null]);
    return { ok: true };
  });

export const deletePallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { assertManagerLevel } = await import("./admin-delete.server");
    await assertManagerLevel(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("pallets").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("pallets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "pallet",
      entity_id: data.id,
      action: "delete",
      before,
      after: null,
      operator_id: context.userId,
      operator_name,
      note: `删除托盘 ${(before as any)?.pallet_no ?? ""}`,
    });
    if ((before as any)?.batch_id) await safeMarkDirtyMany(supabaseAdmin, [(before as any).batch_id]);
    return { ok: true };
  });

export const splitPallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("pallets").select("*").eq("id", data.id).maybeSingle();
    if (!before) throw new Error("托盘不存在");
    const batchId = (before as any).batch_id ?? null;
    // 保留 batch_id：将子箱号/直挂运单从托盘下解绑，但保持其所属批次
    const { data: cs } = await supabaseAdmin.from("cartons").select("id, carton_no").eq("pallet_id", data.id);
    const { data: wbs } = await supabaseAdmin.from("waybills").select("id, waybill_no").eq("pallet_id", data.id);
    const cartonIds = (cs ?? []).map((c: any) => c.id);
    const wbIds = (wbs ?? []).map((w: any) => w.id);
    if (cartonIds.length) {
      await supabaseAdmin.from("cartons").update({ pallet_id: null, batch_id: batchId }).in("id", cartonIds);
    }
    if (wbIds.length) {
      await supabaseAdmin.from("waybills").update({ pallet_id: null, assigned_batch_id: batchId }).in("id", wbIds);
    }
    const { error } = await supabaseAdmin.from("pallets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "pallet",
      entity_id: data.id,
      action: "split",
      before,
      after: { released_cartons: cs, released_waybills: wbs, batch_id: batchId },
      operator_id: context.userId,
      operator_name,
      note: `拆分托盘 ${(before as any).pallet_no}（释放 ${cartonIds.length} 箱 / ${wbIds.length} 单 → 批次${batchId ? "" : "外"}）并删除托盘`,
    });
    if (batchId) await safeMarkDirtyMany(supabaseAdmin, [batchId]);
    return { ok: true, released_cartons: cartonIds.length, released_waybills: wbIds.length };
  });

// Pallet-side counterpart of mismatchReason above — pallets don't enforce
// route/pickup/destination matching (that's carton-only, pre-existing), only the
// same "locked address once a customer is bound" rule the user asked for.
function palletAddressMismatch(pallet: any, address: any, customer_code: string | null, no: string) {
  if (!pallet.customer_code) return null; // pallet not bound to a customer yet — anything goes
  const palletKey = addressKey(pallet.address_snapshot);
  const itemKey = addressKey(address);
  if (palletKey && itemKey && palletKey !== itemKey) return `${no}: 收货地址与托盘内其他货物不一致，无法加入同一托盘`;
  if (pallet.customer_code && customer_code && pallet.customer_code !== customer_code)
    return `${no}: 客户号不匹配（托盘要求 ${pallet.customer_code}）`;
  return null;
}

export const assignToPallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      palletId: string | null;
      cartonIds?: string[];
      waybillIds?: string[];
      orderIds?: string[];
      forwardingIds?: string[];
      force?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let pallet: any = null;
    if (data.palletId) {
      const { data: p } = await supabaseAdmin.from("pallets").select("*").eq("id", data.palletId).maybeSingle();
      pallet = p;
    }
    let lockCandidate: {
      customer_code: string | null;
      customer_user_id: string | null;
      address: any;
    } | null = null;
    if (data.palletId && pallet && !data.force) {
      const addrIds: string[] = [];
      let cs: any[] = [];
      if (data.cartonIds?.length) {
        const { data: rows } = await supabaseAdmin
          .from("cartons")
          .select("id, carton_no, customer_code, customer_user_id, address_snapshot")
          .in("id", data.cartonIds);
        cs = rows ?? [];
      }
      let wbs: any[] = [];
      if (data.waybillIds?.length) {
        const { data: rows } = await supabaseAdmin
          .from("waybills")
          .select(
            `
          id, waybill_no,
          orders:order_id(customer_code, user_id, address_snapshot),
          forwarding_orders:forwarding_id(customer_code, user_id, address_id)
        `,
          )
          .in("id", data.waybillIds);
        wbs = rows ?? [];
        for (const w of wbs) {
          const fwd = (w as any).forwarding_orders;
          if (fwd?.address_id) addrIds.push(fwd.address_id);
        }
      }
      let os: any[] = [];
      if (data.orderIds?.length) {
        const { data: rows } = await supabaseAdmin
          .from("orders")
          .select("id, order_no, customer_code, user_id, address_snapshot")
          .in("id", data.orderIds);
        os = rows ?? [];
      }
      let fs: any[] = [];
      if (data.forwardingIds?.length) {
        const { data: rows } = await supabaseAdmin
          .from("forwarding_orders")
          .select("id, request_no, customer_code, user_id, address_id")
          .in("id", data.forwardingIds);
        fs = rows ?? [];
        for (const f of fs) if (f.address_id) addrIds.push(f.address_id);
      }
      const addrMap = new Map<string, any>();
      if (addrIds.length) {
        const { data: addrs } = await supabaseAdmin
          .from("addresses")
          .select("*")
          .in("id", Array.from(new Set(addrIds)));
        for (const a of addrs ?? []) addrMap.set(a.id, a);
      }

      const noteLock = (customer_code: string | null, customer_user_id: string | null, address: any, no: string) => {
        if (pallet.customer_code) return;
        if (!customer_code || !address) return;
        if (!lockCandidate) {
          lockCandidate = { customer_code, customer_user_id, address };
          return;
        }
        if (addressKey(lockCandidate.address) !== addressKey(address)) {
          throw new Error(
            `${no}: 收货地址与本次一起加入的其他货物不一致——托盘还没绑定客户，第一批加入的必须是同一收货地址`,
          );
        }
      };

      for (const c of cs) {
        const reason = palletAddressMismatch(pallet, c.address_snapshot, c.customer_code, c.carton_no);
        if (reason) throw new Error(reason);
        noteLock(c.customer_code ?? null, c.customer_user_id ?? null, c.address_snapshot, c.carton_no);
      }
      for (const w of wbs) {
        const parent: any = (w as any).orders ?? (w as any).forwarding_orders ?? {};
        const address = parent.address_snapshot ?? (parent.address_id ? addrMap.get(parent.address_id) : null);
        const reason = palletAddressMismatch(pallet, address, parent.customer_code, w.waybill_no);
        if (reason) throw new Error(reason);
        noteLock(parent.customer_code ?? null, parent.user_id ?? null, address, w.waybill_no);
      }
      for (const o of os) {
        const reason = palletAddressMismatch(pallet, o.address_snapshot, o.customer_code, o.order_no);
        if (reason) throw new Error(reason);
        noteLock(o.customer_code ?? null, o.user_id ?? null, o.address_snapshot, o.order_no);
      }
      for (const f of fs) {
        const address = f.address_id ? addrMap.get(f.address_id) : null;
        const reason = palletAddressMismatch(pallet, address, f.customer_code, f.request_no ?? "");
        if (reason) throw new Error(reason);
        noteLock(f.customer_code ?? null, f.user_id ?? null, address, f.request_no ?? "");
      }
    }
    // 整箱/散单进出托盘同样会改变计入哪个批次的费用汇总——先记下改动前各自在哪个批次。
    const sourceCartonBatchIds = data.cartonIds?.length ? await resolveCartonBatchIds(supabaseAdmin, data.cartonIds) : [];
    const sourceWbBatchIds = data.waybillIds?.length ? await resolveWaybillBatchIds(supabaseAdmin, data.waybillIds) : [];
    const targetBatchId = data.palletId ? ((pallet as any)?.batch_id ?? null) : null;

    const action: "assign" | "remove" = data.palletId ? "assign" : "remove";
    const operator_name = await getOperatorName(supabaseAdmin, context.userId);
    const logCtx = {
      container: "pallet" as const,
      containerId: data.palletId,
      action,
      operator_id: context.userId,
      operator_name,
    };
    if (data.cartonIds?.length) {
      const { error } = await supabaseAdmin
        .from("cartons")
        .update({ pallet_id: data.palletId })
        .in("id", data.cartonIds);
      if (error) throw new Error(error.message);
      await logAssign(supabaseAdmin, { ...logCtx, childKind: "carton", childIds: data.cartonIds });
    }
    if (data.waybillIds?.length) {
      const { error } = await supabaseAdmin
        .from("waybills")
        .update({ pallet_id: data.palletId })
        .in("id", data.waybillIds);
      if (error) throw new Error(error.message);
      await logAssign(supabaseAdmin, {
        ...logCtx,
        childKind: "waybill",
        childIds: data.waybillIds,
      });
    }
    if (data.orderIds?.length) {
      const { error } = await supabaseAdmin.from("orders").update({ pallet_id: data.palletId }).in("id", data.orderIds);
      if (error) throw new Error(error.message);
      await logAssign(supabaseAdmin, { ...logCtx, childKind: "order", childIds: data.orderIds });
    }
    if (data.forwardingIds?.length) {
      const { error } = await supabaseAdmin
        .from("forwarding_orders")
        .update({ pallet_id: data.palletId })
        .in("id", data.forwardingIds);
      if (error) throw new Error(error.message);
      await logAssign(supabaseAdmin, {
        ...logCtx,
        childKind: "forwarding",
        childIds: data.forwardingIds,
      });
    }
    if (lockCandidate && data.palletId) {
      await supabaseAdmin
        .from("pallets")
        .update({
          customer_code: (lockCandidate as any).customer_code,
          customer_user_id: (lockCandidate as any).customer_user_id,
          address_snapshot: (lockCandidate as any).address,
        })
        .eq("id", data.palletId);
    }
    if (data.cartonIds?.length || data.waybillIds?.length) {
      await safeMarkDirtyMany(supabaseAdmin, [...sourceCartonBatchIds, ...sourceWbBatchIds, targetBatchId]);
    }
    return { ok: true };
  });

// ===== Label data fns =====
export const getContainerLabelData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: "carton" | "pallet" | "batch"; id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.kind === "carton") {
      const { data: c } = await supabaseAdmin.from("cartons").select("*").eq("id", data.id).maybeSingle();
      if (!c) throw new Error("Carton not found");
      const [{ count: wbCount }, payment, pallet, batch] = await Promise.all([
        supabaseAdmin.from("waybills").select("*", { count: "exact", head: true }).eq("carton_id", data.id),
        aggregatePayment(supabaseAdmin, "carton", data.id),
        c.pallet_id
          ? supabaseAdmin.from("pallets").select("pallet_no").eq("id", c.pallet_id).maybeSingle()
          : Promise.resolve({ data: null }),
        c.batch_id
          ? supabaseAdmin.from("batches").select("batch_no, shipping_method").eq("id", c.batch_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return {
        entityType: "carton" as const,
        entityNo: c.carton_no,
        meta: {
          status: c.status,
          created_at: c.created_at,
          weight_kg: c.weight_kg,
          notes: c.notes,
          route_code: c.route_code,
          customer_code: c.customer_code,
          pickup_warehouse: c.pickup_warehouse,
          destination_code: c.destination_code,
          shipping_method: (batch as any).data?.shipping_method,
          address: c.address_snapshot,
          pallet_no: (pallet as any).data?.pallet_no,
          batch_no: (batch as any).data?.batch_no,
          payment_status: payment,
          counts: { waybills: wbCount ?? 0 },
        },
      };
    }
    if (data.kind === "pallet") {
      const { data: p } = await supabaseAdmin.from("pallets").select("*").eq("id", data.id).maybeSingle();
      if (!p) throw new Error("Pallet not found");
      const [{ count: cnCount }, { count: wbCount }, payment, batch] = await Promise.all([
        supabaseAdmin.from("cartons").select("*", { count: "exact", head: true }).eq("pallet_id", data.id),
        supabaseAdmin.from("waybills").select("*", { count: "exact", head: true }).eq("pallet_id", data.id),
        aggregatePayment(supabaseAdmin, "pallet", data.id),
        p.batch_id
          ? supabaseAdmin.from("batches").select("batch_no, shipping_method").eq("id", p.batch_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return {
        entityType: "pallet" as const,
        entityNo: p.pallet_no,
        meta: {
          status: p.status,
          created_at: p.created_at,
          weight_kg: p.weight_kg,
          notes: p.notes,
          customer_code: p.customer_code,
          destination_code: p.destination_code,
          shipping_method: (batch as any).data?.shipping_method,
          address: p.address_snapshot,
          batch_no: (batch as any).data?.batch_no,
          payment_status: payment,
          counts: { cartons: cnCount ?? 0, waybills: wbCount ?? 0 },
        },
      };
    }
    // batch
    const { data: b } = await supabaseAdmin.from("batches").select("*").eq("id", data.id).maybeSingle();
    if (!b) throw new Error("Batch not found");
    const [{ count: wbCount }, { count: cnCount }, { count: plCount }, payment] = await Promise.all([
      supabaseAdmin.from("waybills").select("*", { count: "exact", head: true }).eq("assigned_batch_id", data.id),
      supabaseAdmin.from("cartons").select("*", { count: "exact", head: true }).eq("batch_id", data.id),
      supabaseAdmin.from("pallets").select("*", { count: "exact", head: true }).eq("batch_id", data.id),
      aggregatePayment(supabaseAdmin, "batch", data.id),
    ]);
    return {
      entityType: "batch" as const,
      entityNo: b.batch_no,
      meta: {
        status: b.status,
        created_at: b.created_at,
        notes: b.notes,
        shipping_method: b.shipping_method,
        planned_ship_date: b.planned_ship_date,
        eta_date: b.eta_date,
        vessel_no: b.vessel_no,
        cargo_type: b.cargo_type,
        destination_code: b.destination_code,
        weight_kg: b.total_weight_kg,
        volume_m3: b.total_volume_cm3 != null ? +(b.total_volume_cm3 / 1e6).toFixed(3) : null,
        payment_status: payment,
        counts: { waybills: wbCount ?? 0, cartons: cnCount ?? 0, pallets: plCount ?? 0 },
      },
    };
  });
