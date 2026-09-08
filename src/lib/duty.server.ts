// 关税计算 · 统一入口
// - 全部按 HS 编码逐项税率计算 (mfn + gst + anti_dumping + surtax 附加税 + excise 消费税)
// - customs_rules.rate_pct 已弃用；只用 customs_rules.enabled 决定该线路是否征税
// - 匹配优先级: forwarding_items.hs_code (manual) → name_zh/name_en 精确 → aliases 精确 → 包含
// - 声明价 = unit_price_cad × 每张运单的数量
//   数量 = extras.items_per_carton (手工填) || quantity / box_count
// - 供 computeWaybillFeesCad / computeAndPersistWaybillFees / computeBatchFeeSummary 共同使用

export type HsMatchSource = "manual" | "name" | "alias" | "fuzzy" | "none";

export type DutyItemRow = {
  forwarding_item_id: string | null;
  name: string;
  hs_code: string | null;
  hs_matched: HsMatchSource;
  box_count: number;
  quantity_total: number; // forwarding 层面总数量
  quantity_per_waybill: number;
  quantity_display: string; // 分数展示 (10/3)
  quantity_fraction: { numerator: number; denominator: number };
  quantity_source: "items_per_carton" | "quantity/box_count" | "quantity";
  unit_price_cad: number;
  declared_value_cad: number;
  mfn_rate: number;
  gst_rate: number;
  anti_dumping_rate: number;
  surtax_rate: number; // 附加税（如中国钢铝/电动车加征）
  excise_rate: number; // 消费税（酒/烟/燃油等）
  tax_rate: number;
  duty_cad: number;
  duty_applied: boolean; // customs_rules.enabled && 达到免税额
  mfn_text: string | null; // 复合税率原文（如 2.5¢/kg + 5%）
  parent_description: string | null;
  requires_permit: boolean;
  import_control: string[];
  is_hazmat: boolean;
  contains_battery: boolean;
};

export type DutyAlert = { name: string; hs_code: string | null; reasons: string[] };

export type DutyBreakdown = {
  items: DutyItemRow[];
  declared_cad: number;
  duty_cad: number;
  customs_enabled: boolean;
  threshold_cad: number;
  unmatched_names: string[];
  alerts: DutyAlert[]; // 需许可 / 危险品 / 含电池 / 复合税率需人工复核
  route_id: string | null;
};

// 一条 HS 记录 → 该品名的合规提示
export function hsAlertReasons(hs: {
  requires_permit?: boolean | null;
  import_control?: string[] | null;
  is_hazmat?: boolean | null;
  contains_battery?: boolean | null;
  mfn_text?: string | null;
  mfn_rate?: number | null;
}): string[] {
  const out: string[] = [];
  if (hs.requires_permit) out.push("需进口许可/OGD 审批");
  for (const c of hs.import_control ?? []) out.push(`管制：${c}`);
  if (hs.is_hazmat) out.push("危险品");
  if (hs.contains_battery) out.push("含电池");
  const t = (hs.mfn_text ?? "").trim();
  if (t && !/^free$/i.test(t) && /[¢$]|per |\/kg|but not less/i.test(t)) out.push(`复合税率需人工核算：${t}`);
  return out;
}

const EMPTY_HS_META = {
  mfn_text: null as string | null,
  parent_description: null as string | null,
  requires_permit: false,
  import_control: [] as string[],
  is_hazmat: false,
  contains_battery: false,
};


function toFraction(x: number): {
  value: number;
  display: string;
  numerator: number;
  denominator: number;
} {
  const value = +Number(x || 0).toFixed(6);
  if (Number.isInteger(value)) return { value, display: String(value), numerator: value, denominator: 1 };
  const denom = 12; // 常见箱数（1..12）足以覆盖分箱情形
  let bestN = 1,
    bestD = 1,
    bestErr = Infinity;
  for (let d = 1; d <= denom; d++) {
    const n = Math.round(value * d);
    const err = Math.abs(value - n / d);
    if (err < bestErr) {
      bestErr = err;
      bestN = n;
      bestD = d;
    }
  }
  // reduce
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const g = gcd(Math.abs(bestN), bestD);
  const n = bestN / g,
    d = bestD / g;
  return { value, display: d === 1 ? String(n) : `${n}/${d}`, numerator: n, denominator: d };
}

type HsRow = {
  hs_code: string;
  name_zh: string | null;
  name_en: string | null;
  aliases: string[] | null;
  mfn_rate: number | null;
  gst_rate: number | null;
  anti_dumping_rate: number | null;
  surtax_rate?: number | null;
  excise_rate?: number | null;
  mfn_text?: string | null;
  parent_description?: string | null;
  requires_permit?: boolean | null;
  import_control?: string[] | null;
  is_hazmat?: boolean | null;
  contains_battery?: boolean | null;
};

// 所有关税计算读取的 HS 字段（各调用点保持一致）
export const HS_SELECT =
  "hs_code, name_zh, name_en, aliases, mfn_rate, gst_rate, anti_dumping_rate, surtax_rate, excise_rate, mfn_text, parent_description, requires_permit, import_control, is_hazmat, contains_battery";


export function buildHsIndex(rows: HsRow[]) {
  const byCode = new Map<string, HsRow>();
  const byExact = new Map<string, HsRow>(); // name_zh / name_en / alias 精确 (lower)
  const byContains: HsRow[] = [];
  for (const h of rows ?? []) {
    if (!h?.hs_code) continue;
    byCode.set(h.hs_code, h);
    const push = (s?: string | null) => {
      if (s) byExact.set(String(s).trim().toLowerCase(), h);
    };
    push(h.name_zh);
    push(h.name_en);
    for (const a of h.aliases ?? []) push(a);
    byContains.push(h);
  }
  return { byCode, byExact, byContains };
}

export function matchHsForName(
  name: string,
  index: ReturnType<typeof buildHsIndex>,
  explicitCode?: string | null,
): { hs: HsRow | null; matched: HsMatchSource } {
  if (explicitCode) {
    const h = index.byCode.get(explicitCode);
    if (h) return { hs: h, matched: "manual" };
  }
  const s = (name ?? "").trim().toLowerCase();
  if (!s) return { hs: null, matched: "none" };
  const exact = index.byExact.get(s);
  if (exact) {
    // 判定来源：精确命中 name_zh/name_en 视为 name，否则 alias
    const nm = (exact.name_zh ?? "").toLowerCase() === s || (exact.name_en ?? "").toLowerCase() === s;
    return { hs: exact, matched: nm ? "name" : "alias" };
  }
  // 包含匹配
  const fuzzy = index.byContains.find(
    (h) =>
      (h.name_zh ?? "").toLowerCase().includes(s) ||
      (h.name_en ?? "").toLowerCase().includes(s) ||
      s.includes((h.name_zh ?? "").toLowerCase() || "\0") ||
      s.includes((h.name_en ?? "").toLowerCase() || "\0"),
  );
  if (fuzzy) return { hs: fuzzy, matched: "fuzzy" };
  return { hs: null, matched: "none" };
}

// 主入口：计算一条运单的关税明细
export async function computeWaybillDutyBreakdown(admin: any, wb: any): Promise<DutyBreakdown> {
  const empty: DutyBreakdown = {
    items: [],
    declared_cad: 0,
    duty_cad: 0,
    customs_enabled: false,
    threshold_cad: 0,
    unmatched_names: [],
    alerts: [],
    route_id: null,
  };
  if (!wb?.forwarding_id) return empty;

  const [{ data: fo }, { data: fi }, { data: hs }] = await Promise.all([
    admin.from("forwarding_orders").select("id, box_count, route_id").eq("id", wb.forwarding_id).maybeSingle(),
    admin
      .from("forwarding_items")
      .select("id, name, quantity, unit_price_cad, unit_price_cny, extras, hs_code")
      .eq("forwarding_id", wb.forwarding_id),
    admin.from("hs_codes").select(HS_SELECT),
  ]);
  const route_id = fo?.route_id ?? null;
  const boxCount = Math.max(Number(fo?.box_count ?? 1) || 1, 1);
  const index = buildHsIndex((hs ?? []) as HsRow[]);


  // customs_rules —— 只读 enabled + threshold_cad；rate_pct 已废弃
  let customs_enabled = false,
    threshold_cad = 0;
  if (route_id) {
    const { data: cr } = await admin
      .from("customs_rules")
      .select("enabled, threshold_cad")
      .eq("route_id", route_id)
      .maybeSingle();
    customs_enabled = !!cr?.enabled;
    threshold_cad = Number(cr?.threshold_cad ?? 0);
  }

  // fx 兜底（unit_price_cad 缺失时用 unit_price_cny 折算）
  let fx = 0.19;
  try {
    const { data: s } = await admin.from("app_settings").select("value").eq("key", "fx_rate").maybeSingle();
    const cnyPerCad = Number((s?.value as any)?.cny_per_cad ?? 0);
    if (cnyPerCad > 0) fx = +(1 / cnyPerCad).toFixed(6);
  } catch {
    // fall back to the 0.19 default set above
  }

  // 若 items_summary 有指定 name，只算这些；否则全部按 box 均摊
  const summary: any[] = Array.isArray(wb.items_summary) ? wb.items_summary : [];
  const summaryByName = new Map<string, number>(); // name → 该运单数量
  for (const it of summary) {
    if (it?.name) summaryByName.set(String(it.name), Number(it.quantity ?? 0));
  }

  const items: DutyItemRow[] = [];
  const unmatched = new Set<string>();
  const alerts: DutyAlert[] = [];
  let declared_total = 0;

  for (const it of (fi ?? []) as any[]) {
    const explicitInner = Number(it?.extras?.items_per_carton ?? 0);
    const totalQty = Number(it.quantity ?? 0);
    let rawPerWb: number;
    let source: DutyItemRow["quantity_source"];
    if (summaryByName.has(it.name)) {
      rawPerWb = Number(summaryByName.get(it.name) || 0);
      source = "quantity";
    } else if (explicitInner > 0) {
      rawPerWb = explicitInner;
      source = "items_per_carton";
    } else {
      rawPerWb = boxCount > 0 ? totalQty / boxCount : totalQty;
      source = boxCount > 1 ? "quantity/box_count" : "quantity";
    }
    const qtyFrac = toFraction(rawPerWb);
    let unit = Number(it.unit_price_cad ?? 0);
    if (!(unit > 0) && Number(it.unit_price_cny ?? 0) > 0) unit = Number(it.unit_price_cny) * fx;
    const declared = +(unit * qtyFrac.value).toFixed(2);
    declared_total += declared;

    const { hs: hsRow, matched } = matchHsForName(it.name ?? "", index, it.hs_code ?? null);
    if (!hsRow) unmatched.add(it.name ?? "(未命名)");
    const mfn = Number(hsRow?.mfn_rate ?? 0);
    const gst = Number(hsRow?.gst_rate ?? 0);
    const ad = Number(hsRow?.anti_dumping_rate ?? 0);
    const surtax = Number(hsRow?.surtax_rate ?? 0);
    const excise = Number(hsRow?.excise_rate ?? 0);
    const rate = mfn + gst + ad + surtax + excise;
    if (hsRow) {
      const reasons = hsAlertReasons(hsRow);
      if (reasons.length) alerts.push({ name: it.name ?? "", hs_code: hsRow.hs_code, reasons });
    }

    items.push({
      forwarding_item_id: it.id,
      name: it.name ?? "",
      hs_code: hsRow?.hs_code ?? null,
      hs_matched: hsRow ? matched : "none",
      box_count: boxCount,
      quantity_total: totalQty,
      quantity_per_waybill: qtyFrac.value,
      quantity_display: qtyFrac.display,
      quantity_fraction: { numerator: qtyFrac.numerator, denominator: qtyFrac.denominator },
      quantity_source: source,
      unit_price_cad: +unit.toFixed(2),
      declared_value_cad: declared,
      mfn_rate: mfn,
      gst_rate: gst,
      anti_dumping_rate: ad,
      surtax_rate: surtax,
      excise_rate: excise,
      tax_rate: rate,
      duty_cad: 0, // 下面按线路开关统一置位
      duty_applied: false,
      mfn_text: hsRow?.mfn_text ?? null,
      parent_description: hsRow?.parent_description ?? null,
      requires_permit: !!hsRow?.requires_permit,
      import_control: hsRow?.import_control ?? [],
      is_hazmat: !!hsRow?.is_hazmat,
      contains_battery: !!hsRow?.contains_battery,
    });
  }


  const applies = customs_enabled && declared_total >= threshold_cad;
  let duty_total = 0;
  for (const row of items) {
    if (applies) {
      row.duty_cad = +(row.declared_value_cad * row.tax_rate).toFixed(2);
      row.duty_applied = true;
      duty_total += row.duty_cad;
    }
  }

  return {
    items,
    declared_cad: +declared_total.toFixed(2),
    duty_cad: +duty_total.toFixed(2),
    customs_enabled,
    threshold_cad,
    unmatched_names: [...unmatched],
    alerts,
    route_id,

  };
}

// Same shape, for a shop-order (order_id) waybill instead of a forwarding
// one. There's no HS-code matching here — order_items ship with a known
// product, and each product carries its own customs_mfn_rate/
// customs_gst_rate/customs_antidumping_rate straight from checkout, set in
// 电商管理 → 商品管理. order_items.waybill_id already scopes items to this
// exact waybill (no box-splitting fractions needed, unlike forwarding).
export async function computeOrderWaybillDutyBreakdown(admin: any, wb: any): Promise<DutyBreakdown> {
  const empty: DutyBreakdown = {
    items: [],
    declared_cad: 0,
    duty_cad: 0,
    customs_enabled: false,
    threshold_cad: 0,
    unmatched_names: [],
    alerts: [],
    route_id: null,
  };

  if (!wb?.order_id) return empty;

  const { data: ord } = await admin.from("orders").select("id, route_id").eq("id", wb.order_id).maybeSingle();
  const route_id = ord?.route_id ?? null;

  let items: any[] = [];
  {
    const { data } = await admin
      .from("order_items")
      .select("id, name_zh, name_en, subtotal_cny, quantity, product_id")
      .eq("waybill_id", wb.id);
    items = data ?? [];
  }
  if (items.length === 0) {
    const { data } = await admin
      .from("order_items")
      .select("id, name_zh, name_en, subtotal_cny, quantity, product_id")
      .eq("order_id", wb.order_id);
    items = data ?? [];
  }

  const productIds = Array.from(new Set(items.map((it) => it.product_id).filter(Boolean)));
  let products: any[] = [];
  if (productIds.length) {
    const { data } = await admin
      .from("products")
      .select("id, hs_code, customs_mfn_rate, customs_gst_rate, customs_antidumping_rate")
      .in("id", productIds);
    products = data ?? [];
  }
  const productMap = new Map(products.map((p: any) => [p.id, p]));

  // 商品绑定的 HS 编码 → 附加税/消费税/管制标识（商品自带的 mfn/gst/反倾销保持优先）
  const hsCodesNeeded = Array.from(new Set(products.map((p: any) => p.hs_code).filter(Boolean)));
  const hsMetaMap = new Map<string, HsRow>();
  if (hsCodesNeeded.length) {
    const { data: hsRows } = await admin.from("hs_codes").select(HS_SELECT).in("hs_code", hsCodesNeeded);
    for (const h of (hsRows ?? []) as HsRow[]) hsMetaMap.set(h.hs_code, h);
  }


  let fx = 0.19;
  try {
    const { data: s } = await admin.from("app_settings").select("value").eq("key", "fx_rate").maybeSingle();
    const cnyPerCad = Number((s?.value as any)?.cny_per_cad ?? 0);
    if (cnyPerCad > 0) fx = +(1 / cnyPerCad).toFixed(6);
  } catch {
    // fall back to the 0.19 default set above
  }

  let customs_enabled = false,
    threshold_cad = 0;
  if (route_id) {
    const { data: cr } = await admin
      .from("customs_rules")
      .select("enabled, threshold_cad")
      .eq("route_id", route_id)
      .maybeSingle();
    customs_enabled = !!cr?.enabled;
    threshold_cad = Number(cr?.threshold_cad ?? 0);
  }

  const rows: DutyItemRow[] = [];
  const alerts: DutyAlert[] = [];
  let declared_total = 0;
  for (const it of items) {
    const qty = Number(it.quantity ?? 1) || 1;
    const valueCad = +(Number(it.subtotal_cny ?? 0) * fx).toFixed(2);
    declared_total += valueCad;
    const prod = it.product_id ? productMap.get(it.product_id) : null;
    const hsMeta = prod?.hs_code ? hsMetaMap.get(prod.hs_code) : undefined;
    const mfn = Number(prod?.customs_mfn_rate ?? hsMeta?.mfn_rate ?? 0);
    const gst = Number(prod?.customs_gst_rate ?? hsMeta?.gst_rate ?? 0);
    const ad = Number(prod?.customs_antidumping_rate ?? hsMeta?.anti_dumping_rate ?? 0);
    const surtax = Number(hsMeta?.surtax_rate ?? 0);
    const excise = Number(hsMeta?.excise_rate ?? 0);
    const name = it.name_zh || it.name_en || "—";
    if (hsMeta) {
      const reasons = hsAlertReasons(hsMeta);
      if (reasons.length) alerts.push({ name, hs_code: hsMeta.hs_code, reasons });
    }
    rows.push({
      forwarding_item_id: null,
      name,
      hs_code: hsMeta?.hs_code ?? prod?.hs_code ?? null,
      hs_matched: hsMeta ? "manual" : "none",
      box_count: 1,
      quantity_total: qty,
      quantity_per_waybill: qty,
      quantity_display: String(qty),
      quantity_fraction: { numerator: qty, denominator: 1 },
      quantity_source: "quantity",
      unit_price_cad: +(valueCad / qty).toFixed(2),
      declared_value_cad: valueCad,
      mfn_rate: mfn,
      gst_rate: gst,
      anti_dumping_rate: ad,
      surtax_rate: surtax,
      excise_rate: excise,
      tax_rate: mfn + gst + ad + surtax + excise,
      duty_cad: 0,
      duty_applied: false,
      mfn_text: hsMeta?.mfn_text ?? EMPTY_HS_META.mfn_text,
      parent_description: hsMeta?.parent_description ?? EMPTY_HS_META.parent_description,
      requires_permit: !!hsMeta?.requires_permit,
      import_control: hsMeta?.import_control ?? [],
      is_hazmat: !!hsMeta?.is_hazmat,
      contains_battery: !!hsMeta?.contains_battery,
    });
  }

  const applies = customs_enabled && declared_total >= threshold_cad;
  let duty_total = 0;
  for (const row of rows) {
    if (applies) {
      row.duty_cad = +(row.declared_value_cad * row.tax_rate).toFixed(2);
      row.duty_applied = true;
      duty_total += row.duty_cad;
    }
  }

  return {
    items: rows,
    declared_cad: +declared_total.toFixed(2),
    duty_cad: +duty_total.toFixed(2),
    customs_enabled,
    threshold_cad,
    unmatched_names: [],
    alerts,
    route_id,
  };

}

// Dispatches to whichever of the two above applies to this waybill.
export async function computeAnyWaybillDutyBreakdown(admin: any, wb: any): Promise<DutyBreakdown> {
  if (wb?.forwarding_id) return computeWaybillDutyBreakdown(admin, wb);
  if (wb?.order_id) return computeOrderWaybillDutyBreakdown(admin, wb);
  return {
    items: [],
    declared_cad: 0,
    duty_cad: 0,
    customs_enabled: false,
    threshold_cad: 0,
    unmatched_names: [],
    alerts: [],
    route_id: null,

  };
}

// Chargeable weight + the CAD/kg rate that produced it — for either waybill
// type. Computed fresh from the waybill's own weight/dimensions and the
// route's current freight_rules row (display-only, for the invoice's 运费
// table — it doesn't feed back into what the customer is actually charged,
// that's waybills.freight_cad, fetched separately in buildInvoiceLineMeta).
export async function computeWaybillFreightMeta(
  admin: any,
  wb: any,
): Promise<{ chargeable_weight_kg: number; rate_cad_per_kg: number } | null> {
  let route_id: string | null = null;
  if (wb.forwarding_id) {
    const { data: fo } = await admin
      .from("forwarding_orders")
      .select("route_id")
      .eq("id", wb.forwarding_id)
      .maybeSingle();
    route_id = fo?.route_id ?? null;
  } else if (wb.order_id) {
    const { data: ord } = await admin.from("orders").select("route_id").eq("id", wb.order_id).maybeSingle();
    route_id = ord?.route_id ?? null;
  }
  if (!route_id) return null;

  const { data: rule } = await admin
    .from("freight_rules")
    .select("*")
    .eq("route_id", route_id)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rule) return null;

  let fx = 0.19;
  try {
    const { data: s } = await admin.from("app_settings").select("value").eq("key", "fx_rate").maybeSingle();
    const cnyPerCad = Number((s?.value as any)?.cny_per_cad ?? 0);
    if (cnyPerCad > 0) fx = +(1 / cnyPerCad).toFixed(6);
  } catch {
    // fall back to the 0.19 default set above
  }

  const w = Number(wb.weight_kg ?? 0);
  const v = Number(wb.length_cm ?? 0) * Number(wb.width_cm ?? 0) * Number(wb.height_cm ?? 0);
  const divisor = Number(rule.volumetric_divisor) || 6000;
  const volW = v / divisor;
  const chargeable = rule.weight_mode === "actual" ? w : rule.weight_mode === "volumetric" ? volW : Math.max(w, volW);
  const rate_cad =
    Number(rule.unit_price_cad) > 0 ? Number(rule.unit_price_cad) : Number(rule.unit_price_cny ?? 0) * fx;
  return { chargeable_weight_kg: +chargeable.toFixed(2), rate_cad_per_kg: +rate_cad.toFixed(4) };
}

export type InvoiceLineMeta = {
  waybill_no: string | null;
  freight: { chargeable_weight_kg: number; rate_cad_per_kg: number; amount_cad: number } | null;
  // 关税 (mfn+anti-dumping) and GST are two rates against the exact same
  // declared value, on the exact same item — merged into one row per item
  // instead of duplicating 物品名称/货值 across two separate tables.
  duty_items: Array<{
    name: string;
    value_cad: number;
    customs_rate_pct: number;
    customs_cad: number;
    gst_rate_pct: number;
    gst_cad: number;
  }>;
};

// Everything InvoiceDocument's 运费/关税·GST tables need for one waybill's
// invoice line — the whole invoice is settled in CAD (see settleBatchForCustomer),
// so this stays in CAD throughout rather than converting through fx: duty_cad
// and declared_value_cad are already CAD-native (computeAnyWaybillDutyBreakdown),
// and freight's `amount_cad` is read straight off waybills.freight_cad — the
// same figure the customer was actually charged, not a recomputed one.
export async function buildInvoiceLineMeta(admin: any, wb: any): Promise<InvoiceLineMeta> {
  const [duty, freightMeta] = await Promise.all([
    computeAnyWaybillDutyBreakdown(admin, wb),
    computeWaybillFreightMeta(admin, wb),
  ]);

  const duty_items = duty.items
    .filter(
      (it) =>
        it.duty_applied &&
        (it.mfn_rate + it.anti_dumping_rate + it.surtax_rate + it.excise_rate > 0 || it.gst_rate > 0),
    )
    .map((it) => {
      // 关税 = MFN + 反倾销 + 附加税(surtax) + 消费税(excise)，GST 单列
      const customsRate = it.mfn_rate + it.anti_dumping_rate + it.surtax_rate + it.excise_rate;
      return {
        name: it.name,
        value_cad: it.declared_value_cad,
        customs_rate_pct: +(customsRate * 100).toFixed(2),
        customs_cad: +(it.declared_value_cad * customsRate).toFixed(2),
        gst_rate_pct: +(it.gst_rate * 100).toFixed(2),
        gst_cad: +(it.declared_value_cad * it.gst_rate).toFixed(2),
      };
    });


  const freight = freightMeta ? { ...freightMeta, amount_cad: +Number(wb.freight_cad ?? 0).toFixed(2) } : null;

  return {
    waybill_no: wb.waybill_no ?? null,
    freight,
    duty_items,
  };
}
