import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recomputeForwardingTotal } from "@/lib/orders.functions";

export type SurchargeScope = "waybill" | "carton" | "pallet" | "batch" | "forwarding";

export type Surcharge = {
  id: string;
  scope: SurchargeScope;
  waybill_id: string | null;
  carton_id: string | null;
  pallet_id: string | null;
  batch_id: string | null;
  customer_code: string | null;
  amount_cny: number;
  note: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

async function logSurcharge(admin: any, opts: { action: "add" | "update" | "delete"; row: any; before?: any; operatorId: string }) {
  const { row, before, action, operatorId } = opts;
  const entity_type = row?.scope ?? before?.scope ?? "surcharge";
  const entity_id = row?.[scopeIdCol(entity_type as SurchargeScope)] ?? before?.[scopeIdCol(entity_type as SurchargeScope)] ?? row?.id ?? before?.id;
  const { data: prof } = await admin.from("profiles").select("full_name, email").eq("id", operatorId).maybeSingle();
  const operator_name = prof?.full_name || prof?.email || operatorId;
  const amt = Number(row?.amount_cny ?? before?.amount_cny ?? 0);
  const noteBits: string[] = [];
  if (action === "add") noteBits.push(`新增附加费 ¥${amt.toFixed(2)} · ${row.note ?? ""}`);
  if (action === "update") noteBits.push(`修改附加费 ¥${Number(before?.amount_cny ?? 0).toFixed(2)} → ¥${amt.toFixed(2)} · ${row.note ?? ""}`);
  if (action === "delete") noteBits.push(`删除附加费 ¥${Number(before?.amount_cny ?? 0).toFixed(2)} · ${before?.note ?? ""}`);
  const inserts: any[] = [{
    entity_type, entity_id,
    action: `surcharge_${action}`,
    before: before ?? null, after: action === "delete" ? null : row,
    operator_id: operatorId, operator_name, note: noteBits.join(" "),
  }];
  // Cascade to related entities for carton/pallet scope so the record appears on child waybills + parent orders/forwardings
  if (entity_type === "carton" || entity_type === "pallet") {
    let wbFilter: any = null;
    if (entity_type === "carton") {
      const { data: wbs } = await admin.from("waybills").select("id, order_id, forwarding_id, waybill_no").eq("carton_id", entity_id);
      wbFilter = wbs ?? [];
    } else {
      const { data: cns } = await admin.from("cartons").select("id").eq("pallet_id", entity_id);
      const ids = (cns ?? []).map((c: any) => c.id);
      let orFilter = `pallet_id.eq.${entity_id}`;
      if (ids.length) orFilter += `,carton_id.in.(${ids.join(",")})`;
      const { data: wbs } = await admin.from("waybills").select("id, order_id, forwarding_id, waybill_no").or(orFilter);
      wbFilter = wbs ?? [];
    }
    const orderIds = Array.from(new Set(wbFilter.map((w: any) => w.order_id).filter(Boolean)));
    const fwdIds = Array.from(new Set(wbFilter.map((w: any) => w.forwarding_id).filter(Boolean)));
    for (const w of wbFilter) {
      inserts.push({ entity_type: "waybill", entity_id: w.id, action: `parent_surcharge_${action}`,
        before: before ?? null, after: action === "delete" ? null : row,
        operator_id: operatorId, operator_name, note: `所属${entity_type === "carton" ? "箱号" : "托盘"} ${noteBits.join(" ")}` });
    }
    for (const oid of orderIds) inserts.push({ entity_type: "order", entity_id: oid, action: `container_surcharge_${action}`, before: before ?? null, after: action === "delete" ? null : row, operator_id: operatorId, operator_name, note: `${entity_type === "carton" ? "箱号" : "托盘"}附加费 ${noteBits.join(" ")}` });
    for (const fid of fwdIds) inserts.push({ entity_type: "forwarding", entity_id: fid, action: `container_surcharge_${action}`, before: before ?? null, after: action === "delete" ? null : row, operator_id: operatorId, operator_name, note: `${entity_type === "carton" ? "箱号" : "托盘"}附加费 ${noteBits.join(" ")}` });
  }
  // For waybill scope surcharge, cascade up to parent order/forwarding
  if (entity_type === "waybill") {
    const { data: w } = await admin.from("waybills").select("order_id, forwarding_id").eq("id", entity_id).maybeSingle();
    if (w?.order_id) inserts.push({ entity_type: "order", entity_id: w.order_id, action: `waybill_surcharge_${action}`, before: before ?? null, after: action === "delete" ? null : row, operator_id: operatorId, operator_name, note: `运单附加费 ${noteBits.join(" ")}` });
    if (w?.forwarding_id) inserts.push({ entity_type: "forwarding", entity_id: w.forwarding_id, action: `waybill_surcharge_${action}`, before: before ?? null, after: action === "delete" ? null : row, operator_id: operatorId, operator_name, note: `运单附加费 ${noteBits.join(" ")}` });
  }
  await admin.from("admin_action_logs").insert(inserts);
}

function scopeIdCol(scope: SurchargeScope): "waybill_id" | "carton_id" | "pallet_id" | "batch_id" | "forwarding_id" {
  return `${scope}_id` as any;
}

// Fetch forwarding_id from a surcharge row (for waybill/forwarding scope) so we can recompute totals.
async function forwardingIdOf(admin: any, row: { scope: SurchargeScope; waybill_id?: string | null; forwarding_id?: string | null } | null): Promise<string | null> {
  if (!row) return null;
  if (row.scope === "forwarding") return row.forwarding_id ?? null;
  if (row.scope === "waybill" && row.waybill_id) {
    const { data: w } = await admin.from("waybills").select("forwarding_id").eq("id", row.waybill_id).maybeSingle();
    return w?.forwarding_id ?? null;
  }
  return null;
}

export const listSurcharges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { scope: SurchargeScope; id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const col = scopeIdCol(data.scope);
    const { data: rows, error } = await supabaseAdmin
      .from("surcharges").select("*")
      .eq("scope", data.scope).eq(col, data.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const operatorIds = Array.from(new Set((rows ?? []).map((r: any) => r.created_by).filter(Boolean) as string[]));
    let nameMap = new Map<string, string>();
    if (operatorIds.length) {
      const { data: profs } = await supabaseAdmin.from("profiles").select("id, full_name, email").in("id", operatorIds);
      for (const p of (profs ?? []) as any[]) nameMap.set(p.id, p.full_name || p.email || p.id);
    }
    const items = (rows ?? []).map((r: any) => ({ ...r, created_by_name: r.created_by ? (nameMap.get(r.created_by) ?? null) : null }));
    const total = items.reduce((s: number, r: any) => s + Number(r.amount_cny ?? 0), 0);
    return { items, total_cny: +total.toFixed(2) };
  });

export const addSurcharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { scope: SurchargeScope; id: string; amount_cny: number; note: string; customer_code?: string | null }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const row: any = {
      scope: data.scope,
      amount_cny: Number(data.amount_cny ?? 0),
      note: (data.note ?? "").trim(),
      customer_code: data.customer_code ?? null,
      created_by: context.userId,
    };
    row[scopeIdCol(data.scope)] = data.id;
    const { data: ins, error } = await supabaseAdmin.from("surcharges").insert(row).select("*").single();
    if (error) throw new Error(error.message);
    await logSurcharge(supabaseAdmin, { action: "add", row: ins, operatorId: context.userId });
    const fid = await forwardingIdOf(supabaseAdmin, ins as any);
    if (fid) await recomputeForwardingTotal(supabaseAdmin, fid);
    return { ok: true, surcharge: ins };
  });

export const updateSurcharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; amount_cny?: number; note?: string; customer_code?: string | null }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("surcharges").select("*").eq("id", data.id).maybeSingle();
    const patch: any = {};
    if (data.amount_cny != null) patch.amount_cny = Number(data.amount_cny);
    if (data.note != null) patch.note = data.note.trim();
    if (data.customer_code !== undefined) patch.customer_code = data.customer_code;
    const { data: updated, error } = await supabaseAdmin.from("surcharges").update(patch).eq("id", data.id).select("*").single();
    if (error) throw new Error(error.message);
    await logSurcharge(supabaseAdmin, { action: "update", row: updated, before, operatorId: context.userId });
    const fid = await forwardingIdOf(supabaseAdmin, updated as any);
    if (fid) await recomputeForwardingTotal(supabaseAdmin, fid);
    return { ok: true };
  });

export const deleteSurcharge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("surcharges").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("surcharges").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (before) await logSurcharge(supabaseAdmin, { action: "delete", row: before, before, operatorId: context.userId });
    const fid = await forwardingIdOf(supabaseAdmin, before as any);
    if (fid) await recomputeForwardingTotal(supabaseAdmin, fid);
    return { ok: true };
  });
