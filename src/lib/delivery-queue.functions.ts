import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { groupDeliveryUnits, deliverySettlementSummary } from "@/lib/delivery-summary";
import { getFxCadPerCny } from "@/lib/orders.functions";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

async function logAction(admin: any, userId: string, action: string, entityId: string, after: any, note?: string) {
  try {
    await admin.from("admin_action_logs").insert({
      entity_type: "delivery_queue",
      entity_id: entityId,
      action,
      after,
      operator_id: userId,
      note: note ?? null,
    });
  } catch {
    /* ignore log failure */
  }
}

async function readDeliveryRows(admin: any, table: string, fields: string, column?: string, ids?: string[], status?: string) {
  const rows: any[] = [];
  const chunks = ids ? Array.from({length: Math.ceil(ids.length / 100)}, (_, i) => ids.slice(i*100, i*100+100)) : [null];
  for (const chunk of chunks) for (let offset = 0; ; offset += 500) {
    let q = admin.from(table).select(fields).order('id').range(offset, offset+499);
    if (chunk && column) q = q.in(column, chunk);
    if (status) q = q.eq('status', status);
    const result = await q;
    if (result.error) throw new Error('派送资料读取失败：' + result.error.message);
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < 500) break;
  }
  return rows;
}

// ===== List delivery queue =====
export const listDeliveryQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("delivery_queue")
      .select("*, batches:source_batch_id(batch_no), receivings:source_receiving_id(receiving_no)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

// ===== Prepare delivery from a receiving =====
export const prepareDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receivingId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: recv } = await supabaseAdmin
      .from("receivings")
      .select("id, batch_id, status")
      .eq("id", data.receivingId)
      .maybeSingle();
    if (!recv) throw new Error("收货单不存在");
    if (!recv.batch_id) throw new Error("请先匹配批次");

    const batchId = recv.batch_id;

    const { loadReceivingContents } = await import('./receiving-bulk.server');
    const contents = await loadReceivingContents(supabaseAdmin, batchId);
    const [pallets, cartons, waybills] = await Promise.all([
      readDeliveryRows(supabaseAdmin, 'pallets', 'id,pallet_no,customer_user_id,customer_code', 'id', contents.pallets.map(p=>p.id)),
      readDeliveryRows(supabaseAdmin, 'cartons', 'id,carton_no,pallet_id,customer_user_id,customer_code', 'id', contents.cartons.map(c=>c.id)),
      readDeliveryRows(supabaseAdmin, 'waybills', 'id,waybill_no,user_id,carton_id,pallet_id', 'id', contents.waybills.map(w=>w.id)),
    ]);

    // 客户号 = customer_code 非空
    const palletsCust = (pallets ?? []).filter((p) => p.customer_code?.trim());
    const cartonsCust = (cartons ?? []).filter((c) => c.customer_code?.trim() && !palletsCust.some(p => p.id === c.pallet_id));

    // 排除：在 (有客户号箱号) 内 或 (有客户号托盘) 内 的运单
    const custCartonIds = new Set(cartonsCust.map((c) => c.id));
    const custPalletIds = new Set(palletsCust.map((p) => p.id));
    // 箱号本身在客户号托盘内的，箱内运单亦排除
    const cartonsInCustPallet = new Set(
      (cartons ?? []).filter((c) => c.pallet_id && custPalletIds.has(c.pallet_id)).map((c) => c.id),
    );

    const waybillsToAdd = (waybills ?? []).filter((w) => {
      if (w.carton_id && (custCartonIds.has(w.carton_id) || cartonsInCustPallet.has(w.carton_id))) return false;
      if (w.pallet_id && custPalletIds.has(w.pallet_id)) return false;
      return true;
    });

    // user_id -> customer_code lookup
    const userIds = Array.from(new Set(waybillsToAdd.map((w) => w.user_id).filter(Boolean)));
    let userMap = new Map<string, { customer_code?: string | null }>();
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id, customer_code").in("id", userIds);
      userMap = new Map((profs ?? []).map((p: any) => [p.id, { customer_code: p.customer_code }]));
    }

    type Row = {
      kind: "waybill" | "carton" | "pallet";
      ref_id: string;
      code: string;
      customer_user_id: string | null;
      customer_code: string | null;
      source_receiving_id: string;
      source_batch_id: string;
      added_by: string;
      status: "pending";
    };
    const rows: Row[] = [
      ...palletsCust.map((p) => ({
        kind: "pallet" as const,
        ref_id: p.id,
        code: p.pallet_no ?? "",
        customer_user_id: p.customer_user_id ?? null,
        customer_code: p.customer_code ?? null,
        source_receiving_id: recv.id,
        source_batch_id: batchId,
        added_by: context.userId,
        status: "pending" as const,
      })),
      ...cartonsCust.map((c) => ({
        kind: "carton" as const,
        ref_id: c.id,
        code: c.carton_no ?? "",
        customer_user_id: c.customer_user_id ?? null,
        customer_code: c.customer_code ?? null,
        source_receiving_id: recv.id,
        source_batch_id: batchId,
        added_by: context.userId,
        status: "pending" as const,
      })),
      ...waybillsToAdd.map((w) => ({
        kind: "waybill" as const,
        ref_id: w.id,
        code: w.waybill_no ?? "",
        customer_user_id: w.user_id ?? null,
        customer_code: (w.user_id && userMap.get(w.user_id)?.customer_code) || null,
        source_receiving_id: recv.id,
        source_batch_id: batchId,
        added_by: context.userId,
        status: "pending" as const,
      })),
    ];

    // Skip rows already in pending
    let inserted = 0,
      skipped = 0;
    if (rows.length) {
      // fetch existing pending by (kind, ref_id)
      const refIds = rows.map((r) => r.ref_id);
      const { data: existing } = await supabaseAdmin
        .from("delivery_queue")
        .select("kind, ref_id")
        .in("ref_id", refIds)
        .eq("status", "pending");
      const exSet = new Set((existing ?? []).map((e: any) => `${e.kind}:${e.ref_id}`));
      const toInsert = rows.filter((r) => !exSet.has(`${r.kind}:${r.ref_id}`));
      skipped = rows.length - toInsert.length;
      if (toInsert.length) {
        const { error } = await supabaseAdmin.from("delivery_queue").insert(toInsert);
        if (error) throw new Error(error.message);
        inserted = toInsert.length;
      }
    }

    await logAction(supabaseAdmin, context.userId, "delivery_queue.prepare", recv.id, {
      receiving_id: recv.id,
      batch_id: batchId,
      counts: {
        waybills: waybillsToAdd.length,
        cartons: cartonsCust.length,
        pallets: palletsCust.length,
        inserted,
        skipped,
      },
    });

    return {
      ok: true,
      counts: {
        waybills: waybillsToAdd.length,
        cartons: cartonsCust.length,
        pallets: palletsCust.length,
        inserted,
        skipped,
      },
    };
  });

// ===== Update item status =====
export const updateDeliveryQueueItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "pending" | "dispatched" | "cancelled"; notes?: string | null }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = { status: data.status };
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.status === "dispatched") patch.dispatched_by = context.userId;
    const { error } = await supabaseAdmin.from("delivery_queue").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    if (data.status !== "dispatched") await logAction(supabaseAdmin, context.userId, `delivery_queue.${data.status}`, data.id, patch);
    return { ok: true };
  });

// ===== Remove item =====
export const removeDeliveryQueueItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("delivery_queue").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAction(supabaseAdmin, context.userId, "delivery_queue.remove", data.id, {});
    return { ok: true };
  });

// ============================================================
// Helpers to hydrate per-item weight/dims/fee
// ============================================================
async function hydrateItems(admin: any, items: any[], fx: number) {
  const waybillIds = items.filter((i) => i.kind === "waybill").map((i) => i.ref_id);
  const cartonIds = items.filter((i) => i.kind === "carton").map((i) => i.ref_id);
  const palletIds = items.filter((i) => i.kind === "pallet").map((i) => i.ref_id);

  const wRows = await readDeliveryRows(admin, 'waybills', 'id,waybill_no,weight_kg,length_cm,width_cm,height_cm,freight_cad,order_id,user_id,carton_id,pallet_id', 'id', [...new Set(waybillIds)]);
  const allCartonIds = [...new Set([...cartonIds, ...wRows.map(w=>w.carton_id).filter(Boolean)])];
  const [cRows, pRows] = await Promise.all([
    readDeliveryRows(admin, 'cartons', 'id,carton_no,weight_kg,length_cm,width_cm,height_cm,self_freight_cny,pallet_id', 'id', allCartonIds),
    readDeliveryRows(admin, 'pallets', 'id,pallet_no,weight_kg,length_cm,width_cm,height_cm,self_freight_cny', 'id', [...new Set(palletIds)]),
  ]);
  const wMap = new Map(wRows.map(r=>[r.id,r])), cMap = new Map(cRows.map(r=>[r.id,r])), pMap = new Map(pRows.map(r=>[r.id,r]));

  return items.map((it: any) => {
    const src =
      it.kind === "waybill" ? wMap.get(it.ref_id) : it.kind === "carton" ? cMap.get(it.ref_id) : pMap.get(it.ref_id);
    const s: any = src ?? {};
    return {
      ...it,
      carton_id: s.carton_id ?? null,
      pallet_id: s.pallet_id ?? cMap.get(s.carton_id)?.pallet_id ?? null,
      weight_kg: s.weight_kg != null ? Number(s.weight_kg) : 0,
      length_cm: s.length_cm != null ? Number(s.length_cm) : null,
      width_cm: s.width_cm != null ? Number(s.width_cm) : null,
      height_cm: s.height_cm != null ? Number(s.height_cm) : null,
      fee_cny:
        it.kind === "waybill"
          ? s.freight_cad != null
            ? Number(s.freight_cad) / fx
            : 0
          : s.self_freight_cny != null
            ? Number(s.self_freight_cny)
            : 0,
      order_id: s.order_id ?? null,
    };
  });
}

// ============================================================
// List — grouped by customer
// ============================================================
export const listDeliveryByCustomer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const fx = await getFxCadPerCny(supabaseAdmin);

    const rows = await readDeliveryRows(supabaseAdmin, 'delivery_queue', '*', undefined, undefined, data.status || 'pending');
    const unresolvedCodes = [...new Set(rows.filter(r=>!r.customer_user_id && r.customer_code).map(r=>r.customer_code))];
    const profilesByCode = await readDeliveryRows(supabaseAdmin, 'profiles', 'id,customer_code', 'customer_code', unresolvedCodes);
    const userByCode = new Map(profilesByCode.map(p=>[p.customer_code,p.id]));
    const items = await hydrateItems(supabaseAdmin, rows.map(r=>({...r,customer_user_id:r.customer_user_id || userByCode.get(r.customer_code) || null})), fx);
    const groups = groupDeliveryUnits(items);
    const batchIds = [...new Set(items.map(it=>it.source_batch_id).filter(Boolean))];
    const [batches, settlements] = await Promise.all([
      readDeliveryRows(supabaseAdmin, 'batches', 'id,batch_no,display_name,fees_dirty_at', 'id', batchIds),
      readDeliveryRows(supabaseAdmin, 'batch_settlements', '*', 'batch_id', batchIds),
    ]);
    const extraFeeMap = new Map<string, number>();
    for (const batchId of batchIds) for (let offset = 0; ; offset += 500) {
      const result = await (supabaseAdmin as any).from('batch_customer_notes').select('customer_code,extra_fee_cny')
        .eq('batch_id', batchId).order('customer_code').range(offset, offset + 499);
      if (result.error) throw new Error('额外费用读取失败，请确认已执行额外费用迁移');
      for (const row of result.data ?? []) if (row.extra_fee_cny != null) extraFeeMap.set(batchId + ':' + row.customer_code, Number(row.extra_fee_cny));
      if ((result.data ?? []).length < 500) break;
    }
    const batchMap = new Map(batches.map(b=>[b.id,b]));
    const settlementMap = new Map(settlements.map(st=>[st.batch_id + ':' + st.customer_code,st]));

    // Enrich with profile / default address / wallet
    const userIds = Array.from(groups.values())
      .map((g) => g.customer_user_id)
      .filter(Boolean);
    let profileMap = new Map<string, any>();
    let addrMap = new Map<string, any>();
    let walletMap = new Map<string, any>();
    if (userIds.length) {
      const [profs, addrs, wals] = await Promise.all([
        readDeliveryRows(supabaseAdmin, 'profiles', 'id,full_name,phone,reg_phone,reg_address,reg_city,reg_province,reg_country,reg_postal_code,customer_code', 'id', userIds),
        readDeliveryRows(supabaseAdmin, 'addresses', 'id,user_id,recipient,phone,line1,line2,city,province,country,postal_code,is_default', 'user_id', userIds),
        // wallets are keyed by user_id rather than id, so read them without the pagination helper.
        supabaseAdmin.from('wallets').select('user_id,balance_cad').in('user_id', userIds).then(r=>{if(r.error)throw new Error('客户余额读取失败');return r.data ?? [];}),
      ]);
      profileMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
      for (const a of addrs ?? []) {
        const prev = addrMap.get(a.user_id);
        if (!prev || a.is_default) addrMap.set(a.user_id, a);
      }
      walletMap = new Map((wals ?? []).map((w: any) => [w.user_id, w]));
    }

    const list = Array.from(groups.values())
      .map((g) => {
        const p = g.customer_user_id ? profileMap.get(g.customer_user_id) : null;
        const a = g.customer_user_id ? addrMap.get(g.customer_user_id) : null;
        const w = g.customer_user_id ? walletMap.get(g.customer_user_id) : null;
        const address = a
          ? [a.line1, a.line2, a.city, a.province, a.country, a.postal_code].filter(Boolean).join(" ")
          : p
            ? [p.reg_address, p.reg_city, p.reg_province, p.reg_country, p.reg_postal_code].filter(Boolean).join(" ")
            : "";
        const phone = a?.phone || p?.phone || p?.reg_phone || null;
        const feeCny = extraFeeMap.get(g.batch_id + ':' + (g.customer_code || p?.customer_code)) ?? g.fee_cny;
        return {
          ...g,
          batch_name: batchMap.get(g.batch_id)?.display_name || batchMap.get(g.batch_id)?.batch_no || '未关联批次',
          batch_no: batchMap.get(g.batch_id)?.batch_no ?? '',
          ...deliverySettlementSummary(settlementMap.get(g.batch_id + ':' + (g.customer_code || p?.customer_code)), batchMap.get(g.batch_id)),
          fee_cny: feeCny,
          fee_cad: +(feeCny * fx).toFixed(2),
          customer_code: g.customer_code || p?.customer_code || null,
          full_name: p?.full_name || (a?.recipient ?? null),
          phone,
          address,
          wallet_balance_cad: w ? Number(w.balance_cad) : null,
        };
      })
      .sort((x, y) => (y.earliest_at || "").localeCompare(x.earliest_at || ""));

    return { groups: list, fx };
  });

// ============================================================
// Customer detail — items + profile + wallet
// ============================================================
export const getCustomerDelivery = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { customerUserId?: string | null; customerCode?: string | null; batchId?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const fx = await getFxCadPerCny(supabaseAdmin);

    let q = supabaseAdmin
      .from("delivery_queue")
      .select("*, batches:source_batch_id(batch_no), receivings:source_receiving_id(receiving_no)")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (data.customerUserId) q = q.eq("customer_user_id", data.customerUserId);
    else if (data.customerCode) q = q.eq("customer_code", data.customerCode);
    else throw new Error("缺少客户标识");
    if (data.batchId) q = data.batchId === 'unassigned' ? q.is('source_batch_id', null) : q.eq('source_batch_id', data.batchId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const items = await hydrateItems(supabaseAdmin, rows ?? [], fx);

    let profile: any = null;
    let address: any = null;
    let wallet: any = null;
    if (data.customerUserId) {
      const [{ data: p }, { data: addrs }, { data: w }] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select(
            "id, full_name, email, phone, customer_code, reg_phone, reg_address, reg_city, reg_province, reg_country, reg_postal_code",
          )
          .eq("id", data.customerUserId)
          .maybeSingle(),
        supabaseAdmin
          .from("addresses")
          .select("*")
          .eq("user_id", data.customerUserId)
          .order("is_default", { ascending: false }),
        supabaseAdmin.from("wallets").select("*").eq("user_id", data.customerUserId).maybeSingle(),
      ]);
      profile = p ?? null;
      address = (addrs ?? [])[0] ?? null;
      wallet = w ?? null;
    }

    // fetch recent operation logs for these items
    const ids = items.map((i) => i.id);
    const idsList = [...ids, data.customerUserId].filter(Boolean);
    let logs: any[] = [];
    if (idsList.length) {
      const { data: lg } = await supabaseAdmin
        .from("admin_action_logs")
        .select("id, action, entity_type, entity_id, note, after, created_at, operator_id, operator_name")
        .in("entity_id", idsList)
        .order("created_at", { ascending: false })
        .limit(200);
      logs = lg ?? [];
    }

    return { items, profile, address, wallet, logs, fx };
  });

// ============================================================
// Deduct from customer wallet — with log
// ============================================================
export const deductCustomerWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { customerUserId: string; amountCad: number; note?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    if (!(data.amountCad > 0)) throw new Error("金额必须大于 0");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: w } = await supabaseAdmin
      .from("wallets")
      .select("balance_cad")
      .eq("user_id", data.customerUserId)
      .maybeSingle();
    const current = Number(w?.balance_cad ?? 0);
    const next = current - Number(data.amountCad);

    // type "spend" is not in the trigger's credit list, so it debits
    // wallets.balance_cad directly — no manual balance write needed.
    const { error: terr } = await supabaseAdmin.from("wallet_transactions").insert({
      user_id: data.customerUserId,
      type: "spend",
      amount_cad: Number(data.amountCad),
      status: "completed",
      channel: "admin",
      note: data.note ?? "派送费用扣款",
    } as any);
    if (terr) throw new Error(terr.message);

    await logAction(
      supabaseAdmin,
      context.userId,
      "delivery_queue.deduct",
      data.customerUserId,
      {
        amount_cad: data.amountCad,
        balance_before: current,
        balance_after: next,
      },
      data.note ?? undefined,
    );

    return { ok: true, balance_cad: next };
  });

// ============================================================
// Bulk status change for a customer (all pending -> dispatched/cancelled)
// ============================================================
export const bulkUpdateCustomerDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      customerUserId?: string | null;
      customerCode?: string | null;
      status: "dispatched" | "cancelled" | "pending";
      ids?: string[];
      batchId?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = { status: data.status };
    if (data.status === "dispatched") patch.dispatched_by = context.userId;

    let q = supabaseAdmin.from("delivery_queue").update(patch);
    if (data.ids && data.ids.length) q = q.in("id", data.ids);
    else {
      q = q.eq("status", "pending");
      if (data.customerUserId) q = q.eq("customer_user_id", data.customerUserId);
      else if (data.customerCode) q = q.eq("customer_code", data.customerCode);
      else throw new Error("缺少目标");
    }
    if (data.batchId !== undefined) q = data.batchId ? q.eq('source_batch_id', data.batchId) : q.is('source_batch_id', null);
    const { error } = await q;
    if (error) throw new Error(error.message);

    if (data.status !== "dispatched") await logAction(
      supabaseAdmin,
      context.userId,
      `delivery_queue.bulk_${data.status}`,
      data.customerUserId || data.customerCode || "batch",
      { ...data },
    );
    return { ok: true };
  });

// ============================================================
// Add tracking event / note for delivery
// ============================================================
export const addDeliveryTrackingEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { queueItemId: string; statusZh: string; locationZh?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: item } = await supabaseAdmin
      .from("delivery_queue")
      .select("*")
      .eq("id", data.queueItemId)
      .maybeSingle();
    if (!item) throw new Error("记录不存在");

    // If waybill and has order_id -> insert into tracking_events via shipment
    if (item.kind === "waybill") {
      const { data: wb } = await supabaseAdmin.from("waybills").select("order_id").eq("id", item.ref_id).maybeSingle();
      if (wb?.order_id) {
        let { data: ship } = await supabaseAdmin
          .from("shipments")
          .select("id")
          .eq("order_id", wb.order_id)
          .maybeSingle();
        if (!ship) {
          const { data: created } = await supabaseAdmin
            .from("shipments")
            .insert({ order_id: wb.order_id, status: "in_transit", tracking_no: item.code || "N/A" } as any)
            .select("id")
            .maybeSingle();
          ship = created ?? null;
        }
        if (ship?.id) {
          await supabaseAdmin.from("tracking_events").insert({
            shipment_id: ship.id,
            status_zh: data.statusZh,
            status_en: data.statusZh,
            location_zh: data.locationZh ?? null,
            event_time: new Date().toISOString(),
            source: "admin",
          } as any);
        }
      }
    }

    await logAction(
      supabaseAdmin,
      context.userId,
      "delivery_queue.tracking",
      data.queueItemId,
      { status_zh: data.statusZh, location_zh: data.locationZh ?? null },
      data.statusZh,
    );

    return { ok: true };
  });
