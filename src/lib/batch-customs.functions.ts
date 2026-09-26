import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAllHsCodes, computeWaybillDutyBreakdown, buildHsIndex } from "@/lib/duty.server";
import { selectByIds } from "@/lib/orders.functions";
import { isCompleteHsCode, normalizeHsCodeForStorage, hsCodeDigitsOnly } from "@/lib/hs-code-format";
import { z } from "zod";
import { recordAdminLog } from "@/lib/admin-log";

const partyText = z.string().trim().max(1000);
const partyInput = z.object({
  batchId: z.string().uuid(),
  party: z.enum(["customs_shipper", "customs_consignee"]),
  values: z.object({
    name: partyText, contact_name: partyText, phone: partyText,
    email: partyText.refine((s) => !s || z.string().email().safeParse(s).success, "邮箱格式不正确"),
    address: partyText, country: partyText, tax_id: partyText,
  }),
});

export const saveBatchCustomsParty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string; party: "customs_shipper" | "customs_consignee"; values: Record<string, string> }) => partyInput.parse(d))
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: batch, error } = await supabaseAdmin.from("batches")
      .select("customs_shipper,customs_consignee").eq("id", data.batchId).single();
    if (error || !batch) throw new Error(error?.message ?? "批次不存在");
    const before = batch[data.party];
    const after = { ...(before && typeof before === "object" && !Array.isArray(before) ? before : {}), ...data.values };
    const patch = data.party === "customs_shipper" ? { customs_shipper: after } : { customs_consignee: after };
    const { error: saveError } = await supabaseAdmin.from("batches")
      .update(patch).eq("id", data.batchId).select("id").single();
    if (saveError) throw new Error(saveError.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "batch", entity_id: data.batchId, action: "update_customs_party",
      before: { [data.party]: before }, after: { [data.party]: after }, operator_id: context.userId,
    });
    return { success: true };
  });

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

async function assertManager(supabase: any, userId: string) {
  const [{ data: owner }, { data: manager }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "manager" }),
  ]);
  if (!owner && !manager) throw new Error("Forbidden: owner/manager only");
}

function outputText(body: any): string {
  if (typeof body?.output_text === "string") return body.output_text;
  for (const out of body?.output ?? []) {
    for (const c of out?.content ?? []) if (typeof c?.text === "string") return c.text;
  }
  return "";
}

function parseJson(raw: string): any {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI 未返回有效 JSON");
  return JSON.parse(match[0]);
}

// A large batch's pallet/carton/waybill/order id lists can run into the
// hundreds. Every lookup here used a single unchunked .in() over all of
// them, serializing into a query string long enough that Supabase's edge in
// front of PostgREST rejects it with a bare "Bad Request" — no JSON body, so
// it fails silently as far as the caller's `.data` is concerned on some
// paths, which is how a large batch could show "HS Code 已齐全" while most
// of its items had never actually been looked at. selectByIds() (shared with
// orders.functions.ts's computeBatchFeeSummary) pages every one of these.
async function batchWaybills(admin: any, batchId: string) {
  const [{ data: pallets }, { data: directCartons }] = await Promise.all([
    admin.from("pallets").select("id").eq("batch_id", batchId),
    admin.from("cartons").select("id").eq("batch_id", batchId),
  ]);
  const palletIds = (pallets ?? []).map((p: any) => p.id);
  const nestedCartons = await selectByIds(admin, "cartons", "id", "pallet_id", palletIds);
  const cartonIds = Array.from(new Set([...(directCartons ?? []), ...nestedCartons].map((c: any) => c.id)));
  const { data: direct, error } = await admin.from("waybills").select("*").eq("assigned_batch_id", batchId);
  if (error) throw new Error(error.message);
  const [viaPallet, viaCarton] = await Promise.all([
    selectByIds(admin, "waybills", "*", "pallet_id", palletIds),
    selectByIds(admin, "waybills", "*", "carton_id", cartonIds),
  ]);
  return Array.from(new Map([...(direct ?? []), ...viaPallet, ...viaCarton].map((w: any) => [w.id, w])).values()) as any[];
}

// Item rows only — no hs_codes library lookup. Used by the readiness check,
// which per the HS-code architecture only reads each item's own stored
// hs_code and never re-matches against the library at batch time.
async function loadCustomsItemRows(admin: any, batchId: string) {
  const waybills = await batchWaybills(admin, batchId);
  const forwardingIds = Array.from(new Set(waybills.map((w) => w.forwarding_id).filter(Boolean)));
  const orderIds = Array.from(new Set(waybills.map((w) => w.order_id).filter(Boolean)));
  const [forwardingItems, orderItems] = await Promise.all([
    selectByIds(admin, "forwarding_items", "*", "forwarding_id", forwardingIds),
    selectByIds(admin, "order_items", "*", "order_id", orderIds),
  ]);
  return { waybills, forwardingIds, orderIds, forwardingItems, orderItems };
}

// Adds forwarding_orders/orders (for customer_code/box_count) and the full
// HS library — needed by autoMatchBatchHsCodes (the one place matching
// still happens) and getBatchInvoiceExport (display name/material/origin
// lookup by an already-resolved code, not matching).
async function loadCustomsItems(admin: any, batchId: string) {
  const { waybills, forwardingIds, orderIds, forwardingItems, orderItems } = await loadCustomsItemRows(admin, batchId);
  const [forwardingOrders, orders, hsRows] = await Promise.all([
    selectByIds(admin, "forwarding_orders", "id,customer_code,box_count", "id", forwardingIds),
    selectByIds(admin, "orders", "id,customer_code,box_count,fx_rate", "id", orderIds),
    loadAllHsCodes(admin, "hs_code,name_zh,name_en,aliases,material,origin,unit,is_active", { activeOnly: true }),
  ]);
  return { waybills, forwardingOrders, forwardingItems, orders, orderItems, hsRows };
}

function normalizeHs(v: unknown) {
  return String(v ?? "").replace(/\D/g, "");
}

function attrs(item: any) {
  return item?.extras ?? item?.attrs_snapshot ?? {};
}

function localMatch(name: string, hsRows: any[]) {
  const q = name.trim().toLowerCase();
  if (!q) return null;
  const exact = hsRows.find((h) =>
    [h.name_zh, h.name_en, ...(Array.isArray(h.aliases) ? h.aliases : [])]
      .filter(Boolean)
      .some((x) => String(x).trim().toLowerCase() === q),
  );
  if (exact) return { row: exact, source: "local_exact" };
  const fuzzy = hsRows.find((h) =>
    [h.name_zh, h.name_en, ...(Array.isArray(h.aliases) ? h.aliases : [])]
      .filter(Boolean)
      .some((x) => {
        const v = String(x).trim().toLowerCase();
        return v.length >= 3 && (v.includes(q) || q.includes(v));
      }),
  );
  return fuzzy ? { row: fuzzy, source: "local_fuzzy" } : null;
}

// Reads each item's own stored hs_code only — no hs_codes library query.
// Per the HS-code architecture: matching happens once, at autoMatchBatchHsCodes
// (or customer/staff entry), and is persisted there; every batch-level
// consumer after that just trusts what's on the row.
export const getBatchCustomsReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { forwardingItems, orderItems } = await loadCustomsItemRows(supabaseAdmin, data.batchId);
    const fwdMissing = forwardingItems.filter((i: any) => !isCompleteHsCode(i.hs_code));
    const orderMissing = orderItems.filter((i: any) => !isCompleteHsCode(attrs(i).hs_code));
    return {
      item_count: forwardingItems.length + orderItems.length,
      missing_count: fwdMissing.length + orderMissing.length,
      missing_names: [...fwdMissing, ...orderMissing].map((i: any) => i.name ?? i.name_zh ?? "未命名").slice(0, 20),
    };
  });

export const autoMatchBatchHsCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const loaded = await loadCustomsItems(supabaseAdmin, data.batchId);
    const codeMap = new Map(loaded.hsRows.map((h: any) => [normalizeHs(h.hs_code), h]));
    // Already has a complete code on the row — trust it, don't re-match.
    const pending = loaded.forwardingItems.filter((i: any) => !isCompleteHsCode(i.hs_code));
    let local = 0;
    let ai = 0;
    let library_errors = 0;
    const unresolved: any[] = [];
    for (const item of pending) {
      const hit = localMatch(String(item.name ?? ""), loaded.hsRows);
      if (hit?.source === "local_exact") {
        // hit.row comes straight from the hs_codes library — normally already
        // valid, but one malformed reference row (hand-edited before this
        // format was enforced) must not take down every other item's match
        // in the same run.
        try {
          const code = normalizeHsCodeForStorage(hit.row.hs_code);
          await supabaseAdmin.from("forwarding_items").update({ hs_code: code }).eq("id", item.id);
          local++;
        } catch {
          library_errors++;
          unresolved.push(item);
        }
      } else unresolved.push(item);
    }
    if (unresolved.length) {
      const { callOpenAiResponses } = await import("@/lib/openai.server");
      const prompt = `你是加拿大报关HS编码匹配助手。为每个商品返回最可能的加拿大10位HS编码。只输出JSON：{"items":[{"id":"...","hs_code":"10位数字","confidence":0到1}]}。没有把握时hs_code为空。商品：${JSON.stringify(
        unresolved.slice(0, 50).map((i: any) => ({ id: i.id, name: i.name, material: attrs(i).material, origin: attrs(i).origin })),
      )}`;
      try {
        const res = await callOpenAiResponses(prompt, { maxOutputTokens: 300, timeoutMs: 20000 });
        const parsed = parseJson(outputText(res.body));
        for (const choice of parsed?.items ?? []) {
          const code = normalizeHs(choice?.hs_code);
          const source = unresolved.find((i: any) => i.id === choice?.id);
          const matchedRow = codeMap.get(code);
          if (!source || Number(choice?.confidence ?? 0) < 0.75 || !matchedRow) continue;
          // Store the library's own canonical (dotted) hs_code, not the AI's
          // raw digit string — keeps every row in the one 0000.00.00.00 shape.
          // Per-item try/catch: one malformed library row must not abort the
          // rest of this AI batch's otherwise-good matches.
          try {
            await supabaseAdmin.from("forwarding_items").update({ hs_code: normalizeHsCodeForStorage(matchedRow.hs_code) }).eq("id", source.id);
            ai++;
          } catch {
            library_errors++;
          }
        }
      } catch {
        // Local matches remain valid; unresolved rows stay untouched for manual review.
      }
    }
    const { forwardingItems: refreshed } = await loadCustomsItemRows(supabaseAdmin, data.batchId);
    const missing = refreshed.filter((i: any) => !isCompleteHsCode(i.hs_code)).length;
    return { local_matched: local, ai_matched: ai, missing_count: missing, library_errors };
  });

export const extractBatchHbl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string; filePath: string; fileName: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: file, error } = await supabaseAdmin.storage.from("batch-documents").download(data.filePath);
    if (error || !file) throw new Error(error?.message ?? "提单下载失败");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = Buffer.from(bytes).toString("base64");
    const { callOpenAiRaw } = await import("@/lib/openai.server");
    const result = await callOpenAiRaw(
      {
        input: [{ role: "user", content: [
          { type: "input_text", text: "读取这份海运/空运提单。只输出JSON，字段：shipper{name,contact_name,phone,email,address,country,tax_id},consignee{name,contact_name,phone,email,address,country,tax_id},ship_date(YYYY-MM-DD或null),vessel_voyage,container_no,total_weight_kg,total_volume_m3,goods_description。shipper为发货方，consignee为收货方，不要用通知方Notify Party替代收货方。双方资料中name为公司名称，contact_name为联系人，phone为电话，email为邮箱，address为完整地址，country为国家/地区，tax_id为税号。只提取提单明确写出的资料，不要猜测或推断；缺失或看不清的字段返回null，各文本字段不超过1000字符。" },
          { type: "input_file", filename: data.fileName, file_data: `data:application/pdf;base64,${base64}` },
        ] }],
        max_output_tokens: 2000,
      },
      { timeoutMs: 30000 },
    );
    if (!result.body) throw new Error("提单识别失败");
    const extracted = parseJson(outputText(result.body));
    const { data: existing, error: readError } = await supabaseAdmin.from("batches")
      .select("customs_shipper,customs_consignee").eq("id", data.batchId).single();
    if (readError || !existing) throw new Error(readError?.message ?? "批次不存在");
    const mergeParty = (saved: any, recognized: any) => ({
      ...(saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {}),
      ...Object.fromEntries(["name", "contact_name", "phone", "email", "address", "country", "tax_id"].flatMap((key) =>
        typeof recognized?.[key] === "string" && recognized[key].trim() ? [[key, recognized[key].trim().slice(0, 1000)]] : [])),
    });
    const patch = {
      hbl_file_path: data.filePath,
      hbl_file_name: data.fileName,
      hbl_extracted: extracted,
      customs_shipper: mergeParty(existing.customs_shipper, extracted.shipper),
      customs_consignee: mergeParty(existing.customs_consignee, extracted.consignee),
      actual_ship_date: extracted.ship_date || null,
      vessel_no: extracted.vessel_voyage || null,
      container_no: extracted.container_no || null,
      hbl_total_weight_kg: Number(extracted.total_weight_kg) || null,
      hbl_total_volume_m3: Number(extracted.total_volume_m3) || null,
      hbl_goods_description: extracted.goods_description || null,
    };
    const { error: updateError } = await supabaseAdmin.from("batches").update(patch).eq("id", data.batchId);
    if (updateError) throw new Error(updateError.message);
    return patch;
  });

// ============================================================
// Invoice / Packing List export — merged-by-HS-code consolidation.
//
// Rules (confirmed with the user across several rounds):
//  - Group each physical unit's items by hs_code's first 6 digits; if more
//    than one group, pick a dominant one: a group already-ahead by ≥2x on
//    volume, weight, quantity or declared value wins outright on the first
//    such metric found; otherwise rank by the fixed priority volume >
//    weight > quantity > value.
//  - Pallets: each pallet is its own candidate (its own contained waybills'
//    items). Pallets whose dominant code matches merge into one line,
//    packages = number of pallets. Weight/volume = the pallet's OWN measured
//    self_weight_kg/self_*_cm (summed across merged pallets), not a rollup
//    of its contents. Pallets never get the oversize override.
//  - Independent waybills and cartons not inside a pallet are pooled
//    together (same treatment for both) and merged by dominant code the
//    same way, packages = count of matching units, weight/volume = sum of
//    each unit's own recorded weight_kg / L×W×H.
//  - Oversize override: a waybill/carton whose own longest side > 200cm, or
//    weight_kg > 200, or volume > 1 CBM must stand on its own line (its
//    dominant code, never merged with others even if they share it) and
//    does not count against the merged-line total.
//  - Quantity on a line = the ACTUAL total quantity of every item in the
//    unit(s) that make up that line (not just the dominant group's).
//  - Unit price = the dominant code's own value-weighted actual unit price
//    × 20%, written into the unit-price column (total = quantity × that).
//  - Item name = the HS library's canonical name for the dominant code.
//
// HS codes are read as-already-resolved (see getBatchCustomsReadiness) —
// nothing here re-matches by name; a unit with no item carrying a complete
// hs_code is skipped and reported back as `unmatched`.
// ============================================================

const OVERSIZE_MAX_SIDE_CM = 200;
const OVERSIZE_MAX_WEIGHT_KG = 200;
const OVERSIZE_MAX_VOLUME_M3 = 1;
const INVOICE_UNIT_PRICE_RATIO = 0.2;

function volumeM3(x: { length_cm?: number | null; width_cm?: number | null; height_cm?: number | null }): number {
  return (Number(x.length_cm ?? 0) * Number(x.width_cm ?? 0) * Number(x.height_cm ?? 0)) / 1_000_000;
}
function isOversize(x: { length_cm?: number | null; width_cm?: number | null; height_cm?: number | null; weight_kg?: number | null }): boolean {
  const maxSide = Math.max(Number(x.length_cm ?? 0), Number(x.width_cm ?? 0), Number(x.height_cm ?? 0));
  return maxSide > OVERSIZE_MAX_SIDE_CM || Number(x.weight_kg ?? 0) > OVERSIZE_MAX_WEIGHT_KG || volumeM3(x) > OVERSIZE_MAX_VOLUME_M3;
}
function hs6(code: unknown): string {
  return hsCodeDigitsOnly(code as string).slice(0, 6);
}

type DutyLineItem = { name: string; hs_code: string | null; declared_value_cad: number; quantity_per_waybill: number };

function pickDominantHs6(items: DutyLineItem[], unitWeightKg: number, unitVolumeM3: number): string | null {
  const groups = new Map<string, { value: number; qty: number }>();
  for (const it of items) {
    const code = hs6(it.hs_code);
    if (!code) continue;
    const g = groups.get(code) ?? { value: 0, qty: 0 };
    g.value += Number(it.declared_value_cad ?? 0);
    g.qty += Number(it.quantity_per_waybill ?? 0);
    groups.set(code, g);
  }
  if (groups.size === 0) return null;
  const totalValue = [...groups.values()].reduce((s, g) => s + g.value, 0) || 1;
  const ranked = [...groups.entries()].map(([code, g]) => ({
    code,
    value: g.value,
    qty: g.qty,
    volume: unitVolumeM3 * (g.value / totalValue),
    weight: unitWeightKg * (g.value / totalValue),
  }));
  const topByMetric = (metric: "volume" | "weight" | "qty" | "value") => [...ranked].sort((a, b) => b[metric] - a[metric]);
  for (const metric of ["volume", "weight", "qty", "value"] as const) {
    const sorted = topByMetric(metric);
    if (sorted.length === 1) return sorted[0].code;
    if (sorted[0][metric] >= sorted[1][metric] * 2) return sorted[0].code;
  }
  for (const metric of ["volume", "weight", "qty", "value"] as const) {
    const sorted = topByMetric(metric);
    if (sorted[0][metric] > (sorted[1]?.[metric] ?? -Infinity)) return sorted[0].code;
  }
  return ranked[0].code;
}

type InvoiceLineCandidate = {
  code: string;
  items: DutyLineItem[];
  packages: number;
  weightKg: number;
  volM3: number;
  standalone?: { kind: "pallet" | "carton" | "waybill"; ref: string };
};

function mergeCandidates(candidates: InvoiceLineCandidate[]): InvoiceLineCandidate[] {
  const merged = new Map<string, InvoiceLineCandidate>();
  for (const c of candidates) {
    if (c.standalone) continue;
    const line = merged.get(c.code) ?? { code: c.code, items: [], packages: 0, weightKg: 0, volM3: 0 };
    line.items.push(...c.items);
    line.packages += c.packages;
    line.weightKg += c.weightKg;
    line.volM3 += c.volM3;
    merged.set(c.code, line);
  }
  return [...merged.values(), ...candidates.filter((c) => c.standalone)];
}

export const getBatchInvoiceExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: batch, error: batchErr } = await supabaseAdmin.from("batches").select("*").eq("id", data.batchId).single();
    if (batchErr || !batch) throw new Error(batchErr?.message ?? "批次不存在");

    const { data: pallets } = await supabaseAdmin.from("pallets").select("*").eq("batch_id", data.batchId);
    const palletIds = (pallets ?? []).map((p: any) => p.id);
    const { data: batchCartons } = await supabaseAdmin.from("cartons").select("*").eq("batch_id", data.batchId);
    const nestedCartons = await selectByIds(supabaseAdmin, "cartons", "*", "pallet_id", palletIds);
    const allCartons = [...(batchCartons ?? []), ...nestedCartons];
    const { data: directRows, error: directErr } = await supabaseAdmin.from("waybills").select("*").eq("assigned_batch_id", data.batchId);
    if (directErr) throw new Error(directErr.message);
    const [viaPallet, viaCarton] = await Promise.all([
      selectByIds(supabaseAdmin, "waybills", "*", "pallet_id", palletIds),
      selectByIds(supabaseAdmin, "waybills", "*", "carton_id", allCartons.map((c: any) => c.id)),
    ]);
    const allWbs = Array.from(new Map([...(directRows ?? []), ...viaPallet, ...viaCarton].map((w: any) => [w.id, w])).values()) as any[];

    const fwdIds = Array.from(new Set(allWbs.map((w) => w.forwarding_id).filter(Boolean)));
    const [fwdOrders, fwdItems] = await Promise.all([
      selectByIds(supabaseAdmin, "forwarding_orders", "id,box_count,route_id", "id", fwdIds),
      selectByIds(supabaseAdmin, "forwarding_items", "*", "forwarding_id", fwdIds),
    ]);
    const routeIds = Array.from(new Set(fwdOrders.map((o: any) => o.route_id).filter(Boolean)));
    const customsRules = await selectByIds(supabaseAdmin, "customs_rules", "route_id,enabled,threshold_cad", "route_id", routeIds);
    const hsRows = await loadAllHsCodes(supabaseAdmin, "hs_code, name_zh, name_en, aliases, mfn_rate, gst_rate, anti_dumping_rate, material, origin", { activeOnly: true });
    const hsIndex = buildHsIndex(hsRows as any);
    const hsByCode = new Map(hsRows.map((h: any) => [normalizeHs(h.hs_code), h]));
    const { data: fxSetting } = await supabaseAdmin.from("app_settings").select("value").eq("key", "fx_rate").maybeSingle();
    const cnyPerCad = Number((fxSetting?.value as any)?.cny_per_cad ?? 0);
    const fx = cnyPerCad > 0 ? +(1 / cnyPerCad).toFixed(6) : 0.19;

    const fwdOrderMap = new Map(fwdOrders.map((o: any) => [o.id, o]));
    const fwdItemsByFwd = new Map<string, any[]>();
    for (const it of fwdItems) fwdItemsByFwd.set(it.forwarding_id, [...(fwdItemsByFwd.get(it.forwarding_id) ?? []), it]);
    const customsByRoute = new Map(customsRules.map((c: any) => [c.route_id, c]));

    async function itemsFor(wb: any): Promise<DutyLineItem[]> {
      if (!wb.forwarding_id) return [];
      const fo = fwdOrderMap.get(wb.forwarding_id);
      const fi = fwdItemsByFwd.get(wb.forwarding_id) ?? [];
      const customs = fo ? customsByRoute.get((fo as any).route_id) ?? null : null;
      const br = await computeWaybillDutyBreakdown(supabaseAdmin, wb, { fo, fi, hs: hsRows as any, hsIndex, customs, fx });
      return br.items.map((it) => ({
        name: it.name,
        hs_code: it.hs_code,
        declared_value_cad: it.declared_value_cad,
        quantity_per_waybill: it.quantity_per_waybill,
      }));
    }

    // Reconcile system-recorded weight/volume against the HBL's declared
    // totals — same scaling this export always did — before summing them
    // into consolidated lines, so line totals still add up to the HBL.
    const allUnits = [
      ...(pallets ?? []).map((p: any) => ({ weight_kg: p.self_weight_kg ?? p.weight_kg, length_cm: p.self_length_cm ?? p.length_cm, width_cm: p.self_width_cm ?? p.width_cm, height_cm: p.self_height_cm ?? p.height_cm })),
      ...allCartons.filter((c: any) => !c.pallet_id),
      ...allWbs.filter((w) => !w.carton_id && !w.pallet_id),
    ];
    const systemGross = allUnits.reduce((s, u) => s + Number(u.weight_kg ?? 0), 0);
    const systemVolume = allUnits.reduce((s, u) => s + volumeM3(u), 0);
    const targetGross = Number((batch as any)?.hbl_total_weight_kg ?? 0) || systemGross;
    const targetVolume = Number((batch as any)?.hbl_total_volume_m3 ?? 0) || systemVolume;
    const weightFactor = systemGross > 0 ? targetGross / systemGross : 1;
    const volumeFactor = systemVolume > 0 ? targetVolume / systemVolume : 1;

    const unmatchedRefs: string[] = [];
    const candidates: InvoiceLineCandidate[] = [];

    // ---- Pallets ----
    const cartonsByPallet = new Map<string, any[]>();
    for (const c of allCartons) if (c.pallet_id) cartonsByPallet.set(c.pallet_id, [...(cartonsByPallet.get(c.pallet_id) ?? []), c]);
    const wbsByCarton = new Map<string, any[]>();
    for (const w of allWbs) if (w.carton_id) wbsByCarton.set(w.carton_id, [...(wbsByCarton.get(w.carton_id) ?? []), w]);
    const wbsByPalletDirect = new Map<string, any[]>();
    for (const w of allWbs) if (w.pallet_id && !w.carton_id) wbsByPalletDirect.set(w.pallet_id, [...(wbsByPalletDirect.get(w.pallet_id) ?? []), w]);

    for (const p of pallets ?? []) {
      const cartons = cartonsByPallet.get(p.id) ?? [];
      const wbs = [...cartons.flatMap((c: any) => wbsByCarton.get(c.id) ?? []), ...(wbsByPalletDirect.get(p.id) ?? [])];
      const items = (await Promise.all(wbs.map((w) => itemsFor(w)))).flat();
      if (!items.length) {
        // A pallet with waybills that produced no priced items (e.g. a shop
        // order — not yet covered by this consolidation) must be visible as
        // skipped, not silently absent from the invoice.
        if (wbs.length) unmatchedRefs.push(`托盘 ${p.pallet_no ?? p.id}`);
        continue;
      }
      const weightKg = Number(p.self_weight_kg ?? p.weight_kg ?? 0) * weightFactor;
      const volM3 = volumeM3({ length_cm: p.self_length_cm ?? p.length_cm, width_cm: p.self_width_cm ?? p.width_cm, height_cm: p.self_height_cm ?? p.height_cm }) * volumeFactor;
      const code = pickDominantHs6(items, weightKg, volM3);
      if (!code) { unmatchedRefs.push(`托盘 ${p.pallet_no ?? p.id}`); continue; }
      candidates.push({ code, items, packages: 1, weightKg, volM3 });
    }
    const palletLines = mergeCandidates(candidates);

    // ---- Independent cartons + waybills (pooled together) ----
    const standaloneCartons = allCartons.filter((c: any) => !c.pallet_id);
    const directWbs = allWbs.filter((w) => !w.carton_id && !w.pallet_id);
    const poolable: InvoiceLineCandidate[] = [];
    for (const c of standaloneCartons) {
      const wbs = wbsByCarton.get(c.id) ?? [];
      const items = (await Promise.all(wbs.map((w: any) => itemsFor(w)))).flat();
      if (!items.length) {
        if (wbs.length) unmatchedRefs.push(`箱号 ${c.carton_no ?? c.id}`);
        continue;
      }
      const weightKg = Number(c.weight_kg ?? 0) * weightFactor;
      const volM3 = volumeM3(c) * volumeFactor;
      const code = pickDominantHs6(items, weightKg, volM3);
      if (!code) { unmatchedRefs.push(`箱号 ${c.carton_no ?? c.id}`); continue; }
      const entry: InvoiceLineCandidate = { code, items, packages: 1, weightKg, volM3 };
      poolable.push(isOversize(c) ? { ...entry, standalone: { kind: "carton", ref: c.carton_no ?? c.id } } : entry);
    }
    for (const w of directWbs) {
      const items = await itemsFor(w);
      if (!items.length) {
        if (w.order_id || w.forwarding_id) unmatchedRefs.push(`运单 ${w.waybill_no ?? w.id}`);
        continue;
      }
      const weightKg = Number(w.weight_kg ?? 0) * weightFactor;
      const volM3 = volumeM3(w) * volumeFactor;
      const code = pickDominantHs6(items, weightKg, volM3);
      if (!code) { unmatchedRefs.push(`运单 ${w.waybill_no ?? w.id}`); continue; }
      const entry: InvoiceLineCandidate = { code, items, packages: 1, weightKg, volM3 };
      poolable.push(isOversize(w) ? { ...entry, standalone: { kind: "waybill", ref: w.waybill_no ?? w.id } } : entry);
    }
    const wbCartonLines = mergeCandidates(poolable);

    function toRow(line: InvoiceLineCandidate, defaultSource: "pallet" | "waybill_or_carton") {
      const matching = line.items.filter((it) => hs6(it.hs_code) === line.code);
      const value = matching.reduce((s, it) => s + Number(it.declared_value_cad ?? 0), 0);
      const qty = matching.reduce((s, it) => s + Number(it.quantity_per_waybill ?? 0), 0);
      const unitPriceActual = qty > 0 ? value / qty : 0;
      const unitPriceCad = +(unitPriceActual * INVOICE_UNIT_PRICE_RATIO).toFixed(2);
      // Representative full hs_code: the highest-value item actually carrying this 6-digit prefix.
      const rep = [...matching].sort((a, b) => Number(b.declared_value_cad) - Number(a.declared_value_cad))[0];
      const hsRow: any = hsByCode.get(normalizeHs(rep?.hs_code)) ?? hsByCode.get(line.code);
      const totalQty = line.items.reduce((s, it) => s + Number(it.quantity_per_waybill ?? 0), 0);
      return {
        source: line.standalone ? line.standalone.kind : defaultSource,
        ref: line.standalone?.ref ?? null,
        hs_code: hsRow?.hs_code ?? rep?.hs_code ?? line.code,
        name_en: hsRow?.name_en ?? hsRow?.name_zh ?? rep?.name ?? line.code,
        material: hsRow?.material ?? "REVIEW",
        origin: hsRow?.origin ?? "China",
        packages: line.packages,
        quantity: +totalQty.toFixed(2),
        net_weight_kg: +line.weightKg.toFixed(2),
        cbm: +line.volM3.toFixed(3),
        unit_price_cad: unitPriceCad,
        total_value_cad: +(unitPriceCad * totalQty).toFixed(2),
        unit: "PCS",
      };
    }
    const items = [
      ...palletLines.map((l) => toRow(l, "pallet")),
      ...wbCartonLines.map((l) => toRow(l, "waybill_or_carton")),
    ];

    return {
      batch,
      items,
      merged_line_count: items.filter((i) => !i.ref).length,
      unmatched: unmatchedRefs,
      adjustment: {
        system_gross_kg: +systemGross.toFixed(2), target_gross_kg: +targetGross.toFixed(2), weight_factor: +weightFactor.toFixed(6),
        system_cbm: +systemVolume.toFixed(3), target_cbm: +targetVolume.toFixed(3), volume_factor: +volumeFactor.toFixed(6),
      },
    };
  });
