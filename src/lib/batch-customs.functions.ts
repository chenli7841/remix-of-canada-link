import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadAllHsCodes } from "@/lib/duty.server";
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

async function batchWaybills(admin: any, batchId: string) {
  const [{ data: pallets }, { data: directCartons }] = await Promise.all([
    admin.from("pallets").select("id").eq("batch_id", batchId),
    admin.from("cartons").select("id").eq("batch_id", batchId),
  ]);
  const palletIds = (pallets ?? []).map((p: any) => p.id);
  const { data: nestedCartons } = palletIds.length
    ? await admin.from("cartons").select("id").in("pallet_id", palletIds)
    : { data: [] };
  const cartonIds = Array.from(new Set([...(directCartons ?? []), ...(nestedCartons ?? [])].map((c: any) => c.id)));
  const queries: any[] = [admin.from("waybills").select("*").eq("assigned_batch_id", batchId)];
  if (palletIds.length) queries.push(admin.from("waybills").select("*").in("pallet_id", palletIds));
  if (cartonIds.length) queries.push(admin.from("waybills").select("*").in("carton_id", cartonIds));
  const results = await Promise.all(queries);
  for (const r of results) if (r.error) throw new Error(r.error.message);
  return Array.from(new Map(results.flatMap((r) => r.data ?? []).map((w: any) => [w.id, w])).values()) as any[];
}

async function loadCustomsItems(admin: any, batchId: string) {
  const waybills = await batchWaybills(admin, batchId);
  const forwardingIds = Array.from(new Set(waybills.map((w) => w.forwarding_id).filter(Boolean)));
  const orderIds = Array.from(new Set(waybills.map((w) => w.order_id).filter(Boolean)));
  const [{ data: forwardingOrders }, { data: forwardingItems }, { data: orders }, { data: orderItems }, hsRows] =
    await Promise.all([
      forwardingIds.length
        ? admin.from("forwarding_orders").select("id,customer_code,box_count").in("id", forwardingIds)
        : Promise.resolve({ data: [] }),
      forwardingIds.length
        ? admin.from("forwarding_items").select("*").in("forwarding_id", forwardingIds)
        : Promise.resolve({ data: [] }),
      orderIds.length
        ? admin.from("orders").select("id,customer_code,box_count,fx_rate").in("id", orderIds)
        : Promise.resolve({ data: [] }),
      orderIds.length ? admin.from("order_items").select("*").in("order_id", orderIds) : Promise.resolve({ data: [] }),
      loadAllHsCodes(admin, "hs_code,name_zh,name_en,aliases,material,origin,unit,is_active", { activeOnly: true }),
    ]);
  return {
    waybills,
    forwardingOrders: forwardingOrders ?? [],
    forwardingItems: forwardingItems ?? [],
    orders: orders ?? [],
    orderItems: orderItems ?? [],
    hsRows: hsRows ?? [],
  };
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

export const getBatchCustomsReadiness = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const loaded = await loadCustomsItems(supabaseAdmin, data.batchId);
    const codeSet = new Set(loaded.hsRows.map((h: any) => normalizeHs(h.hs_code)));
    const fwdMissing = loaded.forwardingItems.filter((i: any) => !codeSet.has(normalizeHs(i.hs_code)));
    const orderMissing = loaded.orderItems.filter((i: any) => !codeSet.has(normalizeHs(attrs(i).hs_code)));
    return {
      item_count: loaded.forwardingItems.length + loaded.orderItems.length,
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
    const pending = loaded.forwardingItems.filter((i: any) => !codeMap.has(normalizeHs(i.hs_code)));
    let local = 0;
    let ai = 0;
    const unresolved: any[] = [];
    for (const item of pending) {
      const hit = localMatch(String(item.name ?? ""), loaded.hsRows);
      if (hit?.source === "local_exact") {
        await supabaseAdmin.from("forwarding_items").update({ hs_code: hit.row.hs_code }).eq("id", item.id);
        local++;
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
          if (!source || Number(choice?.confidence ?? 0) < 0.75 || !codeMap.has(code)) continue;
          await supabaseAdmin.from("forwarding_items").update({ hs_code: code }).eq("id", source.id);
          ai++;
        }
      } catch {
        // Local matches remain valid; unresolved rows stay untouched for manual review.
      }
    }
    const readiness = await loadCustomsItems(supabaseAdmin, data.batchId);
    const missing = readiness.forwardingItems.filter((i: any) => !codeMap.has(normalizeHs(i.hs_code))).length;
    return { local_matched: local, ai_matched: ai, missing_count: missing };
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

export const getBatchInvoiceExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: batch } = await supabaseAdmin.from("batches").select("*").eq("id", data.batchId).single();
    const loaded = await loadCustomsItems(supabaseAdmin, data.batchId);
    const hsMap = new Map(loaded.hsRows.map((h: any) => [normalizeHs(h.hs_code), h]));
    const fwdMap = new Map(loaded.forwardingOrders.map((o: any) => [o.id, o]));
    const orderMap = new Map(loaded.orders.map((o: any) => [o.id, o]));
    const customerForWaybill = (w: any) =>
      String((w.forwarding_id && (fwdMap.get(w.forwarding_id) as any)?.customer_code) ||
        (w.order_id && (orderMap.get(w.order_id) as any)?.customer_code) || "");

    // Physical outer packages: pallets + standalone cartons + direct waybills.
    const { data: pallets } = await supabaseAdmin.from("pallets").select("*").eq("batch_id", data.batchId);
    const palletIds = (pallets ?? []).map((p: any) => p.id);
    const { data: batchCartons } = await supabaseAdmin.from("cartons").select("*").eq("batch_id", data.batchId);
    const { data: nestedCartons } = palletIds.length
      ? await supabaseAdmin.from("cartons").select("*").in("pallet_id", palletIds)
      : { data: [] };
    const cartons = [...(batchCartons ?? []), ...(nestedCartons ?? [])];
    const directWaybills = loaded.waybills.filter((w: any) =>
      w.assigned_batch_id === data.batchId && !w.carton_id && !w.pallet_id,
    );
    const packageRows: any[] = [
      ...(pallets ?? []).map((p: any) => ({ ...p, kind: "pallet", no: p.pallet_no, customer_code: p.customer_code ?? "" })),
      ...cartons.filter((c: any) => !c.pallet_id).map((c: any) => ({ ...c, kind: "carton", no: c.carton_no, customer_code: c.customer_code ?? "" })),
      ...directWaybills.map((w: any) => ({ ...w, kind: "direct", no: w.waybill_no, customer_code: customerForWaybill(w) })),
    ];
    const volumeM3 = (x: any) =>
      Number(x.length_cm ?? 0) * Number(x.width_cm ?? 0) * Number(x.height_cm ?? 0) / 1_000_000;
    const systemGross = packageRows.reduce((s, p) => s + Number(p.weight_kg ?? 0), 0);
    const systemVolume = packageRows.reduce((s, p) => s + volumeM3(p), 0);
    const targetGross = Number((batch as any)?.hbl_total_weight_kg ?? 0) || systemGross;
    const targetVolume = Number((batch as any)?.hbl_total_volume_m3 ?? 0) || systemVolume;
    const weightFactor = systemGross > 0 ? targetGross / systemGross : 1;
    const volumeFactor = systemVolume > 0 ? targetVolume / systemVolume : 1;
    let usedGross = 0, usedVolume = 0;
    const packing_rows = packageRows.map((p, index) => {
      const last = index === packageRows.length - 1;
      const adjustedGross = last ? targetGross - usedGross : +(Number(p.weight_kg ?? 0) * weightFactor).toFixed(2);
      const adjustedVolume = last ? targetVolume - usedVolume : +(volumeM3(p) * volumeFactor).toFixed(3);
      usedGross += adjustedGross; usedVolume += adjustedVolume;
      const tare = p.kind === "pallet" ? 15 : 1;
      return {
        kind: p.kind,
        package_no: p.no ?? "",
        customer_code: p.customer_code ?? "",
        system_gross_kg: +Number(p.weight_kg ?? 0).toFixed(2),
        adjusted_gross_kg: +adjustedGross.toFixed(2),
        tare_kg: tare,
        net_weight_kg: +Math.max(0, adjustedGross - tare).toFixed(2),
        system_cbm: +volumeM3(p).toFixed(3),
        adjusted_cbm: +adjustedVolume.toFixed(3),
      };
    });
    const customerTotals = new Map<string, { packages: number; gross: number; net: number; cbm: number }>();
    for (const p of packing_rows) {
      const t = customerTotals.get(p.customer_code) ?? { packages: 0, gross: 0, net: 0, cbm: 0 };
      t.packages++; t.gross += p.adjusted_gross_kg; t.net += p.net_weight_kg; t.cbm += p.adjusted_cbm;
      customerTotals.set(p.customer_code, t);
    }
    const forwardingGoods = loaded.forwardingItems.map((i: any) => {
      const parent: any = fwdMap.get(i.forwarding_id) ?? {};
      const boxCount = Math.max(1, Number(parent.box_count ?? attrs(i).box_count ?? 1));
      const perBox = Number(attrs(i).items_per_carton ?? attrs(i).inner_qty ?? 0);
      const qty = perBox > 0 ? boxCount * perBox : Number(i.quantity ?? 0);
      const hs: any = hsMap.get(normalizeHs(i.hs_code));
      return {
        customer_code: parent.customer_code ?? "",
        packages: boxCount,
        quantity: qty,
        unit_price_cad: Number(i.unit_price_cad ?? 0),
        total_value_cad: +(qty * Number(i.unit_price_cad ?? 0)).toFixed(2),
        name: i.name ?? "",
        name_en: hs?.name_en ?? i.name ?? "",
        material: attrs(i).material || hs?.material || "REVIEW",
        hs_code: hs?.hs_code ?? normalizeHs(i.hs_code),
        origin: attrs(i).origin || hs?.origin || "China",
        unit: "PCS",
      };
    });
    const shopGoods = loaded.orderItems.map((i: any) => {
      const parent: any = orderMap.get(i.order_id) ?? {};
      const boxCount = Math.max(1, Number(parent.box_count ?? attrs(i).box_count ?? 1));
      const perBox = Number(attrs(i).items_per_carton ?? attrs(i).inner_qty ?? 0);
      const qty = perBox > 0 ? boxCount * perBox : Number(i.quantity ?? 0);
      const hs: any = hsMap.get(normalizeHs(attrs(i).hs_code));
      const fxRate = Number(parent.fx_rate ?? 1) || 1;
      const unitPriceCad = Number(attrs(i).unit_price_cad ?? 0) || Number(i.unit_price_cny ?? 0) / fxRate;
      return {
        customer_code: parent.customer_code ?? "",
        packages: boxCount,
        quantity: qty,
        unit_price_cad: +unitPriceCad.toFixed(2),
        total_value_cad: +(qty * unitPriceCad).toFixed(2),
        name: i.name_zh ?? i.name_en ?? "",
        name_en: hs?.name_en ?? i.name_en ?? i.name_zh ?? "",
        material: attrs(i).material || hs?.material || "REVIEW",
        hs_code: hs?.hs_code ?? normalizeHs(attrs(i).hs_code),
        origin: attrs(i).origin || hs?.origin || "China",
        unit: "PCS",
      };
    });
    const baseItems = [...forwardingGoods, ...shopGoods];
    // Allocate each customer's adjusted package totals across its goods by declared value.
    // The final goods row absorbs rounding so invoice totals exactly reconcile to the HBL.
    const groupedItems = new Map<string, any[]>();
    for (const item of baseItems) groupedItems.set(item.customer_code, [...(groupedItems.get(item.customer_code) ?? []), item]);
    const items: any[] = [];
    for (const [customerCode, siblings] of groupedItems) {
      const valueTotal = siblings.reduce((s: number, x: any) => s + Number(x.total_value_cad ?? 0), 0);
      const totals = customerTotals.get(customerCode) ?? { packages: 0, gross: 0, net: 0, cbm: 0 };
      let usedPackages = 0, usedGross = 0, usedNet = 0, usedCbm = 0;
      siblings.forEach((item: any, index: number) => {
        const last = index === siblings.length - 1;
        const share = valueTotal > 0 ? Number(item.total_value_cad ?? 0) / valueTotal : 1 / Math.max(1, siblings.length);
        const packages = last ? totals.packages - usedPackages : Math.floor(totals.packages * share);
        const gross = last ? totals.gross - usedGross : +(totals.gross * share).toFixed(2);
        const net = last ? totals.net - usedNet : +(totals.net * share).toFixed(2);
        const cbm = last ? totals.cbm - usedCbm : +(totals.cbm * share).toFixed(3);
        usedPackages += packages; usedGross += gross; usedNet += net; usedCbm += cbm;
        items.push({
          ...item,
          packages,
          gross_weight_kg: +gross.toFixed(2),
          net_weight_kg: +net.toFixed(2),
          cbm: +cbm.toFixed(3),
        });
      });
    }
    return {
      batch,
      items,
      packing_rows,
      adjustment: {
        system_gross_kg: +systemGross.toFixed(2), target_gross_kg: +targetGross.toFixed(2), weight_factor: +weightFactor.toFixed(6),
        system_cbm: +systemVolume.toFixed(3), target_cbm: +targetVolume.toFixed(3), volume_factor: +volumeFactor.toFixed(6),
      },
    };
  });
