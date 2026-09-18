import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAdminLog } from "@/lib/admin-log";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

import { detectScanKind, SCAN_KIND_LABEL } from "@/lib/scan-detect";

// ===== List receivings =====
export const listReceivings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("receivings")
      .select(
        "id, receiving_no, batch_id, warehouse_code, status, notes, confirmed_at, created_at, batches:batch_id(batch_no, planned_ship_date, shipping_method, status)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { receivings: data ?? [] };
  });

// ===== Create receiving =====
export const createReceiving = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { warehouse_code?: string; notes?: string; batch_id?: string | null }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = new Date();
    const ymd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const { count } = await supabaseAdmin
      .from("receivings")
      .select("id", { count: "exact", head: true })
      .gte("created_at", `${today.toISOString().slice(0, 10)}T00:00:00Z`);
    const seq = String((count ?? 0) + 1).padStart(3, "0");
    const receiving_no = `RCV${ymd}${seq}`;
    const { data: row, error } = await supabaseAdmin
      .from("receivings")
      .insert({
        receiving_no,
        warehouse_code: data.warehouse_code || null,
        notes: data.notes || null,
        batch_id: data.batch_id || null,
        status: data.batch_id ? "matched" : "open",
        created_by: context.userId,
      })
      .select("id, receiving_no")
      .single();
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "receiving",
      entity_id: row!.id,
      action: "create",
      after: { receiving_no, warehouse_code: data.warehouse_code, batch_id: data.batch_id },
      operator_id: context.userId,
    });
    return row;
  });

// ===== Match a batch (or unmatch when batch_id null) =====
export const matchReceivingBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receivingId: string; batchId: string | null }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("receivings")
      .update({
        batch_id: data.batchId,
        status: data.batchId ? "matched" : "open",
      })
      .eq("id", data.receivingId);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "receiving",
      entity_id: data.receivingId,
      action: data.batchId ? "match_batch" : "unmatch_batch",
      after: { batch_id: data.batchId },
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ===== Scan a code into receiving =====
export const scanReceive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receivingId: string; code: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code.trim();
    if (!code) throw new Error("空扫描");
    const kind = detectScanKind(code);

    // 扫描批次号 → 直接把本次入库匹配到该批次
    if (kind === "batch") {
      const { data: b } = await supabaseAdmin
        .from("batches")
        .select("id, batch_no")
        .eq("batch_no", code)
        .maybeSingle();
      if (!b) throw new Error(`批次 ${code} 不存在`);
      await supabaseAdmin
        .from("receivings")
        .update({ batch_id: b.id, status: "matched" })
        .eq("id", data.receivingId);
      await recordAdminLog(supabaseAdmin, {
        entity_type: "receiving",
        entity_id: data.receivingId,
        action: "scan_match_batch",
        after: { batch_id: b.id, batch_no: b.batch_no },
        operator_id: context.userId,
        note: `扫码匹配批次 ${b.batch_no}`,
      });
      return { ok: true, kind, extra: false, scan_id: null, info: `批次 ${b.batch_no} 已匹配` };
    }

    let ref_id: string | null = null;
    let label: string = code;
    let itemBatch: string | null = null;
    if (kind === "carton") {
      const { data: c } = await supabaseAdmin
        .from("cartons")
        .select("id, carton_no, batch_id")
        .eq("carton_no", code)
        .maybeSingle();
      if (!c) throw new Error(`箱号 ${code} 不存在`);
      ref_id = c.id;
      label = c.carton_no ?? code;
      itemBatch = (c as any).batch_id ?? null;
    } else if (kind === "pallet") {
      const { data: p } = await supabaseAdmin
        .from("pallets")
        .select("id, pallet_no, batch_id")
        .eq("pallet_no", code)
        .maybeSingle();
      if (!p) throw new Error(`托盘 ${code} 不存在`);
      ref_id = p.id;
      label = p.pallet_no ?? code;
      itemBatch = (p as any).batch_id ?? null;
    } else {
      let w: any = (
        await supabaseAdmin
          .from("waybills")
          .select("id, waybill_no, assigned_batch_id")
          .eq("waybill_no", code)
          .maybeSingle()
      ).data;
      if (!w) {
        try {
          const { data: hit } = await supabaseAdmin.rpc("find_by_any_no", { _input: code });
          if (hit && (hit as any).kind === "waybill") {
            w = (
              await supabaseAdmin
                .from("waybills")
                .select("id, waybill_no, assigned_batch_id")
                .eq("id", (hit as any).id)
                .maybeSingle()
            ).data;
          }
        } catch {
          /* ignore */
        }
      }
      if (!w) throw new Error(`运单 ${code} 不存在`);
      ref_id = w.id;
      label = w.waybill_no ?? code;
      itemBatch = w.assigned_batch_id ?? null;
    }

    // upsert (idempotent)
    const { data: scanRow, error: upErr } = await supabaseAdmin
      .from("receiving_scans")
      .upsert(
        {
          receiving_id: data.receivingId,
          kind,
          ref_id: ref_id!,
          code: label,
          operator_id: context.userId,
          scanned_at: new Date().toISOString(),
        },
        { onConflict: "receiving_id,kind,ref_id" },
      )
      .select("id")
      .single();
    if (upErr) throw new Error(upErr.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "receiving",
      entity_id: data.receivingId,
      action: "scan",
      after: { kind, ref_id, code: label },
      operator_id: context.userId,
      note: `扫码收货 ${label}`,
    });

    // Auto-match batch: if receiving has no batch & scanned item belongs to a batch
    const { data: recv } = await supabaseAdmin
      .from("receivings")
      .select("batch_id")
      .eq("id", data.receivingId)
      .maybeSingle();
    if (recv && !recv.batch_id && itemBatch) {
      await supabaseAdmin
        .from("receivings")
        .update({ batch_id: itemBatch, status: "matched" })
        .eq("id", data.receivingId);
    }

    const currentBatch = recv?.batch_id ?? itemBatch;
    const extra = !!currentBatch && itemBatch !== currentBatch;

    return {
      ok: true,
      kind,
      extra,
      scan_id: scanRow?.id ?? null,
      info: `${SCAN_KIND_LABEL[kind]} ${label} ${extra ? "⚠ 不属于当前批次" : "已记录"}`,
    };
  });

// ===== Remove a scan =====
export const removeReceivingScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { scanId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("receiving_scans")
      .select("*")
      .eq("id", data.scanId)
      .maybeSingle();
    const { error } = await supabaseAdmin.from("receiving_scans").delete().eq("id", data.scanId);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "receiving",
      entity_id: before?.receiving_id ?? data.scanId,
      action: "remove_scan",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ===== Detail with batch-vs-received diff =====
export const getReceivingDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receivingId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: recv, error } = await supabaseAdmin
      .from("receivings")
      .select("*, batches:batch_id(id, batch_no, planned_ship_date, shipping_method, status, destination_code)")
      .eq("id", data.receivingId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!recv) throw new Error("收货单不存在");

    const { data: scans } = await supabaseAdmin
      .from("receiving_scans")
      .select("*")
      .eq("receiving_id", data.receivingId)
      .order("scanned_at", { ascending: false });

    // batch expected contents
    let expected = { waybills: [] as any[], cartons: [] as any[], pallets: [] as any[] };
    if (recv.batch_id) {
      const [{ data: wbs }, { data: cs }, { data: ps }] = await Promise.all([
        supabaseAdmin
          .from("waybills")
          .select("id, waybill_no, status, customer_code, carton_id, pallet_id")
          .eq("assigned_batch_id", recv.batch_id),
        supabaseAdmin.from("cartons").select("id, carton_no, pallet_id").eq("batch_id", recv.batch_id),
        supabaseAdmin.from("pallets").select("id, pallet_no").eq("batch_id", recv.batch_id),
      ]);
      expected = { waybills: wbs ?? [], cartons: cs ?? [], pallets: ps ?? [] };
    }

    const scanned = {
      waybills: new Set((scans ?? []).filter((s) => s.kind === "waybill").map((s) => s.ref_id)),
      cartons: new Set((scans ?? []).filter((s) => s.kind === "carton").map((s) => s.ref_id)),
      pallets: new Set((scans ?? []).filter((s) => s.kind === "pallet").map((s) => s.ref_id)),
    };
    const expectedIds = {
      waybills: new Set(expected.waybills.map((w) => w.id)),
      cartons: new Set(expected.cartons.map((c) => c.id)),
      pallets: new Set(expected.pallets.map((p) => p.id)),
    };

    // 直挂 (direct) split — only items not nested inside a higher container
    const direct = {
      waybills: expected.waybills.filter((w: any) => !w.carton_id && !w.pallet_id),
      cartons: expected.cartons.filter((c: any) => !c.pallet_id),
      pallets: expected.pallets,
    };

    // 待二次扫描确认: 已扫描箱号 → 内部运单; 已扫描托盘 → 内部箱号
    const scannedCartonIds = Array.from(scanned.cartons);
    const scannedPalletIds = Array.from(scanned.pallets);
    const innerWaybills = expected.waybills
      .filter((w: any) => w.carton_id && scannedCartonIds.includes(w.carton_id))
      .map((w: any) => ({ ...w, scanned: scanned.waybills.has(w.id) }));
    const innerCartons = expected.cartons
      .filter((c: any) => c.pallet_id && scannedPalletIds.includes(c.pallet_id))
      .map((c: any) => ({ ...c, scanned: scanned.cartons.has(c.id) }));
    const secondary = {
      inner_waybills: innerWaybills,
      inner_cartons: innerCartons,
      pending_count: innerWaybills.filter((x) => !x.scanned).length + innerCartons.filter((x) => !x.scanned).length,
      total_count: innerWaybills.length + innerCartons.length,
    };

    const diff = {
      missing_waybills: direct.waybills.filter((w: any) => !scanned.waybills.has(w.id)),
      missing_cartons: direct.cartons.filter((c: any) => !scanned.cartons.has(c.id)),
      missing_pallets: direct.pallets.filter((p: any) => !scanned.pallets.has(p.id)),
      extra_scans: (scans ?? []).filter(
        (s) =>
          (s.kind === "waybill" && !expectedIds.waybills.has(s.ref_id)) ||
          (s.kind === "carton" && !expectedIds.cartons.has(s.ref_id)) ||
          (s.kind === "pallet" && !expectedIds.pallets.has(s.ref_id)),
      ),
    };

    return { receiving: recv, scans: scans ?? [], expected, direct, secondary, diff };
  });

// ===== Confirm receiving: mark batch arrived + sync waybills + add tracking event =====
export const confirmReceiving = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { receivingId: string; location_zh?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: recv } = await supabaseAdmin
      .from("receivings")
      .select("id, batch_id, status, warehouse_code")
      .eq("id", data.receivingId)
      .maybeSingle();
    if (!recv) throw new Error("收货单不存在");
    if (!recv.batch_id) throw new Error("请先匹配批次");
    if (recv.status === "confirmed" || recv.status === "closed") throw new Error("收货单已确认");

    // 1. Batch → arrived
    await supabaseAdmin.from("batches").update({ status: "arrived" }).eq("id", recv.batch_id);
    // 2. Waybills under this batch → arrived (skip terminal/downstream)
    const { data: wbs } = await supabaseAdmin
      .from("waybills")
      .select("id, waybill_no, status")
      .eq("assigned_batch_id", recv.batch_id);
    // 跳过已是终态/下游状态的运单，既不改它们的 status，也不给它们补一条"已到达目的地
    // 仓库"的轨迹——否则一个已经 delivered/in_transit 的运单会在轨迹时间线上凭空多出一条
    // 排在后面的"到达"记录，跟它实际的状态倒挂。
    const updWbs = (wbs ?? []).filter((w) => !["delivered", "cancelled", "in_transit", "ready_pickup"].includes(w.status));
    if (updWbs.length) {
      const updIds = updWbs.map((w) => w.id);
      await supabaseAdmin.from("waybills").update({ status: "arrived" }).in("id", updIds);
      // 3. Add tracking event to each updated waybill
      const loc = data.location_zh || recv.warehouse_code || "目的地仓库";
      const now = new Date().toISOString();
      for (const w of updWbs) {
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
          status_zh: "已到达目的地仓库",
          status_en: "Arrived at destination warehouse",
          location_zh: loc,
          location_en: loc,
          event_time: now,
          source: "admin_action",
          source_ref: "receiving:" + data.receivingId,
        });
      }
    }
    // 4. Mark receiving confirmed
    await supabaseAdmin
      .from("receivings")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
      })
      .eq("id", data.receivingId);

    await recordAdminLog(supabaseAdmin, {
      entity_type: "receiving",
      entity_id: data.receivingId,
      action: "confirm",
      after: { batch_id: recv.batch_id, waybills_updated: updWbs.length },
      operator_id: context.userId,
    });

    return { ok: true, waybills_updated: updWbs.length };
  });

// ===== Update notes / warehouse / close =====
export const updateReceiving = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { receivingId: string; patch: { warehouse_code?: string | null; notes?: string | null; status?: string } }) =>
      d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("receivings").update(data.patch).eq("id", data.receivingId);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "receiving",
      entity_id: data.receivingId,
      action: "update",
      after: data.patch,
      operator_id: context.userId,
    });
    return { ok: true };
  });
