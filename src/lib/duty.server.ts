// 关税计算 · 统一入口
// - 全部按 HS 编码逐项税率计算 (mfn + gst + anti_dumping)
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
  tax_rate: number;
  duty_cad: number;
  duty_applied: boolean; // customs_rules.enabled && 达到免税额
};

export type DutyBreakdown = {
  items: DutyItemRow[];
  declared_cad: number;
  duty_cad: number;
  customs_enabled: boolean;
  threshold_cad: number;
  unmatched_names: string[];
  route_id: string | null;
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
};

// PostgREST 单次请求默认最多返回 max-rows 条（这个项目上是 1000）——裸 select 不分页的话，
// hs_codes 一旦超过这个数，后面的编码在报关自动匹配里会被静默漏掉（不报错，只是那些品名
// 匹配不上、少算/漏算关税）。全量匹配场景一律走这个分页拉全表，而不是不限量的裸 select。
export async function loadAllHsCodes(admin: any, cols: string, opts?: { activeOnly?: boolean }): Promise<any[]> {
  const pageSize = 1000;
  const out: any[] = [];
  for (let from = 0; ; from += pageSize) {
    let q = admin
      .from("hs_codes")
      .select(cols)
      .order("hs_code", { ascending: true })
      .range(from, from + pageSize - 1);
    if (opts?.activeOnly) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

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
export type DutyInputs = { fo: any; fi: any[]; hs: any[]; customs: any; fx: number };

export async function computeWaybillDutyBreakdown(admin: any, wb: any, loaded?: DutyInputs): Promise<DutyBreakdown> {
  const empty: DutyBreakdown = {
    items: [],
    declared_cad: 0,
    duty_cad: 0,
    customs_enabled: false,
    threshold_cad: 0,
    unmatched_names: [],
    route_id: null,
  };
  if (!wb?.forwarding_id) return empty;

  const [{ data: fo }, { data: fi }, hs] = loaded
    ? [{ data: loaded.fo }, { data: loaded.fi }, loaded.hs]
    : await Promise.all([
    admin.from("forwarding_orders").select("id, box_count, route_id").eq("id", wb.forwarding_id).maybeSingle(),
    admin
      .from("forwarding_items")
      .select("id, name, quantity, unit_price_cad, unit_price_cny, extras, hs_code")
      .eq("forwarding_id", wb.forwarding_id),
    loadAllHsCodes(admin, "hs_code, name_zh, name_en, aliases, mfn_rate, gst_rate, anti_dumping_rate"),
  ]);
  const route_id = fo?.route_id ?? null;
  const boxCount = Math.max(Number(fo?.box_count ?? 1) || 1, 1);
  const index = buildHsIndex((hs ?? []) as HsRow[]);

  // customs_rules —— 只读 enabled + threshold_cad；rate_pct 已废弃
  let customs_enabled = false,
    threshold_cad = 0;
  if (loaded) {
    customs_enabled = !!loaded.customs?.enabled;
    threshold_cad = Number(loaded.customs?.threshold_cad ?? 0);
  } else if (route_id) {
    const { data: cr } = await admin
      .from("customs_rules")
      .select("enabled, threshold_cad")
      .eq("route_id", route_id)
      .maybeSingle();
    customs_enabled = !!cr?.enabled;
    threshold_cad = Number(cr?.threshold_cad ?? 0);
  }

  // fx 兜底（unit_price_cad 缺失时用 unit_price_cny 折算）
  let fx = loaded?.fx ?? 0.19;
  if (!loaded) try {
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
  let declared_total = 0;

  for (const it of (fi ?? []) as any[]) {
    const explicitInner = Number(it?.extras?.items_per_carton ?? it?.extras?.inner_qty ?? 0);
    const itemBoxes = Number(it?.extras?.box_count ?? 0);
    const totalQty = Number(it.quantity ?? 0);
    let rawPerWb: number;
    let source: DutyItemRow["quantity_source"];
    // An item's own split annotation (customer-declared: this item spans N of
    // its own boxes) always wins — items_summary is copied verbatim onto every
    // waybill of the order, so treating its raw quantity as "this waybill's
    // share" would count the item's full value on each box it touches.
    if (explicitInner > 0) {
      rawPerWb = explicitInner;
      source = "items_per_carton";
    } else if (itemBoxes > 1) {
      rawPerWb = totalQty / itemBoxes;
      source = "quantity/box_count";
    } else if (summaryByName.has(it.name)) {
      rawPerWb = Number(summaryByName.get(it.name) || 0);
      source = "quantity";
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
    const rate = mfn + gst + ad;

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
      tax_rate: rate,
      duty_cad: 0, // 下面按线路开关统一置位
      duty_applied: false,
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
      .select("id, customs_mfn_rate, customs_gst_rate, customs_antidumping_rate")
      .in("id", productIds);
    products = data ?? [];
  }
  const productMap = new Map(products.map((p: any) => [p.id, p]));

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
  let declared_total = 0;
  for (const it of items) {
    const qty = Number(it.quantity ?? 1) || 1;
    const valueCad = +(Number(it.subtotal_cny ?? 0) * fx).toFixed(2);
    declared_total += valueCad;
    const prod = it.product_id ? productMap.get(it.product_id) : null;
    const mfn = Number(prod?.customs_mfn_rate ?? 0);
    const gst = Number(prod?.customs_gst_rate ?? 0);
    const ad = Number(prod?.customs_antidumping_rate ?? 0);
    rows.push({
      forwarding_item_id: null,
      name: it.name_zh || it.name_en || "—",
      hs_code: null,
      hs_matched: "none",
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
      tax_rate: mfn + gst + ad,
      duty_cad: 0,
      duty_applied: false,
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
    route_id,
  };
}

// ============================================================
// Phase 1 · 把一条运单的关税明细持久化到 waybill_items
// ============================================================
// - 复用 computeAnyWaybillDutyBreakdown（已验证的拆分 + HS 匹配 + 关税逻辑）
// - waybill_items 按 waybill_id delete-then-insert（幂等）
// - 汇总 duty_cad 回写 waybills.duty_cad
// - 匹配到的 hs_code / 税率 / hs_confirmed 回写父 forwarding_items 行
// 在运单被创建 / 改尺寸 / 改物品 / HS 变动时调用（见 Phase 1 触发点）。
export async function persistWaybillItems(
  admin: any,
  wbOrId: any,
): Promise<{ items: number; duty_cad: number }> {
  let row = wbOrId;
  if (typeof wbOrId === "string" || !wbOrId?.id) {
    const id = typeof wbOrId === "string" ? wbOrId : wbOrId?.id;
    if (!id) return { items: 0, duty_cad: 0 };
    const { data } = await admin
      .from("waybills")
      .select("id, waybill_no, forwarding_id, order_id, items_summary, weight_kg, length_cm, width_cm, height_cm")
      .eq("id", id)
      .maybeSingle();
    if (!data) return { items: 0, duty_cad: 0 };
    row = data;
  }

  const br = await computeAnyWaybillDutyBreakdown(admin, row);

  const rows = br.items.map((it) => ({
    waybill_id: row.id,
    forwarding_item_id: it.forwarding_item_id ?? null,
    order_item_id: null as string | null, // 电商侧 order_item 关联在 Phase 2 补
    name: it.name ?? "",
    hs_code: it.hs_code ?? null,
    hs_matched: it.hs_matched ?? "none",
    hs_confirmed: it.hs_matched === "manual",
    quantity: it.quantity_per_waybill ?? 0,
    unit_price_cad: it.unit_price_cad ?? null,
    declared_value_cad: it.declared_value_cad ?? null,
    mfn_rate: it.mfn_rate ?? null,
    gst_rate: it.gst_rate ?? null,
    anti_dumping_rate: it.anti_dumping_rate ?? null,
    tax_rate: it.tax_rate ?? null,
    duty_cad: it.duty_cad ?? null,
    duty_applied: !!it.duty_applied,
  }));

  await admin.from("waybill_items").delete().eq("waybill_id", row.id);
  if (rows.length) {
    const { error } = await admin.from("waybill_items").insert(rows);
    if (error) throw new Error(error.message);
  }

  const dutyTotal = +Number(br.duty_cad ?? 0).toFixed(2);
  await admin.from("waybills").update({ duty_cad: dutyTotal }).eq("id", row.id);

  // 回写父 forwarding_items（HS 匹配是逐品名的，与运单拆分无关）
  for (const it of br.items) {
    if (!it.forwarding_item_id) continue;
    await admin
      .from("forwarding_items")
      .update({
        hs_code: it.hs_code ?? null,
        hs_matched: it.hs_matched ?? "none",
        hs_confirmed: it.hs_matched === "manual",
        mfn_rate: it.mfn_rate ?? null,
        gst_rate: it.gst_rate ?? null,
        anti_dumping_rate: it.anti_dumping_rate ?? null,
      })
      .eq("id", it.forwarding_item_id);
  }

  return { items: rows.length, duty_cad: dutyTotal };
}

// 批量：一个集运单 / 电商订单下的所有运单
export async function persistWaybillItemsForParent(
  admin: any,
  parent: { forwarding_id?: string | null; order_id?: string | null },
): Promise<number> {
  let q = admin
    .from("waybills")
    .select("id, waybill_no, forwarding_id, order_id, items_summary, weight_kg, length_cm, width_cm, height_cm");
  if (parent.forwarding_id) q = q.eq("forwarding_id", parent.forwarding_id);
  else if (parent.order_id) q = q.eq("order_id", parent.order_id);
  else return 0;
  const { data: wbs } = await q;
  let n = 0;
  for (const wb of (wbs ?? []) as any[]) {
    try {
      await persistWaybillItems(admin, wb);
      n++;
    } catch (e) {
      console.error("persistWaybillItems failed for waybill", wb.id, e);
    }
  }
  return n;
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
    .filter((it) => it.duty_applied && (it.mfn_rate + it.anti_dumping_rate > 0 || it.gst_rate > 0))
    .map((it) => {
      const customsRate = it.mfn_rate + it.anti_dumping_rate;
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
