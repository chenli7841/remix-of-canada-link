import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getFxCadPerCny } from "./orders.functions";
import { recordAdminLog } from "@/lib/admin-log";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden: staff only");
}

// ---- List ----
export const listInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { page?: number; pageSize?: number; status?: string; q?: string; userId?: string } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, data.pageSize ?? 20);
    const from = (page - 1) * pageSize;
    let q = supabaseAdmin.from("invoices").select("*", { count: "exact" }).order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status as any);
    if (data.userId) q = q.eq("user_id", data.userId);
    if (data.q) q = q.ilike("invoice_no", `%${data.q}%`);
    const { data: rows, error, count } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, full_name, customer_code, email, phone, invoice_title, invoice_phone, invoice_email, invoice_address",
      )
      .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
    return {
      items: (rows ?? []).map((r: any) => ({ ...r, customer: profMap.get(r.user_id) ?? null })),
      total: count ?? 0,
      page,
      pageSize,
    };
  });

export const listMyInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { page?: number; pageSize?: number; status?: string } = {}) => d)
  .handler(async ({ data, context }) => {
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, data.pageSize ?? 20);
    const from = (page - 1) * pageSize;
    let q = context.supabase
      .from("invoices")
      .select("*", { count: "exact" })
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (data.status) q = q.eq("status", data.status as any);
    const { data: rows, error, count } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return { items: rows ?? [], total: count ?? 0, page, pageSize };
  });

// ---- Get one with items ----
export const getInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: inv, error } = await context.supabase.from("invoices").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Not found");
    const { data: items } = await context.supabase.from("invoice_items").select("*").eq("invoice_id", data.id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, full_name, customer_code, email, phone, invoice_title, invoice_phone, invoice_email, invoice_address",
      )
      .eq("id", inv.user_id)
      .maybeSingle();
    return { invoice: inv, items: items ?? [], customer: prof ?? null };
  });

// ---- Compute freight breakdown for a waybill ----
// freight_cny/insurance_cny are computed directly against the route's
// freight_rules (unchanged from before); customs_cny now comes from
// computeAnyWaybillDutyBreakdown (duty.server.ts) — the HS-code/product-rate
// per-item calculation that settleBatchForCustomer's persisted waybill
// columns are also built from, rather than the deprecated flat
// customs_rules.rate_pct. `meta` carries what the invoice's 运费/关税/GST
// tables need to itemize (buildInvoiceLineMeta, same helper).
async function computeWaybillFees(admin: any, waybillId: string, fx: number) {
  const { data: wb } = await admin.from("waybills").select("*").eq("id", waybillId).maybeSingle();
  if (!wb) throw new Error("waybill not found");
  let route_id: string | null = null;
  let declared_cad = 0;
  if (wb.order_id) {
    const { data: ord } = await admin
      .from("orders")
      .select("route_id, subtotal_cny")
      .eq("id", wb.order_id)
      .maybeSingle();
    route_id = ord?.route_id ?? null;
    declared_cad = +(Number(ord?.subtotal_cny ?? 0) * fx).toFixed(2);
  } else if (wb.forwarding_id) {
    const { data: fo } = await admin
      .from("forwarding_orders")
      .select("route_id, declared_value_cad")
      .eq("id", wb.forwarding_id)
      .maybeSingle();
    route_id = fo?.route_id ?? null;
    declared_cad = Number(fo?.declared_value_cad ?? 0);
  }
  if (!route_id) return { freight_cny: 0, customs_cny: 0, insurance_cny: 0, meta: null, ref: { wb } };

  const { data: rule } = await admin
    .from("freight_rules")
    .select("*")
    .eq("route_id", route_id)
    .eq("is_active", true)
    .maybeSingle();
  if (!rule) return { freight_cny: 0, customs_cny: 0, insurance_cny: 0, meta: null, ref: { wb } };

  const w = Number(wb.weight_kg ?? 0);
  const v = Number(wb.length_cm ?? 0) * Number(wb.width_cm ?? 0) * Number(wb.height_cm ?? 0);
  const volW = rule.volumetric_divisor > 0 ? v / Number(rule.volumetric_divisor) : 0;
  const chargeable = rule.weight_mode === "actual" ? w : rule.weight_mode === "volumetric" ? volW : Math.max(w, volW);
  let freight_cny = chargeable * Number(rule.unit_price_cny) + Number(rule.extra_fee_cny);
  if (freight_cny < Number(rule.min_charge_cny)) freight_cny = Number(rule.min_charge_cny);
  const insurance_cny =
    declared_cad && Number(rule.insurance_rate_pct ?? 0) > 0
      ? +((declared_cad * (Number(rule.insurance_rate_pct) / 100)) / fx).toFixed(2)
      : 0;

  const { computeAnyWaybillDutyBreakdown, buildInvoiceLineMeta } = await import("./duty.server");
  const duty = await computeAnyWaybillDutyBreakdown(admin, wb);
  const customs_cny = fx > 0 ? +(duty.duty_cad / fx).toFixed(2) : 0;
  const meta = await buildInvoiceLineMeta(admin, wb).catch(() => null);

  return {
    freight_cny: +freight_cny.toFixed(2),
    customs_cny,
    insurance_cny,
    meta,
    ref: { wb, route_id },
  };
}

// ---- Generate invoice for a single waybill ----
export const generateInvoiceForWaybill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { waybill_id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: wb } = await supabaseAdmin.from("waybills").select("*").eq("id", data.waybill_id).maybeSingle();
    if (!wb) throw new Error("waybill not found");

    const fx = await getFxCadPerCny(supabaseAdmin);
    const fees = await computeWaybillFees(supabaseAdmin, data.waybill_id, fx);
    const total = fees.freight_cny + fees.customs_cny + fees.insurance_cny;
    if (total <= 0) throw new Error("无法计算费用，请检查线路与重量");

    const { data: inv, error } = await supabaseAdmin
      .from("invoices")
      .insert({
        user_id: wb.user_id,
        type: "waybill",
        subtotal_cny: total,
        freight_cny: fees.freight_cny,
        customs_cny: fees.customs_cny,
        insurance_cny: fees.insurance_cny,
        total_cny: total,
        fx_rate: fx,
        due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        created_by: context.userId,
        note: `运单 ${wb.waybill_no}`,
      } as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("invoice_items").insert({
      invoice_id: inv.id,
      waybill_id: wb.id,
      order_id: wb.order_id,
      forwarding_id: wb.forwarding_id,
      description: `运单 ${wb.waybill_no}`,
      freight_cny: fees.freight_cny,
      customs_cny: fees.customs_cny,
      insurance_cny: fees.insurance_cny,
      amount_cny: total,
      meta: fees.meta,
    });
    await recordAdminLog(supabaseAdmin, {
      entity_type: "invoice",
      entity_id: inv.id,
      action: "generate_for_waybill",
      after: { invoice_no: inv.invoice_no, total_cny: total, waybill_id: wb.id },
      operator_id: context.userId,
    });
    return { ok: true, invoice: inv };
  });

// ---- Generate invoice for an entire batch ----
export const generateBatchInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batch_id: string; user_id?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("waybills").select("*").eq("assigned_batch_id", data.batch_id);
    if (data.user_id) q = q.eq("user_id", data.user_id);
    const { data: wbs } = await q;
    if (!wbs?.length) throw new Error("批次内无运单");

    // group by user_id
    const byUser = new Map<string, any[]>();
    for (const w of wbs) {
      if (!byUser.has(w.user_id)) byUser.set(w.user_id, []);
      byUser.get(w.user_id)!.push(w);
    }

    const { data: batch } = await supabaseAdmin
      .from("batches")
      .select("batch_no")
      .eq("id", data.batch_id)
      .maybeSingle();
    const fx = await getFxCadPerCny(supabaseAdmin);
    const created: any[] = [];
    for (const [uid, items] of byUser.entries()) {
      let f = 0,
        c = 0,
        ins = 0;
      const lineItems: any[] = [];
      for (const w of items) {
        const fees = await computeWaybillFees(supabaseAdmin, w.id, fx);
        f += fees.freight_cny;
        c += fees.customs_cny;
        ins += fees.insurance_cny;
        lineItems.push({
          waybill_id: w.id,
          order_id: w.order_id,
          forwarding_id: w.forwarding_id,
          description: `运单 ${w.waybill_no}`,
          freight_cny: fees.freight_cny,
          customs_cny: fees.customs_cny,
          insurance_cny: fees.insurance_cny,
          amount_cny: fees.freight_cny + fees.customs_cny + fees.insurance_cny,
          meta: fees.meta,
        });
      }
      const total = +(f + c + ins).toFixed(2);
      if (total <= 0) continue;
      const { data: inv } = await supabaseAdmin
        .from("invoices")
        .insert({
          user_id: uid,
          type: "batch",
          subtotal_cny: total,
          freight_cny: +f.toFixed(2),
          customs_cny: +c.toFixed(2),
          insurance_cny: +ins.toFixed(2),
          total_cny: total,
          fx_rate: fx,
          batch_no: batch?.batch_no ?? null,
          due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
          created_by: context.userId,
          note: `批次 ${batch?.batch_no ?? data.batch_id}`,
        } as any)
        .select("*")
        .single();
      if (inv) {
        await supabaseAdmin.from("invoice_items").insert(lineItems.map((li) => ({ ...li, invoice_id: inv.id })));
        created.push(inv);
      }
    }
    await Promise.all(
      created.map((inv) =>
        recordAdminLog(supabaseAdmin, {
          entity_type: "invoice",
          entity_id: inv.id,
          action: "generate_for_batch",
          after: { invoice_no: inv.invoice_no, total_cny: inv.total_cny, batch_id: data.batch_id },
          operator_id: context.userId,
        }),
      ),
    );
    return { ok: true, count: created.length, invoices: created };
  });

// ---- Pay invoice ----
export const payInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("pay_invoice", { _invoice_id: data.id });
    if (error) throw new Error(error.message);
    return r;
  });

// ---- Mark paid (staff manual) / void ----
export const updateInvoiceStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "unpaid" | "paid" | "overdue" | "void"; note?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const patch: any = { status: data.status };
    if (data.note !== undefined) patch.note = data.note;
    if (data.status === "paid") patch.paid_at = new Date().toISOString();
    const { error } = await supabaseAdmin.from("invoices").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "invoice",
      entity_id: data.id,
      action: "update_status",
      after: { status: data.status, note: data.note },
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ---- Delete invoice ----
export const deleteInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("invoices").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("invoices").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "invoice",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ---- Finance report ----
export const financeSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId?: string; days?: number } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - (data.days ?? 30) * 86400000).toISOString();
    let q = supabaseAdmin
      .from("invoices")
      .select("status, total_cny, paid_cny, paid_cad, fx_rate, created_at, user_id")
      .gte("created_at", since);
    if (data.userId) q = q.eq("user_id", data.userId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    let totalCny = 0,
      paidCny = 0,
      unpaidCny = 0,
      overdueCny = 0,
      total = 0,
      paid = 0,
      unpaid = 0,
      overdue = 0,
      count = 0,
      paidCount = 0;
    for (const r of rows ?? []) {
      const fx = Number(r.fx_rate ?? 0.19);
      const totalC = Number(r.total_cny ?? 0);
      const paidC = Number(r.paid_cny ?? 0);
      const totalCad = totalC * fx;
      const paidCad = Number(r.paid_cad ?? 0) > 0 ? Number(r.paid_cad) : paidC * fx;
      totalCny += totalC;
      total += totalCad;
      count++;
      if (r.status === "paid") {
        paidCny += paidC;
        paid += paidCad > 0 ? paidCad : totalCad;
        paidCount++;
      } else if (r.status === "overdue") {
        overdueCny += totalC;
        overdue += totalCad;
      } else if (r.status === "unpaid") {
        unpaidCny += totalC;
        unpaid += totalCad;
      }
    }
    return {
      currency: "CAD",
      total_cad: +total.toFixed(2),
      paid_cad: +paid.toFixed(2),
      unpaid_cad: +unpaid.toFixed(2),
      overdue_cad: +overdue.toFixed(2),
      total_cny: +totalCny.toFixed(2),
      paid_cny: +paidCny.toFixed(2),
      unpaid_cny: +unpaidCny.toFixed(2),
      overdue_cny: +overdueCny.toFixed(2),
      count,
      paid_count: paidCount,
    };
  });

// ---- Merge unpaid invoices of the same user into one ----
export const mergeInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[]; note?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    if (!data.ids?.length || data.ids.length < 2) throw new Error("至少选择两张账单");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: invs } = await supabaseAdmin.from("invoices").select("*").in("id", data.ids);
    if (!invs || invs.length !== data.ids.length) throw new Error("账单不存在");
    const uid = invs[0].user_id;
    if (!invs.every((i) => i.user_id === uid)) throw new Error("只能合并同一客户的账单");
    if (!invs.every((i) => i.status === "unpaid")) throw new Error("仅支持合并未付账单");

    const sum = (k: string) => invs.reduce((s, i) => s + Number((i as any)[k] || 0), 0);
    const total = +sum("total_cny").toFixed(2);
    const fx = invs[0].fx_rate ?? 0.19;

    const { data: newInv, error } = await supabaseAdmin
      .from("invoices")
      .insert({
        user_id: uid,
        type: "merge",
        subtotal_cny: total,
        freight_cny: +sum("freight_cny").toFixed(2),
        customs_cny: +sum("customs_cny").toFixed(2),
        insurance_cny: +sum("insurance_cny").toFixed(2),
        total_cny: total,
        fx_rate: fx,
        due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        created_by: context.userId,
        note: data.note ?? `合并: ${invs.map((i) => i.invoice_no).join(", ")}`,
      } as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    // Move items
    await supabaseAdmin.from("invoice_items").update({ invoice_id: newInv.id }).in("invoice_id", data.ids);
    // Void originals
    await supabaseAdmin
      .from("invoices")
      .update({ status: "void", note: `合并到 ${newInv.invoice_no}` })
      .in("id", data.ids);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "invoice",
      entity_id: newInv.id,
      action: "merge",
      after: { invoice_no: newInv.invoice_no, total_cny: total, merged_from: data.ids },
      operator_id: context.userId,
    });
    return { ok: true, invoice: newInv };
  });

// ---- Split one invoice by selected item ids into a new invoice ----
export const splitInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; item_ids: string[]; note?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    if (!data.item_ids?.length) throw new Error("请选择要拆出的明细");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: inv } = await supabaseAdmin.from("invoices").select("*").eq("id", data.id).maybeSingle();
    if (!inv) throw new Error("账单不存在");
    if (inv.status !== "unpaid") throw new Error("仅未付账单可拆分");
    const { data: items } = await supabaseAdmin.from("invoice_items").select("*").eq("invoice_id", data.id);
    if (!items?.length) throw new Error("无明细");
    const toMove = items.filter((i) => data.item_ids.includes(i.id));
    const remain = items.filter((i) => !data.item_ids.includes(i.id));
    if (!toMove.length || !remain.length) throw new Error("拆分后两边都需保留至少一条明细");

    const sum = (rows: any[], k: string) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    const newTotal = +sum(toMove, "amount_cny").toFixed(2);

    const { data: newInv, error } = await supabaseAdmin
      .from("invoices")
      .insert({
        user_id: inv.user_id,
        type: "split",
        subtotal_cny: newTotal,
        freight_cny: +sum(toMove, "freight_cny").toFixed(2),
        customs_cny: +sum(toMove, "customs_cny").toFixed(2),
        insurance_cny: +sum(toMove, "insurance_cny").toFixed(2),
        total_cny: newTotal,
        fx_rate: inv.fx_rate,
        due_date: inv.due_date,
        created_by: context.userId,
        note: data.note ?? `从 ${inv.invoice_no} 拆出`,
      } as any)
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("invoice_items").update({ invoice_id: newInv.id }).in("id", data.item_ids);

    // Recompute original totals
    const remainTotal = +sum(remain, "amount_cny").toFixed(2);
    await supabaseAdmin
      .from("invoices")
      .update({
        subtotal_cny: remainTotal,
        freight_cny: +sum(remain, "freight_cny").toFixed(2),
        customs_cny: +sum(remain, "customs_cny").toFixed(2),
        insurance_cny: +sum(remain, "insurance_cny").toFixed(2),
        total_cny: remainTotal,
        note: (inv.note ? inv.note + " · " : "") + `拆分: 新出 ${newInv.invoice_no}`,
      } as any)
      .eq("id", data.id);

    await recordAdminLog(supabaseAdmin, {
      entity_type: "invoice",
      entity_id: newInv.id,
      action: "split",
      after: { invoice_no: newInv.invoice_no, total_cny: newTotal, split_from: data.id },
      operator_id: context.userId,
    });

    return { ok: true, invoice: newInv };
  });

// ---- Offline payments ----
export const listOfflinePayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { invoice_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("offline_payments")
      .select("*")
      .eq("invoice_id", data.invoice_id)
      .order("paid_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

export const addOfflinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      invoice_id: string;
      method: string;
      amount_cad: number;
      reference?: string;
      paid_at?: string;
      attachment_url?: string;
      note?: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (!(data.amount_cad > 0)) throw new Error("金额必须 > 0");
    const { data: row, error } = await supabaseAdmin
      .from("offline_payments")
      .insert({
        invoice_id: data.invoice_id,
        method: data.method,
        amount_cad: data.amount_cad,
        reference: data.reference || null,
        paid_at: data.paid_at || new Date().toISOString(),
        attachment_url: data.attachment_url || null,
        note: data.note || null,
        recorded_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "offline_payment",
      entity_id: row.id,
      action: "create",
      after: { invoice_id: data.invoice_id, amount_cad: data.amount_cad, method: data.method },
      operator_id: context.userId,
    });
    return { ok: true, payment: row };
  });

export const deleteOfflinePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("offline_payments").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("offline_payments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "offline_payment",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ---- 批次账单：批次详情页展示 / 下载 ----
export const listBatchInvoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { batchNo: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("invoices")
      .select("*")
      .eq("batch_no", data.batchNo)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const userIds = Array.from(new Set((rows ?? []).map((r: any) => r.user_id)));
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, customer_code, email")
      .in("id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    const map = new Map((profs ?? []).map((p: any) => [p.id, p]));
    return { items: (rows ?? []).map((r: any) => ({ ...r, customer: map.get(r.user_id) ?? null })) };
  });
