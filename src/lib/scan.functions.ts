import { routeInsuranceRate } from "./insurance-rate.server";
import { insuranceCad } from "./insurance";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { detectScanKind, type ScanKind } from "@/lib/scan-detect";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

// 扫码进出批次/箱/托盘会改变计入哪个批次的费用汇总——非致命：标脏失败不该挡住扫码本身，
// 最坏情况只是客户端快照没能及时标记过期。
async function safeMarkFeesDirty(admin: any, batchIds: (string | null | undefined)[]) {
  try {
    const { markBatchFeesDirtyMany } = await import("./orders.functions");
    await markBatchFeesDirtyMany(admin, batchIds);
  } catch (e) {
    console.error("markBatchFeesDirtyMany failed (scanAddToContainer):", e);
  }
}

// 箱号"当前实际所属批次"：在托盘里跟托盘走，否则用箱号自己的 batch_id。
async function resolveCartonEffectiveBatchId(
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

// Resolve a scanned code against cartons / pallets / batches / waybills regardless of prefix guess
async function resolveScanCode(
  supabaseAdmin: any,
  code: string,
  guess: ScanKind,
): Promise<ScanKind> {
  const check = async (kind: ScanKind) => {
    const table =
      kind === "carton" ? "cartons" : kind === "pallet" ? "pallets" : kind === "batch" ? "batches" : "waybills";
    const col =
      kind === "carton" ? "carton_no" : kind === "pallet" ? "pallet_no" : kind === "batch" ? "batch_no" : "waybill_no";
    const { data } = await supabaseAdmin.from(table).select("id").eq(col, code).maybeSingle();
    return !!data;
  };
  if (await check(guess)) return guess;
  for (const k of ["carton", "pallet", "batch", "waybill"] as const) {
    if (k !== guess && (await check(k))) return k;
  }
  return guess;
}


// ====== Unified scan-add: add waybill / carton / pallet code to a batch or pallet container ======
export const scanAddToContainer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { container: "batch" | "pallet" | "carton"; containerId: string; code: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code.trim();
    if (!code) throw new Error("空扫描");
    const kind = await resolveScanCode(supabaseAdmin, code, detectScanKind(code));
    if (kind === "batch") {
      throw new Error(`扫描到的是批次号 ${code}（批次不能加入容器），请改扫运单号 / 箱号 / 托盘号`);
    }
    const operatorName = await getOperatorName(supabaseAdmin, context.userId);

    const writeLog = async (rows: any[]) => {
      if (rows.length) await supabaseAdmin.from("admin_action_logs").insert(rows);
    };

    if (data.container === "batch") {
      const { data: b } = await supabaseAdmin
        .from("batches")
        .select("id, batch_no")
        .eq("id", data.containerId)
        .maybeSingle();
      if (!b) throw new Error("批次不存在");
      if (kind === "waybill") {
        let w: any = (
          await supabaseAdmin
            .from("waybills")
            .select("id, waybill_no, assigned_batch_id, order_id, forwarding_id")
            .eq("waybill_no", code)
            .maybeSingle()
        ).data;
        if (!w) {
          const { data: hit } = await supabaseAdmin.rpc("find_by_any_no", { _input: code });
          if (hit && (hit as any).kind === "waybill") {
            w = (
              await supabaseAdmin
                .from("waybills")
                .select("id, waybill_no, assigned_batch_id, order_id, forwarding_id")
                .eq("id", (hit as any).id)
                .maybeSingle()
            ).data;
          }
        }
        if (!w) throw new Error(`运单 ${code} 不存在`);
        if (w.assigned_batch_id === data.containerId) return { ok: true, kind, added: 0, info: `${code} 已在本批次` };
        await supabaseAdmin
          .from("waybills")
          .update({ assigned_batch_id: data.containerId, batch_no: b.batch_no })
          .eq("id", w.id);
        await safeMarkFeesDirty(supabaseAdmin, [w.assigned_batch_id, data.containerId]);
        await writeLog([
          {
            entity_type: "batch",
            entity_id: data.containerId,
            action: "scan_add_waybill",
            after: { waybill_id: w.id, waybill_no: w.waybill_no, batch_no: b.batch_no },
            operator_id: context.userId,
            operator_name: operatorName,
            note: `扫码加入运单 ${w.waybill_no}（批次 ${b.batch_no}）`,
          },
          {
            entity_type: "waybill",
            entity_id: w.id,
            action: "scan_add_to_batch",
            after: { batch_id: data.containerId, batch_no: b.batch_no },
            operator_id: context.userId,
            operator_name: operatorName,
            note: `运单 ${w.waybill_no} 扫码加入批次 ${b.batch_no}`,
          },
        ]);
        await autoSnapshotWaybillFees(supabaseAdmin, w.id, context.userId, operatorName, `扫码入批次 ${b.batch_no}`);
        return { ok: true, kind, added: 1, info: `运单 ${w.waybill_no} 已加入` };
      }
      if (kind === "carton") {
        const { data: c } = await supabaseAdmin
          .from("cartons")
          .select("id, carton_no, batch_id")
          .eq("carton_no", code)
          .maybeSingle();
        if (!c) throw new Error(`箱号 ${code} 不存在`);
        const oldCartonBatch = c.batch_id ?? null;
        await supabaseAdmin.from("cartons").update({ batch_id: data.containerId }).eq("id", c.id);
        const { data: wbs } = await supabaseAdmin.from("waybills").select("id").eq("carton_id", c.id);
        if (wbs?.length) {
          await supabaseAdmin
            .from("waybills")
            .update({ assigned_batch_id: data.containerId, batch_no: b.batch_no })
            .in(
              "id",
              wbs.map((w) => w.id),
            );
        }
        await safeMarkFeesDirty(supabaseAdmin, [oldCartonBatch, data.containerId]);
        await writeLog([
          {
            entity_type: "batch",
            entity_id: data.containerId,
            action: "scan_add_carton",
            after: { carton_id: c.id, carton_no: c.carton_no },
            operator_id: context.userId,
            operator_name: operatorName,
            note: `扫码加入箱号 ${c.carton_no}（批次 ${b.batch_no}）`,
          },
          {
            entity_type: "carton",
            entity_id: c.id,
            action: "scan_add_to_batch",
            after: { batch_id: data.containerId, batch_no: b.batch_no },
            operator_id: context.userId,
            operator_name: operatorName,
            note: `箱号 ${c.carton_no} 扫码加入批次 ${b.batch_no}`,
          },
        ]);
        return {
          ok: true,
          kind,
          added: wbs?.length ?? 0,
          info: `箱号 ${code} 已加入 (含 ${wbs?.length ?? 0} 单)`,
        };
      }
      // pallet — 仅挂托盘本身；托盘内子项不单独写入 batch_id
      const { data: p } = await supabaseAdmin
        .from("pallets")
        .select("id, pallet_no, batch_id")
        .eq("pallet_no", code)
        .maybeSingle();
      if (!p) throw new Error(`托盘 ${code} 不存在`);
      const oldPalletBatch = p.batch_id ?? null;
      await supabaseAdmin.from("pallets").update({ batch_id: data.containerId }).eq("id", p.id);
      await safeMarkFeesDirty(supabaseAdmin, [oldPalletBatch, data.containerId]);
      await writeLog([
        {
          entity_type: "batch",
          entity_id: data.containerId,
          action: "scan_add_pallet",
          after: { pallet_id: p.id, pallet_no: p.pallet_no },
          operator_id: context.userId,
          operator_name: operatorName,
          note: `扫码加入托盘 ${p.pallet_no}（批次 ${b.batch_no}）`,
        },
        {
          entity_type: "pallet",
          entity_id: p.id,
          action: "scan_add_to_batch",
          after: { batch_id: data.containerId, batch_no: b.batch_no },
          operator_id: context.userId,
          operator_name: operatorName,
          note: `托盘 ${p.pallet_no} 扫码加入批次 ${b.batch_no}`,
        },
      ]);
      return { ok: true, kind, added: 1, info: `托盘 ${code} 已加入` };
    }

    if (data.container === "pallet") {
      if (kind === "pallet") throw new Error("托盘内不能再加托盘");
      const palletParity = await childParityFor(supabaseAdmin, "pallet", data.containerId);
      if (kind === "waybill") {
        let w: any = (
          await supabaseAdmin
            .from("waybills")
            .select("id, pallet_id, carton_id, assigned_batch_id, waybill_no, order_id, forwarding_id")
            .eq("waybill_no", code)
            .maybeSingle()
        ).data;
        if (!w) {
          const { data: hit } = await supabaseAdmin.rpc("find_by_any_no", { _input: code });
          if (hit && (hit as any).kind === "waybill") {
            w = (
              await supabaseAdmin
                .from("waybills")
                .select("id, pallet_id, carton_id, assigned_batch_id, waybill_no, order_id, forwarding_id")
                .eq("id", (hit as any).id)
                .maybeSingle()
            ).data;
          }
        }
        if (!w) throw new Error(`运单 ${code} 不存在`);
        const wbParity = await childParityFor(supabaseAdmin, "waybill", w.id);
        assertParityMatch(palletParity, wbParity, `运单 ${w.waybill_no}`);
        const { data: pRow } = await supabaseAdmin
          .from("pallets")
          .select("pallet_no, batch_id")
          .eq("id", data.containerId)
          .maybeSingle();
        const { resolveWaybillBatchIds } = await import("./orders.functions");
        const oldWbBatchIds = await resolveWaybillBatchIds(supabaseAdmin, [w.id]);
        await supabaseAdmin.from("waybills").update({ pallet_id: data.containerId }).eq("id", w.id);
        await safeMarkFeesDirty(supabaseAdmin, [...oldWbBatchIds, (pRow as any)?.batch_id ?? null]);
        const logs: any[] = [
          {
            entity_type: "pallet",
            entity_id: data.containerId,
            action: "scan_add_waybill",
            after: { waybill_id: w.id, waybill_no: w.waybill_no },
            operator_id: context.userId,
            operator_name: operatorName,
            note: `扫码加入运单 ${w.waybill_no}（托盘 ${(pRow as any)?.pallet_no ?? ""}）`,
          },
          {
            entity_type: "waybill",
            entity_id: w.id,
            action: "scan_add_to_pallet",
            after: { pallet_id: data.containerId, pallet_no: (pRow as any)?.pallet_no },
            operator_id: context.userId,
            operator_name: operatorName,
            note: `运单 ${w.waybill_no} 扫码加入托盘 ${(pRow as any)?.pallet_no ?? ""}`,
          },
        ];
        if (w.order_id)
          logs.push({
            entity_type: "order",
            entity_id: w.order_id,
            action: "waybill_scan_add_to_pallet",
            after: { waybill_no: w.waybill_no, pallet_no: (pRow as any)?.pallet_no },
            operator_id: context.userId,
            operator_name: operatorName,
            note: `订单下运单 ${w.waybill_no} 扫码加入托盘 ${(pRow as any)?.pallet_no ?? ""}`,
          });
        if (w.forwarding_id)
          logs.push({
            entity_type: "forwarding",
            entity_id: w.forwarding_id,
            action: "waybill_scan_add_to_pallet",
            after: { waybill_no: w.waybill_no, pallet_no: (pRow as any)?.pallet_no },
            operator_id: context.userId,
            operator_name: operatorName,
            note: `集运单下运单 ${w.waybill_no} 扫码加入托盘 ${(pRow as any)?.pallet_no ?? ""}`,
          });
        await writeLog(logs);
        await autoSnapshotWaybillFees(
          supabaseAdmin,
          w.id,
          context.userId,
          operatorName,
          `扫码入托盘 ${(pRow as any)?.pallet_no ?? ""}`,
        );
        return { ok: true, kind, added: 1, info: `运单 ${w.waybill_no} 已加入` };
      }
      // carton
      const { data: c } = await supabaseAdmin
        .from("cartons")
        .select("id, carton_no, batch_id, pallet_id")
        .eq("carton_no", code)
        .maybeSingle();
      if (!c) throw new Error(`箱号 ${code} 不存在`);
      const cParity = await childParityFor(supabaseAdmin, "carton", c.id);
      assertParityMatch(palletParity, cParity, `箱号 ${c.carton_no}`);
      const { data: pRow } = await supabaseAdmin
        .from("pallets")
        .select("pallet_no, batch_id")
        .eq("id", data.containerId)
        .maybeSingle();
      const oldCartonBatch = await resolveCartonEffectiveBatchId(supabaseAdmin, c);
      await supabaseAdmin.from("cartons").update({ pallet_id: data.containerId }).eq("id", c.id);
      await safeMarkFeesDirty(supabaseAdmin, [oldCartonBatch, (pRow as any)?.batch_id ?? null]);
      await writeLog([
        {
          entity_type: "pallet",
          entity_id: data.containerId,
          action: "scan_add_carton",
          after: { carton_id: c.id, carton_no: c.carton_no },
          operator_id: context.userId,
          operator_name: operatorName,
          note: `扫码加入箱号 ${c.carton_no}（托盘 ${(pRow as any)?.pallet_no ?? ""}）`,
        },
        {
          entity_type: "carton",
          entity_id: c.id,
          action: "scan_add_to_pallet",
          after: { pallet_id: data.containerId, pallet_no: (pRow as any)?.pallet_no },
          operator_id: context.userId,
          operator_name: operatorName,
          note: `箱号 ${c.carton_no} 扫码加入托盘 ${(pRow as any)?.pallet_no ?? ""}`,
        },
      ]);
      return { ok: true, kind, added: 1, info: `箱号 ${code} 已加入` };
    }

    // container = carton — only waybills allowed
    if (kind !== "waybill") throw new Error("箱号内只能加入运单");
    let w: any = (
      await supabaseAdmin
        .from("waybills")
        .select("id, carton_id, pallet_id, assigned_batch_id, waybill_no, order_id, forwarding_id")
        .eq("waybill_no", code)
        .maybeSingle()
    ).data;
    if (!w) {
      const { data: hit } = await supabaseAdmin.rpc("find_by_any_no", { _input: code });
      if (hit && (hit as any).kind === "waybill") {
        w = (
          await supabaseAdmin
            .from("waybills")
            .select("id, carton_id, pallet_id, assigned_batch_id, waybill_no, order_id, forwarding_id")
            .eq("id", (hit as any).id)
            .maybeSingle()
        ).data;
      }
    }
    if (!w) throw new Error(`运单 ${code} 不存在`);
    if (w.carton_id === data.containerId) return { ok: true, kind, added: 0, info: `${code} 已在本箱` };
    const cartonParity = await childParityFor(supabaseAdmin, "carton", data.containerId);
    const wbParity = await childParityFor(supabaseAdmin, "waybill", w.id);
    assertParityMatch(cartonParity, wbParity, `运单 ${w.waybill_no}`);
    const { data: cRow } = await supabaseAdmin
      .from("cartons")
      .select("carton_no, batch_id, pallet_id")
      .eq("id", data.containerId)
      .maybeSingle();
    const { resolveWaybillBatchIds } = await import("./orders.functions");
    const oldWbBatchIds = await resolveWaybillBatchIds(supabaseAdmin, [w.id]);
    const newCartonBatch = await resolveCartonEffectiveBatchId(supabaseAdmin, cRow as any);
    await supabaseAdmin.from("waybills").update({ carton_id: data.containerId }).eq("id", w.id);
    await safeMarkFeesDirty(supabaseAdmin, [...oldWbBatchIds, newCartonBatch]);
    const logs: any[] = [
      {
        entity_type: "carton",
        entity_id: data.containerId,
        action: "scan_add_waybill",
        after: { waybill_id: w.id, waybill_no: w.waybill_no },
        operator_id: context.userId,
        operator_name: operatorName,
        note: `扫码加入运单 ${w.waybill_no}（箱号 ${(cRow as any)?.carton_no ?? ""}）`,
      },
      {
        entity_type: "waybill",
        entity_id: w.id,
        action: "scan_add_to_carton",
        after: { carton_id: data.containerId, carton_no: (cRow as any)?.carton_no },
        operator_id: context.userId,
        operator_name: operatorName,
        note: `运单 ${w.waybill_no} 扫码加入箱号 ${(cRow as any)?.carton_no ?? ""}`,
      },
    ];
    if (w.order_id)
      logs.push({
        entity_type: "order",
        entity_id: w.order_id,
        action: "waybill_scan_add_to_carton",
        after: { waybill_no: w.waybill_no, carton_no: (cRow as any)?.carton_no },
        operator_id: context.userId,
        operator_name: operatorName,
        note: `订单下运单 ${w.waybill_no} 扫码加入箱号 ${(cRow as any)?.carton_no ?? ""}`,
      });
    if (w.forwarding_id)
      logs.push({
        entity_type: "forwarding",
        entity_id: w.forwarding_id,
        action: "waybill_scan_add_to_carton",
        after: { waybill_no: w.waybill_no, carton_no: (cRow as any)?.carton_no },
        operator_id: context.userId,
        operator_name: operatorName,
        note: `集运单下运单 ${w.waybill_no} 扫码加入箱号 ${(cRow as any)?.carton_no ?? ""}`,
      });
    await writeLog(logs);
    await autoSnapshotWaybillFees(
      supabaseAdmin,
      w.id,
      context.userId,
      operatorName,
      `扫码入箱号 ${(cRow as any)?.carton_no ?? ""}`,
    );
    return { ok: true, kind, added: 1, info: `运单 ${w.waybill_no} 已加入` };
  });

// ====== Intake scan: search by waybill / order_no / request_no / domestic tracking ======
// Returns `via` per candidate:
//   - "order_no"  → 电商订单号精确匹配 → 自动按已有运单收件 + 打印
//   - "request_no"→ 集运订单号精确匹配 → 手动输入箱数生成运单
//   - "domestic"  → 国内单号 (精确/模糊) → 手动输入箱数 (走集运流程)
export const intakeScanSearch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { code: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code.trim();
    if (!code) throw new Error("空扫描");

    const ordCols =
      "id, order_no, customer_code, status, payment_status, domestic_tracking_no, box_count, route_code, destination_code, shipping_method, user_id, note, buyer_note";
    const foCols =
      "id, request_no, customer_code, status, payment_status, domestic_tracking_no, box_count, route_code, destination_code, shipping_method, warehouse, user_id, items_desc, intake_at, note";

    // helper: enrich waybill with parent customer note for prominent display
    const enrichWaybill = async (wb: any) => {
      let note: string | null = null;
      let buyer_note: string | null = null;
      let customer_code: string | null = null;
      if (wb?.order_id) {
        const { data: o } = await supabaseAdmin
          .from("orders")
          .select("note, buyer_note, customer_code, order_no")
          .eq("id", wb.order_id)
          .maybeSingle();
        note = (o as any)?.note ?? null;
        buyer_note = (o as any)?.buyer_note ?? null;
        customer_code = (o as any)?.customer_code ?? null;
        return {
          ...wb,
          parent_note: note,
          parent_buyer_note: buyer_note,
          customer_code,
          parent_no: (o as any)?.order_no ?? null,
          parent_kind: "order",
        };
      }
      if (wb?.forwarding_id) {
        const { data: f } = await supabaseAdmin
          .from("forwarding_orders")
          .select("note, customer_code, request_no")
          .eq("id", wb.forwarding_id)
          .maybeSingle();
        note = (f as any)?.note ?? null;
        customer_code = (f as any)?.customer_code ?? null;
        return {
          ...wb,
          parent_note: note,
          parent_buyer_note: null,
          customer_code,
          parent_no: (f as any)?.request_no ?? null,
          parent_kind: "forwarding",
        };
      }
      return {
        ...wb,
        parent_note: null,
        parent_buyer_note: null,
        customer_code: null,
        parent_no: null,
        parent_kind: null,
      };
    };

    // 1) Waybill exact (own number) → return as waybill match (auto-receive on UI)
    const { data: wbExact } = await supabaseAdmin
      .from("waybills")
      .select("id, waybill_no, status, order_id, forwarding_id, user_id, weight_kg, shipping_method")
      .eq("waybill_no", code)
      .maybeSingle();
    if (wbExact) {
      return { match: "waybill" as const, waybill: await enrichWaybill(wbExact), candidates: [] };
    }

    // 2) find_by_any_no covers waybill aliases / order_no / request_no (ignores route/dest segments + history aliases)
    try {
      const { data: hit } = await supabaseAdmin.rpc("find_by_any_no", { _input: code });
      if (hit) {
        const h = hit as any;
        if (h.kind === "waybill") {
          const { data: wb } = await supabaseAdmin
            .from("waybills")
            .select("id, waybill_no, status, order_id, forwarding_id, user_id, weight_kg, shipping_method")
            .eq("id", h.id)
            .maybeSingle();
          if (wb) return { match: "waybill" as const, waybill: await enrichWaybill(wb), candidates: [] };
        }
        if (h.kind === "order") {
          const { data: o } = await supabaseAdmin.from("orders").select(ordCols).eq("id", h.id).maybeSingle();
          if (o)
            return {
              match: "exact" as const,
              candidates: [
                {
                  kind: "order" as const,
                  ...(o as any),
                  display_no: (o as any).order_no,
                  via: "order_no",
                  similarity: 1,
                },
              ],
            };
        }
        if (h.kind === "forwarding") {
          const { data: f } = await supabaseAdmin.from("forwarding_orders").select(foCols).eq("id", h.id).maybeSingle();
          if (f)
            return {
              match: "exact" as const,
              candidates: [
                {
                  kind: "forwarding" as const,
                  ...(f as any),
                  display_no: (f as any).request_no,
                  via: "request_no",
                  similarity: 1,
                },
              ],
            };
        }
      }
    } catch {
      /* RPC missing — fall through */
    }

    // Enrich with existing waybills so UI prefills box_count = existing count
    const enrichExisting = async (kind: "order" | "forwarding", id: string) => {
      const fk = kind === "order" ? "order_id" : "forwarding_id";
      const { data: wbs } = await supabaseAdmin.from("waybills").select("id, waybill_no, status").eq(fk, id);
      return { existing_waybills: wbs ?? [], existing_waybill_count: wbs?.length ?? 0 };
    };

    // 3) Domestic tracking exact → 走集运流程 (手动输入箱数)
    const [ordExact, foExact] = await Promise.all([
      supabaseAdmin.from("orders").select(ordCols).eq("domestic_tracking_no", code).limit(5),
      supabaseAdmin.from("forwarding_orders").select(foCols).eq("domestic_tracking_no", code).limit(5),
    ]);
    const exactOrders = (ordExact.data ?? []) as any[];
    const exactFos = (foExact.data ?? []) as any[];
    if (exactOrders.length || exactFos.length) {
      const cands = await Promise.all([
        ...exactOrders.map(async (o: any) => {
          const e = await enrichExisting("order", o.id);
          return {
            kind: "order" as const,
            ...o,
            display_no: o.order_no,
            via: "domestic",
            similarity: 1,
            ...e,
            box_count: e.existing_waybill_count > 0 ? e.existing_waybill_count : o.box_count,
          };
        }),
        ...exactFos.map(async (f: any) => {
          const e = await enrichExisting("forwarding", f.id);
          return {
            kind: "forwarding" as const,
            ...f,
            display_no: f.request_no,
            via: "domestic",
            similarity: 1,
            ...e,
            box_count: e.existing_waybill_count > 0 ? e.existing_waybill_count : f.box_count,
          };
        }),
      ]);
      return { match: "exact" as const, candidates: cands };
    }

    // 4) Fuzzy fallback on domestic tracking → 同样走集运流程
    const [o, f] = await Promise.all([
      supabaseAdmin.from("orders").select(ordCols).ilike("domestic_tracking_no", `%${code}%`).limit(5),
      supabaseAdmin.from("forwarding_orders").select(foCols).ilike("domestic_tracking_no", `%${code}%`).limit(5),
    ]);
    const pool: any[] = [
      ...((o.data ?? []) as any[]).map((x: any) => ({
        kind: "order",
        ...x,
        display_no: x.order_no,
        via: "domestic",
        similarity: 0.5,
      })),
      ...((f.data ?? []) as any[]).map((x: any) => ({
        kind: "forwarding",
        ...x,
        display_no: x.request_no,
        via: "domestic",
        similarity: 0.5,
      })),
    ];
    const enrichedPool = await Promise.all(
      pool.map(async (c: any) => {
        const e = await enrichExisting(c.kind, c.id);
        return {
          ...c,
          ...e,
          box_count: e.existing_waybill_count > 0 ? e.existing_waybill_count : c.box_count,
        };
      }),
    );
    return { match: "fuzzy" as const, candidates: enrichedPool.slice(0, 5) };
  });

// ====== E-commerce order intake: receive all existing waybills, no box-count prompt ======
export const intakeScanReceiveOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { orderId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin
      .from("orders")
      .select("id, order_no, shipping_method, warehouse, pickup_warehouse, domestic_tracking_no")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) throw new Error("订单不存在");
    const { data: wbs } = await supabaseAdmin
      .from("waybills")
      .select("id, waybill_no, status, order_id, forwarding_id, shipping_method")
      .eq("order_id", data.orderId);
    if (!wbs?.length) throw new Error(`订单 ${(order as any).order_no} 暂无运单，无法直接收件。请先生成运单。`);

    const warehouseName: string | null = (order as any).warehouse ?? (order as any).pickup_warehouse ?? null;
    const operatorName = await getOperatorName(supabaseAdmin, context.userId);
    const isStorage = (order as any).shipping_method === "storage";
    const newStatus = isStorage ? "storage" : "received";
    const ids = (wbs as any[]).map((w) => w.id);
    await supabaseAdmin.from("waybills").update({ status: newStatus }).in("id", ids);
    for (const w of wbs as any[]) {
      await writeReceivedEvent(supabaseAdmin, w, warehouseName, operatorName, context.userId, isStorage);
    }
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "order",
      entity_id: data.orderId,
      action: "intake_received",
      after: {
        warehouse: warehouseName,
        waybills: (wbs as any[]).map((w) => w.waybill_no),
        auto: true,
      },
      operator_id: context.userId,
      operator_name: operatorName,
      note: `入库扫描(电商订单): ${(order as any).order_no} 已有 ${wbs.length} 个运单全部收件`,
    });
    if ((order as any).domestic_tracking_no) {
      await supabaseAdmin
        .from("detained_packages")
        .update({
          status: "released",
          intake_parent_kind: "order",
          intake_parent_id: data.orderId,
          intake_waybill_ids: ids,
          released_at: new Date().toISOString(),
          released_by: context.userId,
        })
        .eq("domestic_tracking_no", (order as any).domestic_tracking_no)
        .eq("status", "detained");
    }
    return { ok: true, waybills: wbs, parentNo: (order as any).order_no };
  });

// ====== Helper: write '仓库已收件' (+ '仓储中' when storage route) tracking events + admin log ======
async function writeReceivedEvent(
  supabaseAdmin: any,
  waybill: {
    id: string;
    waybill_no: string;
    order_id?: string | null;
    forwarding_id?: string | null;
  },
  warehouseName: string | null,
  operatorName: string,
  operatorId: string,
  isStorage: boolean = false,
) {
  let { data: ship } = await supabaseAdmin
    .from("shipments")
    .select("id")
    .eq("tracking_no", waybill.waybill_no)
    .maybeSingle();
  if (!ship) {
    const { data: s2 } = await supabaseAdmin
      .from("shipments")
      .insert({ tracking_no: waybill.waybill_no, status: "created" })
      .select("id")
      .single();
    ship = s2;
  }
  if (ship) {
    const wh = warehouseName || "集运仓";
    const now = new Date();
    const events: any[] = [
      {
        shipment_id: ship.id,
        status_zh: `仓库已收件 — ${wh} / 操作员 ${operatorName}`,
        status_en: `Received at warehouse — ${wh} / by ${operatorName}`,
        location_zh: wh,
        location_en: wh,
        event_time: now.toISOString(),
        source: "admin_action",
        source_ref: operatorId,
      },
    ];
    if (isStorage)
      events.push({
        shipment_id: ship.id,
        status_zh: "仓储中",
        status_en: "In storage",
        location_zh: wh,
        location_en: wh,
        event_time: new Date(now.getTime() + 1000).toISOString(),
        source: "admin_action",
        source_ref: operatorId,
      });
    await supabaseAdmin.from("tracking_events").insert(events);
  }
  await supabaseAdmin.from("admin_action_logs").insert({
    entity_type: "waybill",
    entity_id: waybill.id,
    action: "intake_received",
    after: { warehouse: warehouseName, waybill_no: waybill.waybill_no, storage: isStorage },
    operator_id: operatorId,
    operator_name: operatorName,
    note: `入库扫描收件: ${waybill.waybill_no} @ ${warehouseName || "集运仓"}${isStorage ? " · 进入仓储" : ""}`,
  });
}

async function getOperatorName(supabaseAdmin: any, userId: string): Promise<string> {
  const { data } = await supabaseAdmin.from("profiles").select("full_name, email").eq("id", userId).maybeSingle();
  return (data as any)?.full_name || (data as any)?.email || userId.slice(0, 8);
}

// ====== Direct waybill intake (scanned waybill number) ======
export const intakeScanReceiveWaybill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { waybillId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wb } = await supabaseAdmin
      .from("waybills")
      .select("id, waybill_no, status, order_id, forwarding_id, shipping_method")
      .eq("id", data.waybillId)
      .maybeSingle();
    if (!wb) throw new Error("运单不存在");

    // Resolve warehouse: from forwarding_orders.warehouse if present
    let warehouseName: string | null = null;
    if ((wb as any).forwarding_id) {
      const { data: f } = await supabaseAdmin
        .from("forwarding_orders")
        .select("warehouse")
        .eq("id", (wb as any).forwarding_id)
        .maybeSingle();
      warehouseName = (f as any)?.warehouse ?? null;
    }
    const operatorName = await getOperatorName(supabaseAdmin, context.userId);

    const isStorage = (wb as any).shipping_method === "storage";
    const newStatus = isStorage ? "storage" : "received";
    await supabaseAdmin
      .from("waybills")
      .update({ status: newStatus })
      .eq("id", (wb as any).id);
    await writeReceivedEvent(supabaseAdmin, wb as any, warehouseName, operatorName, context.userId, isStorage);
    return { ok: true, waybill: wb };
  });

// Generate N waybills for a parent (auto on intake)
export const intakeScanCommit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      parentKind: "order" | "forwarding";
      parentId: string;
      boxCount: number;
      weightPerBox?: number;
      // true = 已入库过一次（运单已推进到 pending 之后的状态）的二次触碰场景：
      // 删掉现有运单，按新填的箱数重新生成，而不是直接复用现有的。
      overwrite?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const n = Math.max(1, Math.min(200, Math.floor(data.boxCount || 1)));
    const table = data.parentKind === "order" ? "orders" : "forwarding_orders";
    const fk = data.parentKind === "order" ? "order_id" : "forwarding_id";
    const { data: parent } = await supabaseAdmin.from(table).select("*").eq("id", data.parentId).maybeSingle();
    if (!parent) throw new Error("Parent not found");

    const isStorage = parent.shipping_method === "storage";

    // If parent already has waybills → receive existing ones instead of creating duplicates
    // (除非调用方明确要求 overwrite 覆盖重建)
    const { data: existing } = await supabaseAdmin
      .from("waybills")
      .select("id, waybill_no, status, order_id, forwarding_id, shipping_method, weight_kg, pallet_id, carton_id, assigned_batch_id")
      .eq(fk, data.parentId);

    if (data.overwrite && existing && existing.length > 0) {
      // 覆盖重建有真实丢数据的风险：任何一张运单只要已经称重/装箱/装托/入批次，
      // 说明它已经被后续流程实际使用过，拒绝删除，让操作员改用其它方式处理。
      const blockers = (existing as any[]).filter(
        (w) => w.weight_kg != null || w.pallet_id != null || w.carton_id != null || w.assigned_batch_id != null,
      );
      if (blockers.length) {
        throw new Error(
          `无法覆盖重建：运单 ${blockers.map((w) => w.waybill_no).join("、")} 已称重/装箱/装托/入批次，请改用其它方式处理`,
        );
      }
      const { error: delErr } = await supabaseAdmin
        .from("waybills")
        .delete()
        .in(
          "id",
          (existing as any[]).map((w) => w.id),
        );
      if (delErr) throw new Error(`覆盖重建失败: ${delErr.message}`);
      const operatorName = await getOperatorName(supabaseAdmin, context.userId);
      await supabaseAdmin.from("admin_action_logs").insert({
        entity_type: data.parentKind,
        entity_id: data.parentId,
        action: "intake_overwrite_rebuild",
        after: { removed_waybill_numbers: (existing as any[]).map((w) => w.waybill_no), new_box_count: n },
        operator_id: context.userId,
        operator_name: operatorName,
        note: `入库扫描: 覆盖重建，删除旧运单 ${(existing as any[]).map((w) => w.waybill_no).join("、")}，按 ${n} 箱重新生成`,
      });
      // 落到下方"没有已有运单"的生成分支，重新按 n 箱生成。
    } else if (existing && existing.length > 0) {
      const warehouseName: string | null = (parent as any).warehouse ?? (parent as any).pickup_warehouse ?? null;
      const operatorName = await getOperatorName(supabaseAdmin, context.userId);
      const newStatus = isStorage ? "storage" : "received";
      const ids = (existing as any[]).map((w) => w.id);
      await supabaseAdmin.from("waybills").update({ status: newStatus }).in("id", ids);
      for (const w of existing as any[]) {
        await writeReceivedEvent(supabaseAdmin, w, warehouseName, operatorName, context.userId, isStorage);
      }
      await supabaseAdmin.from("admin_action_logs").insert({
        entity_type: data.parentKind,
        entity_id: data.parentId,
        action: "intake_received",
        after: {
          warehouse: warehouseName,
          waybills: (existing as any[]).map((w) => w.waybill_no),
          auto: true,
          reused_existing: true,
        },
        operator_id: context.userId,
        operator_name: operatorName,
        note: `入库扫描: 复用已有 ${existing.length} 个运单 @ ${warehouseName || "集运仓"}`,
      });
      // Update parent status → received (from pending/draft)
      if (data.parentKind === "forwarding") {
        await supabaseAdmin
          .from("forwarding_orders")
          .update({
            intake_at: new Date().toISOString(),
            intake_by: context.userId,
            box_count: existing.length,
            status:
              (parent as any).status === "pending" || (parent as any).status === "draft"
                ? "received"
                : (parent as any).status,
          })
          .eq("id", data.parentId);
      } else {
        await supabaseAdmin
          .from("orders")
          .update({
            box_count: existing.length,
            status:
              (parent as any).status === "pending" || (parent as any).status === "draft"
                ? "received"
                : (parent as any).status,
          })
          .eq("id", data.parentId);
      }
      if ((parent as any).domestic_tracking_no) {
        await supabaseAdmin
          .from("detained_packages")
          .update({
            status: "released",
            intake_parent_kind: data.parentKind,
            intake_parent_id: data.parentId,
            intake_waybill_ids: ids,
            released_at: new Date().toISOString(),
            released_by: context.userId,
          })
          .eq("domestic_tracking_no", (parent as any).domestic_tracking_no)
          .eq("status", "detained");
      }
      try {
        const { persistWaybillItems } = await import("./duty.server");
        for (const w of existing as any[]) await persistWaybillItems(supabaseAdmin, w.id);
      } catch (e) {
        console.error("persistWaybillItems failed (intakeScanCommit reuse)", e);
      }
      return {
        ok: true,
        waybills: existing,
        parentNo: (parent as any).order_no ?? (parent as any).request_no,
        reused: true,
      };
    }

    // Compose items_summary per waybill: each parent item recorded separately with original quantity
    let itemsSummary: any[] = [];
    if (data.parentKind === "forwarding") {
      const { data: fis } = await supabaseAdmin
        .from("forwarding_items")
        .select("name, quantity, unit_price_cny, extras")
        .eq("forwarding_id", data.parentId);
      itemsSummary = (fis ?? []).map((it: any) => ({
        name: it.name,
        quantity: it.quantity,
        unit_price_cny: Number(it.unit_price_cny ?? 0),
        extras: it.extras ?? null,
      }));
    } else {
      const { data: ois } = await supabaseAdmin
        .from("order_items")
        .select("name_zh, name_en, quantity, unit_price_cny, sku, attrs_snapshot")
        .eq("order_id", data.parentId);
      itemsSummary = (ois ?? []).map((it: any) => ({
        name: it.name_zh || it.name_en,
        quantity: it.quantity,
        unit_price_cny: Number(it.unit_price_cny ?? 0),
        sku: it.sku ?? null,
        attrs: it.attrs_snapshot ?? null,
      }));
    }

    const rows = Array.from({ length: n }, () => ({
      [fk]: data.parentId,
      user_id: parent.user_id,
      shipping_method: parent.shipping_method,
      status: (isStorage ? "storage" : "received") as any,
      weight_kg: data.weightPerBox ?? null,
      items_summary: itemsSummary,
    }));
    const { data: ins, error } = await supabaseAdmin
      .from("waybills")
      .insert(rows as any)
      .select("id, waybill_no, shipping_method");
    if (error) throw new Error(error.message);

    // Tracking events: '运单已生成' + '仓库已收件' (+ '仓储中' when storage route) — all written immediately.
    const warehouseName: string | null = (parent as any).warehouse ?? (parent as any).pickup_warehouse ?? null;
    const operatorName = await getOperatorName(supabaseAdmin, context.userId);
    const wh = warehouseName || "集运仓";
    const now = new Date();
    for (const w of (ins ?? []) as any[]) {
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
      if (!ship) continue;
      const events: any[] = [
        {
          shipment_id: ship.id,
          status_zh: "运单已生成/记录",
          status_en: "Waybill created / recorded",
          location_zh: wh,
          location_en: wh,
          event_time: new Date(now.getTime() - 1000).toISOString(),
          source: "admin_action",
          source_ref: context.userId,
        },
        {
          shipment_id: ship.id,
          status_zh: `仓库已收件 — ${wh} / 操作员 ${operatorName}`,
          status_en: `Received at warehouse — ${wh} / by ${operatorName}`,
          location_zh: wh,
          location_en: wh,
          event_time: now.toISOString(),
          source: "admin_action",
          source_ref: context.userId,
        },
      ];
      if (isStorage)
        events.push({
          shipment_id: ship.id,
          status_zh: "仓储中",
          status_en: "In storage",
          location_zh: wh,
          location_en: wh,
          event_time: new Date(now.getTime() + 1000).toISOString(),
          source: "admin_action",
          source_ref: context.userId,
        });
      await supabaseAdmin.from("tracking_events").insert(events);
    }

    // admin action log for the parent intake
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: data.parentKind,
      entity_id: data.parentId,
      action: "intake_received",
      after: {
        box_count: n,
        warehouse: warehouseName,
        waybills: (ins ?? []).map((w: any) => w.waybill_no),
        storage: isStorage,
      },
      operator_id: context.userId,
      operator_name: operatorName,
      note: `入库扫描: 生成 ${n} 个运单 @ ${wh}${isStorage ? " · 进入仓储" : ""}`,
    });

    // mark parent status + intake_at
    const newParentStatus =
      (parent as any).status === "pending" || (parent as any).status === "draft" ? "received" : (parent as any).status;
    if (data.parentKind === "forwarding") {
      await supabaseAdmin
        .from("forwarding_orders")
        .update({
          intake_at: new Date().toISOString(),
          intake_by: context.userId,
          box_count: n,
          status: newParentStatus,
        })
        .eq("id", data.parentId);
    } else {
      await supabaseAdmin.from("orders").update({ box_count: n, status: newParentStatus }).eq("id", data.parentId);
    }

    // mark any detained entry as released
    if (parent.domestic_tracking_no) {
      await supabaseAdmin
        .from("detained_packages")
        .update({
          status: "released",
          intake_parent_kind: data.parentKind,
          intake_parent_id: data.parentId,
          intake_waybill_ids: (ins ?? []).map((w: any) => w.id),
          released_at: new Date().toISOString(),
          released_by: context.userId,
        })
        .eq("domestic_tracking_no", parent.domestic_tracking_no)
        .eq("status", "detained");
    }

    try {
      const { persistWaybillItems } = await import("./duty.server");
      for (const w of (ins ?? []) as any[]) await persistWaybillItems(supabaseAdmin, w.id);
    } catch (e) {
      console.error("persistWaybillItems failed (intakeScanCommit generate)", e);
    }

    return {
      ok: true,
      waybills: ins ?? [],
      parentNo: (parent as any).order_no ?? (parent as any).request_no,
    };
  });

export const markDetained = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { code: string; customer_code?: string; note?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ins, error } = await supabaseAdmin
      .from("detained_packages")
      .insert({
        domestic_tracking_no: data.code.trim(),
        customer_code: data.customer_code ?? null,
        note: data.note ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    const operatorName = await getOperatorName(supabaseAdmin, context.userId);
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "detained_package",
      entity_id: ins.id,
      action: "mark_detained",
      after: { domestic_tracking_no: ins.domestic_tracking_no, customer_code: data.customer_code },
      operator_id: context.userId,
      operator_name: operatorName,
      note: data.note ?? undefined,
    });
    return { ok: true, item: ins };
  });

export const listDetained = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string; status?: string; page?: number; pageSize?: number }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, data.pageSize ?? 25);
    let q = supabaseAdmin
      .from("detained_packages")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.search?.trim()) {
      const s = data.search.trim();
      q = q.or(`domestic_tracking_no.ilike.%${s}%,customer_code.ilike.%${s}%`);
    }
    const { data: rows, error, count } = await q.range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new Error(error.message);
    const userIds = Array.from(
      new Set((rows ?? []).flatMap((r: any) => [r.created_by, r.released_by]).filter((v): v is string => !!v)),
    );
    const profs = userIds.length
      ? ((await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", userIds)).data ?? [])
      : [];
    const pMap = new Map((profs as any[]).map((p) => [p.id, p]));
    const items = (rows ?? []).map((r: any) => ({
      ...r,
      created_by_name: r.created_by
        ? pMap.get(r.created_by)?.full_name || pMap.get(r.created_by)?.email || r.created_by.slice(0, 8)
        : null,
      released_by_name: r.released_by
        ? pMap.get(r.released_by)?.full_name || pMap.get(r.released_by)?.email || r.released_by.slice(0, 8)
        : null,
    }));
    return { items, total: count ?? 0, page, pageSize };
  });

// Multi-label data for a list of waybill ids — used right after intake to print all generated labels
export const getWaybillsLabelData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { waybillIds: string[] }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wbs } = await supabaseAdmin
      .from("waybills")
      .select("id, waybill_no, mark_no, weight_kg, order_id, forwarding_id, user_id")
      .in("id", data.waybillIds);
    if (!wbs?.length) return { items: [] };

    // gather parent + user info
    const orderIds = wbs.map((w) => w.order_id).filter((v): v is string => !!v);
    const foIds = wbs.map((w) => w.forwarding_id).filter((v): v is string => !!v);
    const userIds = Array.from(new Set(wbs.map((w) => w.user_id).filter((v): v is string => !!v)));
    const [orders, fos, users] = await Promise.all([
      orderIds.length
        ? supabaseAdmin.from("orders").select("id, order_no, customer_code, user_id").in("id", orderIds)
        : Promise.resolve({ data: [] as any[] }),
      foIds.length
        ? supabaseAdmin
            .from("forwarding_orders")
            .select("id, request_no, customer_code, items_desc, user_id")
            .in("id", foIds)
        : Promise.resolve({ data: [] as any[] }),
      userIds.length
        ? supabaseAdmin.from("profiles").select("id, full_name, phone, customer_code").in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const oMap = new Map((orders.data ?? []).map((o: any) => [o.id, o]));
    const fMap = new Map((fos.data ?? []).map((f: any) => [f.id, f]));
    const uMap = new Map((users.data ?? []).map((u: any) => [u.id, u]));

    // addresses keyed by user (default)
    const addrs = userIds.length
      ? ((await supabaseAdmin.from("addresses").select("*").in("user_id", userIds)).data ?? [])
      : [];
    const aMap = new Map<string, any>();
    for (const a of addrs as any[]) {
      const cur = aMap.get(a.user_id);
      if (!cur || a.is_default) aMap.set(a.user_id, a);
    }

    const items = wbs.map((w) => {
      const parent: any = w.order_id ? oMap.get(w.order_id) : w.forwarding_id ? fMap.get(w.forwarding_id) : null;
      const u = w.user_id ? uMap.get(w.user_id) : null;
      const a = w.user_id ? aMap.get(w.user_id) : null;
      return {
        entityType: w.order_id ? "order" : "forwarding",
        entityNo: parent?.order_no ?? parent?.request_no ?? w.waybill_no,
        parent,
        waybills: [
          {
            waybill_no: w.waybill_no,
            weight_kg: w.weight_kg,
            items_name: parent?.items_desc ?? null,
            mark_no: (w as any).mark_no ?? parent?.mark_no ?? null,
          },
        ],
        user: u,
        address: a,
        total: 1,
      };
    });
    return { items };
  });

// Compute CAD fees for a single waybill using its parent's route/declared value + waybill dims.
// Used by measureSaveDims + scanAddToContainer to auto-populate waybill fee columns
// and roll up to order/forwarding snapshots.
//
// 算法 (CAD):
//   chargeable_kg = max(实重, 材积重)   材积重 = L*W*H / volumetric_divisor
//   freight_cad   = max(chargeable × unit_price_cad, min_charge_cad)
//   duty_cad      = declared_cad × customs_rate_pct%   (仅当 customs.enabled 且 declared ≥ threshold)
//   insurance_cad = declared_cad × insurance_rate_pct%
//   clearance_cad = 线路规则的清关费 (每单)
//   fx (CAD/CNY) 从 app_settings.fx_rate 读取；CNY 单价 × fx = CAD。
//   电商 declared_cad = subtotal_cny × fx (系统汇率, 不用硬编码 0.19)
export async function computeWaybillFeesCad(admin: any, wb: any) {
  const { getFxCadPerCny } = await import("./orders.functions");
  const fx = await getFxCadPerCny(admin);
  let route_id: string | null = null;
  let declared_cad = 0;
  let insured = !!wb.order_id; // Shop pricing remains unchanged.
  if (wb.order_id) {
    const { data: ord } = await admin
      .from("orders")
      .select("route_id, subtotal_cny")
      .eq("id", wb.order_id)
      .maybeSingle();
    route_id = ord?.route_id ?? null;
    // 电商订单: 用系统汇率将 subtotal_cny → declared_cad
    declared_cad = +(Number(ord?.subtotal_cny ?? 0) * fx).toFixed(2);
  } else if (wb.forwarding_id) {
    const { data: fo } = await admin
      .from("forwarding_orders")
      .select("route_id, declared_value_cad, box_count, insured")
      .eq("id", wb.forwarding_id)
      .maybeSingle();
    if (!fo) throw new Error("无法核对投保状态，请重试");
    insured = fo.insured === true;
    route_id = fo.route_id ?? null;
    // 集运单: 每张运单声明价 = 该运单包含物品数量 × 单价 (from forwarding_items)
    // 若 items_summary 缺失, 回落到 forwarding 总声明价 / 箱数
    const { computeWaybillDeclaredCad } = await import("./orders.functions");
    const { data: fi } = await admin
      .from("forwarding_items")
      .select("name, unit_price_cad, unit_price_cny")
      .eq("forwarding_id", wb.forwarding_id);
    const priceMap = new Map<string, { cad: number; cny: number }>();
    for (const r of fi ?? [])
      if ((r as any)?.name)
        priceMap.set((r as any).name, {
          cad: Number((r as any).unit_price_cad ?? 0),
          cny: Number((r as any).unit_price_cny ?? 0),
        });
    const perWb = computeWaybillDeclaredCad(wb.items_summary, priceMap, fx);
    if (perWb > 0) {
      declared_cad = perWb;
    } else {
      const boxes = Math.max(Number(fo?.box_count ?? 1) || 1, 1);
      declared_cad = +(Number(fo?.declared_value_cad ?? 0) / boxes).toFixed(2);
    }
  }
  if (!route_id)
    return {
      freight_cad: 0,
      duty_cad: 0,
      insurance_cad: 0,
      clearance_cad: 0,
      chargeable_kg: 0,
      route_id: null as string | null,
      fx,
    };
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
  if (!rule)
    return {
      freight_cad: 0,
      duty_cad: 0,
      insurance_cad: 0,
      clearance_cad: 0,
      chargeable_kg: 0,
      route_id,
      fx,
    };
  const w = Math.max(0, Number(wb.weight_kg ?? 0));
  const L = Number(wb.length_cm ?? 0),
    W = Number(wb.width_cm ?? 0),
    H = Number(wb.height_cm ?? 0);
  const divisor = Number(rule.volumetric_divisor) || 6000;
  const volW = divisor > 0 ? (L * W * H) / divisor : 0;
  const chargeable = rule.weight_mode === "actual" ? w : rule.weight_mode === "volumetric" ? volW : Math.max(w, volW);
  const unit_cad = Number(rule.unit_price_cad ?? 0) || Number(rule.unit_price_cny ?? 0) * fx;
  // 运单级最低收费 / 清关费：每张运单各判断一次（批次级另行结算）
  const min_cad = Number(rule.min_charge_waybill_cad ?? 0);
  const clearance_cad = Number(rule.clearance_fee_waybill_cad ?? 0);

  let freight_cad = +(chargeable * unit_cad).toFixed(2);
  if (freight_cad < min_cad) freight_cad = +min_cad.toFixed(2);
  // 关税 —— 统一走 HS 明细口径 (mfn+gst+反倾销)；customs_rules.rate_pct 已弃用，只用 enabled/threshold
  let duty_cad = 0;
  if (wb.forwarding_id) {
    const { computeWaybillDutyBreakdown } = await import("./duty.server");
    const br = await computeWaybillDutyBreakdown(admin, wb);
    duty_cad = br.duty_cad;
  } else if (customs?.enabled && declared_cad >= Number(customs.threshold_cad ?? 0)) {
    // 电商订单（无 forwarding_id）暂沿用线路 rate_pct，避免影响商城
    duty_cad = +(declared_cad * (Number(customs.rate_pct ?? 0) / 100)).toFixed(2);
  }
  const ins_rate = await routeInsuranceRate(admin, route_id, rule.insurance_rate_pct);
  const insurance_cad = insuranceCad(declared_cad, ins_rate, insured);
  return {
    freight_cad,
    duty_cad,
    insurance_cad,
    clearance_cad: +clearance_cad.toFixed(2),
    chargeable_kg: +chargeable.toFixed(3),
    route_id,
    fx,
  };
}

// Recompute + snapshot fees on a waybill if it has dims + weight. Logs to admin_action_logs.
// Called from scanAddToContainer (scan → carton/pallet/batch) so fees are always up to date.
export async function autoSnapshotWaybillFees(
  admin: any,
  waybillId: string,
  operatorId: string,
  operatorName: string,
  ctx: string,
) {
  const { data: wb } = await admin
    .from("waybills")
    .select(
      "id, waybill_no, order_id, forwarding_id, length_cm, width_cm, height_cm, weight_kg, freight_cad, duty_cad, insurance_cad, clearance_cad",
    )
    .eq("id", waybillId)
    .maybeSingle();
  if (!wb) return null;
  const hasDims =
    Number(wb.weight_kg ?? 0) > 0 &&
    Number(wb.length_cm ?? 0) > 0 &&
    Number(wb.width_cm ?? 0) > 0 &&
    Number(wb.height_cm ?? 0) > 0;
  if (!hasDims) return null;
  try {
    const fees = await computeWaybillFeesCad(admin, wb);
    if (!fees.route_id) return null;
    const before = {
      freight_cad: wb.freight_cad,
      duty_cad: wb.duty_cad,
      insurance_cad: wb.insurance_cad,
      clearance_cad: wb.clearance_cad,
    };
    const after = {
      freight_cad: fees.freight_cad,
      duty_cad: fees.duty_cad,
      insurance_cad: fees.insurance_cad,
      clearance_cad: fees.clearance_cad,
    };
    const changed = (["freight_cad", "duty_cad", "insurance_cad", "clearance_cad"] as const).some(
      (k) => Number(before[k] ?? 0) !== Number(after[k] ?? 0),
    );
    if (!changed) return fees;
    await admin.from("waybills").update(after).eq("id", waybillId);
    await admin.from("admin_action_logs").insert({
      entity_type: "waybill",
      entity_id: waybillId,
      action: "fee_auto_snapshot",
      before,
      after: { ...after, chargeable_kg: fees.chargeable_kg, fx: fees.fx, ctx },
      operator_id: operatorId,
      operator_name: operatorName,
      note: `${ctx}: 运费 CA$${after.freight_cad} / 关税 CA$${after.duty_cad} / 保险 CA$${after.insurance_cad} / 清关 CA$${after.clearance_cad}（计费 ${fees.chargeable_kg}kg, fx=${fees.fx}）`,
    });
    return fees;
  } catch (e: any) {
    await admin.from("admin_action_logs").insert({
      entity_type: "waybill",
      entity_id: waybillId,
      action: "fee_auto_error",
      operator_id: operatorId,
      operator_name: operatorName,
      note: `${ctx}: 自动计费失败 — ${e?.message ?? String(e)}`,
    });
    return null;
  }
}

// For container-child scan matching: return child's route/customer/destination/pickup.
async function childParityFor(admin: any, kind: "waybill" | "carton" | "pallet", id: string) {
  if (kind === "carton" || kind === "pallet") {
    const { data } = await admin
      .from(kind === "carton" ? "cartons" : "pallets")
      .select("route_id, customer_code, destination_code, pickup_warehouse")
      .eq("id", id)
      .maybeSingle();
    return data ?? null;
  }
  // waybill: pull from parent order/forwarding
  const { data: wb } = await admin.from("waybills").select("order_id, forwarding_id").eq("id", id).maybeSingle();
  if (!wb) return null;
  if (wb.order_id) {
    const { data: o } = await admin
      .from("orders")
      .select("route_id, customer_code, destination_code")
      .eq("id", wb.order_id)
      .maybeSingle();
    return o ? { ...o, pickup_warehouse: null } : null;
  }
  if (wb.forwarding_id) {
    const { data: f } = await admin
      .from("forwarding_orders")
      .select("route_id, customer_code, destination_code, warehouse")
      .eq("id", wb.forwarding_id)
      .maybeSingle();
    return f
      ? {
          route_id: f.route_id,
          customer_code: f.customer_code,
          destination_code: f.destination_code,
          pickup_warehouse: f.warehouse,
        }
      : null;
  }
  return null;
}

function assertParityMatch(container: any, child: any, childLabel: string) {
  if (!container || !child) return;
  const mismatches: string[] = [];
  const keys: Array<[keyof any, string]> = [
    ["route_id", "线路"],
    ["customer_code", "客户号"],
    ["destination_code", "目的地"],
    ["pickup_warehouse", "取货点"],
  ];
  for (const [k, label] of keys) {
    const cv = (container as any)[k];
    const wv = (child as any)[k];
    // Only fail when BOTH sides are set and they differ. If either side is empty, allow (adoption).
    if (cv && wv && String(cv) !== String(wv)) mismatches.push(`${label}(${String(wv)} ≠ 容器 ${String(cv)})`);
  }
  if (mismatches.length) throw new Error(`${childLabel} 与容器不匹配: ${mismatches.join(", ")}`);
}

// ============== 量尺称重 (Measure & Weigh) ==============
// Scan any code (waybill / order_no / request_no / domestic) and return its waybill list with dims/weight.
export const measureLookup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { code: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.code.trim();
    if (!code) throw new Error("空扫描");

    let parentKind: "order" | "forwarding" | null = null;
    let parentId: string | null = null;
    let parentNo: string | null = null;

    // 1) direct waybill match
    const { data: wbHit } = await supabaseAdmin
      .from("waybills")
      .select("id, order_id, forwarding_id")
      .eq("waybill_no", code)
      .maybeSingle();
    if (wbHit) {
      if (wbHit.order_id) {
        parentKind = "order";
        parentId = wbHit.order_id;
      } else if (wbHit.forwarding_id) {
        parentKind = "forwarding";
        parentId = wbHit.forwarding_id;
      }
    }

    // 2) find_by_any_no
    if (!parentKind) {
      try {
        const { data: hit } = await supabaseAdmin.rpc("find_by_any_no", { _input: code });
        const h = hit as any;
        if (h?.kind === "waybill") {
          const { data: wb2 } = await supabaseAdmin
            .from("waybills")
            .select("order_id, forwarding_id")
            .eq("id", h.id)
            .maybeSingle();
          if (wb2?.order_id) {
            parentKind = "order";
            parentId = wb2.order_id;
          } else if (wb2?.forwarding_id) {
            parentKind = "forwarding";
            parentId = wb2.forwarding_id;
          }
        } else if (h?.kind === "order") {
          parentKind = "order";
          parentId = h.id;
        } else if (h?.kind === "forwarding") {
          parentKind = "forwarding";
          parentId = h.id;
        }
      } catch {
        /* ignore */
      }
    }

    // 3) domestic tracking
    if (!parentKind) {
      const { data: o } = await supabaseAdmin
        .from("orders")
        .select("id")
        .eq("domestic_tracking_no", code)
        .maybeSingle();
      if (o) {
        parentKind = "order";
        parentId = o.id;
      } else {
        const { data: f } = await supabaseAdmin
          .from("forwarding_orders")
          .select("id")
          .eq("domestic_tracking_no", code)
          .maybeSingle();
        if (f) {
          parentKind = "forwarding";
          parentId = f.id;
        }
      }
    }

    if (!parentKind || !parentId) throw new Error(`未找到匹配单号: ${code}`);

    let parent: any = null;
    if (parentKind === "order") {
      const { data } = await supabaseAdmin
        .from("orders")
        .select(
          "id, order_no, customer_code, user_id, route_id, route_code, destination_code, shipping_method, note, buyer_note",
        )
        .eq("id", parentId)
        .maybeSingle();
      parent = data;
      parentNo = data?.order_no ?? null;
    } else {
      const { data } = await supabaseAdmin
        .from("forwarding_orders")
        .select(
          "id, request_no, customer_code, user_id, route_id, route_code, destination_code, shipping_method, warehouse, note",
        )
        .eq("id", parentId)
        .maybeSingle();
      parent = data;
      parentNo = data?.request_no ?? null;
    }

    const { data: waybills } = await supabaseAdmin
      .from("waybills")
      .select(
        "id, waybill_no, box_no, mark_no, length_cm, width_cm, height_cm, weight_kg, pallet_id, pallet_no, status, user_id",
      )
      .eq(parentKind === "order" ? "order_id" : "forwarding_id", parentId)
      .order("created_at", { ascending: true });

    return { parentKind, parentId, parentNo, parent, waybills: waybills ?? [] };
  });

// Bulk save L/W/H/weight for waybills
export const measureSaveDims = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      items: {
        id: string;
        length_cm?: number | null;
        width_cm?: number | null;
        height_cm?: number | null;
        weight_kg?: number | null;
      }[];
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { computeFreight } = await import("./orders.functions");
    const operatorName = await getOperatorName(supabaseAdmin, context.userId);
    let n = 0;
    const touchedForwardingIds = new Set<string>();
    const touchedOrderIds = new Set<string>();
    const touchedWaybillIds = new Set<string>();
    for (const it of data.items) {
      const patch: any = {};
      (["length_cm", "width_cm", "height_cm", "weight_kg"] as const).forEach((k) => {
        if (it[k] !== undefined) patch[k] = it[k];
      });
      if (Object.keys(patch).length === 0) continue;
      const { data: before } = await supabaseAdmin
        .from("waybills")
        .select("length_cm, width_cm, height_cm, weight_kg, forwarding_id, order_id, waybill_no")
        .eq("id", it.id)
        .maybeSingle();
      touchedWaybillIds.add(it.id);
      const { error } = await supabaseAdmin.from("waybills").update(patch).eq("id", it.id);
      if (error) throw new Error(error.message);
      await supabaseAdmin.from("admin_action_logs").insert({
        entity_type: "waybill",
        entity_id: it.id,
        action: "measure_dims",
        before,
        after: patch,
        operator_id: context.userId,
        operator_name: operatorName,
        note: `量尺称重: L${patch.length_cm ?? "-"}×W${patch.width_cm ?? "-"}×H${patch.height_cm ?? "-"} / ${patch.weight_kg ?? "-"}kg`,
      });
      // Public tracking event
      if ((before as any)?.waybill_no) {
        let { data: ship } = await supabaseAdmin
          .from("shipments")
          .select("id")
          .eq("tracking_no", (before as any).waybill_no)
          .maybeSingle();
        if (!ship) {
          const { data: s2 } = await supabaseAdmin
            .from("shipments")
            .insert({ tracking_no: (before as any).waybill_no, status: "created" })
            .select("id")
            .single();
          ship = s2;
        }
        if (ship) {
          await supabaseAdmin.from("tracking_events").insert({
            shipment_id: ship.id,
            status_zh: `已完成量尺称重 — ${operatorName}`,
            status_en: `Measured & weighed — by ${operatorName}`,
            event_time: new Date().toISOString(),
            source: "admin_action",
            source_ref: context.userId,
          });
        }
      }
      if ((before as any)?.forwarding_id) touchedForwardingIds.add((before as any).forwarding_id);
      if ((before as any)?.order_id) touchedOrderIds.add((before as any).order_id);

      // Auto-compute waybill CAD fees (freight/duty/insurance/clearance) from parent route + new dims
      try {
        const wbCtx = { ...(before as any), ...patch, id: it.id };
        const fees = await computeWaybillFeesCad(supabaseAdmin, wbCtx);
        if (fees.route_id) {
          await supabaseAdmin
            .from("waybills")
            .update({
              freight_cad: fees.freight_cad,
              duty_cad: fees.duty_cad,
              insurance_cad: fees.insurance_cad,
              clearance_cad: fees.clearance_cad,
            })
            .eq("id", it.id);
        } else {
          await supabaseAdmin.from("admin_action_logs").insert({
            entity_type: "waybill",
            entity_id: it.id,
            action: "fee_auto_skip",
            operator_id: context.userId,
            operator_name: operatorName,
            note: `自动计费跳过：所属${(before as any)?.order_id ? "电商订单" : "集运订单"}未绑定线路 (route_id)`,
          });
        }
      } catch (e: any) {
        await supabaseAdmin.from("admin_action_logs").insert({
          entity_type: "waybill",
          entity_id: it.id,
          action: "fee_auto_error",
          operator_id: context.userId,
          operator_name: operatorName,
          note: `自动计费失败：${e?.message ?? String(e)}`,
        });
      }
      // 关税明细落库（waybill_items + waybills.duty_cad + forwarding_items 回写）
      try {
        const { persistWaybillItems } = await import("./duty.server");
        await persistWaybillItems(supabaseAdmin, it.id);
      } catch (e) {
        console.error("persistWaybillItems failed (measureSaveDims)", it.id, e);
      }
      n++;
    }

    // Auto intake + fee generation for touched forwarding orders that have a route configured
    const autoFees: { forwarding_id: string; fee_cny: number }[] = [];
    for (const fid of touchedForwardingIds) {
      const { data: fo } = await supabaseAdmin
        .from("forwarding_orders")
        .select("id, route_id, declared_value_cad, fee_cny, freight_snapshot, status, box_count, insured")
        .eq("id", fid)
        .maybeSingle();
      if (!fo?.route_id) continue;
      const { data: wbs } = await supabaseAdmin
        .from("waybills")
        .select("weight_kg, length_cm, width_cm, height_cm")
        .eq("forwarding_id", fid);
      let tw = 0,
        tv = 0,
        complete = true;
      for (const w of wbs ?? []) {
        const wt = Number(w.weight_kg ?? 0);
        const l = Number(w.length_cm ?? 0),
          wd = Number(w.width_cm ?? 0),
          h = Number(w.height_cm ?? 0);
        if (!wt || !l || !wd || !h) {
          complete = false;
          break;
        }
        tw += wt;
        tv += l * wd * h;
      }
      if (!complete || tw <= 0 || tv <= 0) continue;
      const snap = await computeFreight(supabaseAdmin, fo.route_id, tw, tv, fo.declared_value_cad ?? null, fo.insured === true);
      if (!snap) continue;
      await supabaseAdmin
        .from("forwarding_orders")
        .update({
          actual_weight_kg: tw,
          weight_kg: tw,
          freight_snapshot: snap,
          fee_cny: snap.freight_cny,
          intake_at: new Date().toISOString(),
          intake_by: context.userId,
          box_count: (wbs ?? []).length || fo.box_count,
          status: fo.status === "pending" || fo.status === "draft" ? "received" : fo.status,
        })
        .eq("id", fid);
      await supabaseAdmin.from("admin_action_logs").insert({
        entity_type: "forwarding",
        entity_id: fid,
        action: "intake",
        before: { fee_cny: fo.fee_cny, freight_snapshot: fo.freight_snapshot, status: fo.status },
        after: { fee_cny: snap.freight_cny, freight_snapshot: snap },
        operator_id: context.userId,
        operator_name: operatorName,
        note: "量尺称重后自动生成费用",
      });
      autoFees.push({ forwarding_id: fid, fee_cny: snap.freight_cny });
    }

    // Auto-generate freight snapshot for touched e-commerce orders (aggregates waybill CAD fees)
    const autoOrderFees: { order_id: string; shipping_cny: number }[] = [];
    for (const oid of touchedOrderIds) {
      const { data: ord } = await supabaseAdmin
        .from("orders")
        .select("id, route_id, shipping_cny, customs_cny, insurance_cny, freight_snapshot")
        .eq("id", oid)
        .maybeSingle();
      if (!ord?.route_id) continue;
      const { data: wbs } = await supabaseAdmin
        .from("waybills")
        .select("freight_cad, duty_cad, insurance_cad, clearance_cad, weight_kg, length_cm, width_cm, height_cm")
        .eq("order_id", oid);
      let f = 0,
        du = 0,
        ins = 0,
        clr = 0,
        tw = 0,
        tv = 0;
      for (const w of wbs ?? []) {
        f += Number(w.freight_cad ?? 0);
        du += Number(w.duty_cad ?? 0);
        ins += Number(w.insurance_cad ?? 0);
        clr += Number(w.clearance_cad ?? 0);
        tw += Number(w.weight_kg ?? 0);
        tv += Number(w.length_cm ?? 0) * Number(w.width_cm ?? 0) * Number(w.height_cm ?? 0);
      }
      if (f + du + ins + clr <= 0) continue;
      const { getFxCadPerCny } = await import("./orders.functions");
      const fx = await getFxCadPerCny(supabaseAdmin);
      const shipping_cny = +(f / fx).toFixed(2);
      const customs_cny = +(du / fx).toFixed(2);
      const insurance_cny = +(ins / fx).toFixed(2);
      const snap = {
        ...((ord.freight_snapshot as any) ?? {}),
        freight_cad: +f.toFixed(2),
        duty_cad: +du.toFixed(2),
        insurance_cad: +ins.toFixed(2),
        clearance_cad: +clr.toFixed(2),
        total_weight_kg: +tw.toFixed(3),
        total_volume_cm3: tv,
        computed_at: new Date().toISOString(),
        source: "measure_auto",
      };
      await supabaseAdmin
        .from("orders")
        .update({
          shipping_cny,
          customs_cny,
          insurance_cny,
          freight_snapshot: snap,
        })
        .eq("id", oid);
      await supabaseAdmin.from("admin_action_logs").insert({
        entity_type: "order",
        entity_id: oid,
        action: "freight_auto_compute",
        before: {
          shipping_cny: ord.shipping_cny,
          customs_cny: ord.customs_cny,
          insurance_cny: ord.insurance_cny,
          freight_snapshot: ord.freight_snapshot,
        },
        after: { shipping_cny, customs_cny, insurance_cny, freight_snapshot: snap },
        operator_id: context.userId,
        operator_name: operatorName,
        note: "量尺称重后自动生成订单运费快照",
      });
      autoOrderFees.push({ order_id: oid, shipping_cny });
    }

    // 量尺称重改的是运单自己的重量/尺寸，不改它在哪个箱/托盘/批次——直接按当前所属批次打脏即可。
    if (touchedWaybillIds.size) {
      try {
        const { markBatchFeesDirtyMany, resolveWaybillBatchIds } = await import("./orders.functions");
        const batchIds = await resolveWaybillBatchIds(supabaseAdmin, Array.from(touchedWaybillIds));
        await markBatchFeesDirtyMany(supabaseAdmin, batchIds);
      } catch (e) {
        console.error("markBatchFeesDirtyMany failed (measureSaveDims):", e);
      }
    }

    return { ok: true, updated: n, autoFees, autoOrderFees };
  });

// Create new pallet and auto-assign first N waybills (in order) of a parent
type PalletDraft = {
  waybillIds: string[];
  notes?: string | null;
  // OUTER / total dims & weight (container + contents)
  length_cm?: number | null;
  width_cm?: number | null;
  height_cm?: number | null;
  weight_kg?: number | null;
  // SELF (container itself, distinct from contents sum)
  self_length_cm?: number | null;
  self_width_cm?: number | null;
  self_height_cm?: number | null;
  self_weight_kg?: number | null;
  self_volume_m3?: number | null;
};

type PalletParity = {
  customer_user_id?: string | null;
  customer_code?: string | null;
  route_id?: string | null;
  route_code?: string | null;
  pickup_warehouse?: string | null;
  destination_code?: string | null;
};

async function insertPallet(supabaseAdmin: any, userId: string, p: PalletDraft, parity: PalletParity) {
  const { computePalletSelfFreight, recomputeForwardingTotal } = await import("./orders.functions");
  const noteParts: string[] = [];
  if (parity.customer_code) noteParts.push(`客户 ${parity.customer_code}`);
  if (p.notes) noteParts.push(p.notes);
  // Auto-fill self_volume_m3 from L×W×H (cm) if omitted
  let selfVolume = p.self_volume_m3 ?? null;
  if (selfVolume == null && p.self_length_cm && p.self_width_cm && p.self_height_cm) {
    selfVolume = +((p.self_length_cm * p.self_width_cm * p.self_height_cm) / 1_000_000).toFixed(6);
  }
  const { data: pal, error } = await supabaseAdmin
    .from("pallets")
    .insert({
      notes: noteParts.join(" / ") || null,
      length_cm: p.length_cm ?? null,
      width_cm: p.width_cm ?? null,
      height_cm: p.height_cm ?? null,
      weight_kg: p.weight_kg ?? null,
      self_length_cm: p.self_length_cm ?? null,
      self_width_cm: p.self_width_cm ?? null,
      self_height_cm: p.self_height_cm ?? null,
      self_weight_kg: p.self_weight_kg ?? null,
      self_volume_m3: selfVolume,
      customer_user_id: parity.customer_user_id ?? null,
      customer_code: parity.customer_code ?? null,
      route_id: parity.route_id ?? null,
      route_code: parity.route_code ?? null,
      pickup_warehouse: parity.pickup_warehouse ?? null,
      destination_code: parity.destination_code ?? null,
      created_by: userId,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  const affectedForwardings = new Set<string>();
  if (p.waybillIds.length) {
    const { data: wbInfo } = await supabaseAdmin.from("waybills").select("forwarding_id").in("id", p.waybillIds);
    (wbInfo ?? []).forEach((w: any) => {
      if (w.forwarding_id) affectedForwardings.add(w.forwarding_id);
    });
    const { error: e2 } = await supabaseAdmin
      .from("waybills")
      .update({ pallet_id: pal.id, pallet_no: pal.pallet_no })
      .in("id", p.waybillIds);
    if (e2) throw new Error(e2.message);
  }
  // Snapshot pallet self-freight from route rule
  let selfFreight: any = null;
  if (parity.route_id) {
    try {
      selfFreight = await computePalletSelfFreight(supabaseAdmin, pal.id);
    } catch {
      /* ignore */
    }
  }
  // Refresh totals for any forwarding orders whose waybills just landed on this pallet
  for (const fid of affectedForwardings) {
    try {
      await recomputeForwardingTotal(supabaseAdmin, fid);
    } catch {
      /* ignore */
    }
  }
  return { ...pal, self_freight_cny: selfFreight?.freight_cny ?? pal.self_freight_cny };
}

async function cascadePalletWaybillLogs(
  admin: any,
  pal: any,
  waybillIds: string[],
  operatorId: string,
  operatorName: string,
) {
  if (!waybillIds.length) return;
  const { data: wbs } = await admin
    .from("waybills")
    .select("id, waybill_no, order_id, forwarding_id")
    .in("id", waybillIds);
  const inserts: any[] = [];
  for (const w of wbs ?? []) {
    inserts.push({
      entity_type: "waybill",
      entity_id: w.id,
      action: "measure_assign_to_pallet",
      after: { pallet_id: pal.id, pallet_no: pal.pallet_no },
      operator_id: operatorId,
      operator_name: operatorName,
      note: `量尺称重: 运单 ${w.waybill_no} 加入托盘 ${pal.pallet_no}`,
    });
    if (w.order_id)
      inserts.push({
        entity_type: "order",
        entity_id: w.order_id,
        action: "measure_waybill_assign_to_pallet",
        after: { waybill_no: w.waybill_no, pallet_no: pal.pallet_no },
        operator_id: operatorId,
        operator_name: operatorName,
        note: `量尺称重: 订单下运单 ${w.waybill_no} 加入托盘 ${pal.pallet_no}`,
      });
    if (w.forwarding_id)
      inserts.push({
        entity_type: "forwarding",
        entity_id: w.forwarding_id,
        action: "measure_waybill_assign_to_pallet",
        after: { waybill_no: w.waybill_no, pallet_no: pal.pallet_no },
        operator_id: operatorId,
        operator_name: operatorName,
        note: `量尺称重: 集运单下运单 ${w.waybill_no} 加入托盘 ${pal.pallet_no}`,
      });
  }
  if (inserts.length) await admin.from("admin_action_logs").insert(inserts);
}

export const measureCreatePalletAssign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: PalletDraft & PalletParity) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!data.waybillIds?.length) throw new Error("至少选择 1 个运单 / 输入箱数");
    const operatorName = await getOperatorName(supabaseAdmin, context.userId);
    const pal = await insertPallet(supabaseAdmin, context.userId, data, data);
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "pallet",
      entity_id: pal.id,
      action: "create_assign",
      after: {
        pallet_no: pal.pallet_no,
        waybills: data.waybillIds.length,
        customer: data.customer_code,
        dims: { l: data.length_cm, w: data.width_cm, h: data.height_cm },
        weight: data.weight_kg,
      },
      operator_id: context.userId,
      operator_name: operatorName,
      note: `量尺称重: 新建托盘 ${pal.pallet_no}，加入 ${data.waybillIds.length} 个运单`,
    });
    await cascadePalletWaybillLogs(supabaseAdmin, pal, data.waybillIds, context.userId, operatorName);
    return { ok: true, pallet: pal };
  });

// Create multiple pallets in one call (batch). Each draft has its own waybillIds + dims + self dims.
export const measureCreatePalletsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { pallets: PalletDraft[] } & PalletParity) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!data.pallets?.length) throw new Error("至少创建 1 个托盘");
    const operatorName = await getOperatorName(supabaseAdmin, context.userId);
    const parity: PalletParity = {
      customer_user_id: data.customer_user_id ?? null,
      customer_code: data.customer_code ?? null,
      route_id: data.route_id ?? null,
      route_code: data.route_code ?? null,
      pickup_warehouse: data.pickup_warehouse ?? null,
      destination_code: data.destination_code ?? null,
    };
    const created: any[] = [];
    for (const p of data.pallets) {
      if (!p.waybillIds?.length) continue;
      const pal = await insertPallet(supabaseAdmin, context.userId, p, parity);
      created.push(pal);
      await supabaseAdmin.from("admin_action_logs").insert({
        entity_type: "pallet",
        entity_id: pal.id,
        action: "create_assign",
        after: {
          pallet_no: pal.pallet_no,
          waybills: p.waybillIds.length,
          customer: parity.customer_code,
          dims: { l: p.length_cm, w: p.width_cm, h: p.height_cm },
          weight: p.weight_kg,
          self: {
            l: p.self_length_cm,
            w: p.self_width_cm,
            h: p.self_height_cm,
            weight: p.self_weight_kg,
            volume: p.self_volume_m3,
          },
        },
        operator_id: context.userId,
        operator_name: operatorName,
        note: `量尺称重(批量): 新建托盘 ${pal.pallet_no}，加入 ${p.waybillIds.length} 个运单`,
      });
      await cascadePalletWaybillLogs(supabaseAdmin, pal, p.waybillIds, context.userId, operatorName);
    }
    if (!created.length) throw new Error("没有可创建的托盘 (运单分配为空)");
    return { ok: true, pallets: created };
  });

// Backfill / recompute CAD fees on all waybills that have dims + weight set.
export const recomputeWaybillFees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { onlyMissing?: boolean } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const operatorName = await getOperatorName(supabaseAdmin, context.userId);
    const { data: wbs, error } = await supabaseAdmin
      .from("waybills")
      .select(
        "id, waybill_no, order_id, forwarding_id, length_cm, width_cm, height_cm, weight_kg, freight_cad, duty_cad, insurance_cad, clearance_cad",
      )
      .not("weight_kg", "is", null)
      .gt("weight_kg", 0)
      .not("length_cm", "is", null)
      .gt("length_cm", 0)
      .not("width_cm", "is", null)
      .gt("width_cm", 0)
      .not("height_cm", "is", null)
      .gt("height_cm", 0);
    if (error) throw new Error(error.message);
    let updated = 0,
      skipped = 0,
      unchanged = 0;
    for (const wb of wbs ?? []) {
      if (data.onlyMissing && Number(wb.freight_cad ?? 0) > 0) {
        unchanged++;
        continue;
      }
      const fees = await computeWaybillFeesCad(supabaseAdmin, wb);
      if (!fees.route_id) {
        skipped++;
        continue;
      }
      await supabaseAdmin
        .from("waybills")
        .update({
          freight_cad: fees.freight_cad,
          duty_cad: fees.duty_cad,
          insurance_cad: fees.insurance_cad,
          clearance_cad: fees.clearance_cad,
        })
        .eq("id", wb.id);
      try {
        const { persistWaybillItems } = await import("./duty.server");
        await persistWaybillItems(supabaseAdmin, wb.id);
      } catch (e) {
        console.error("persistWaybillItems failed (recomputeWaybillFees)", wb.id, e);
      }
      updated++;
    }
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "system",
      entity_id: context.userId,
      action: "recompute_waybill_fees",
      after: { updated, skipped_no_route: skipped, unchanged },
      operator_id: context.userId,
      operator_name: operatorName,
      note: `批量重算运单 CAD 费用：更新 ${updated} · 跳过(未绑定线路) ${skipped} · 未变 ${unchanged}`,
    });
    return { ok: true, updated, skipped, unchanged, total: wbs?.length ?? 0 };
  });
