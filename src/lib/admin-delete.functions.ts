import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const deleteWaybill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { assertManagerLevel, operatorName, logDelete } = await import("./admin-delete.server");
    await assertManagerLevel(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("waybills").select("*").eq("id", data.id).maybeSingle();
    if (!before) throw new Error("运单不存在");
    await supabaseAdmin.from("order_items").update({ waybill_id: null } as any).eq("waybill_id", data.id);
    await supabaseAdmin.from("invoice_items").update({ waybill_id: null } as any).eq("waybill_id", data.id);
    const { error } = await supabaseAdmin.from("waybills").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logDelete(supabaseAdmin, {
      entity_type: "waybill",
      entity_id: data.id,
      before,
      operator_id: context.userId,
      operator_name: await operatorName(supabaseAdmin, context.userId),
      note: `删除运单 ${(before as any).waybill_no ?? ""}`,
    });
    return { ok: true };
  });

export const deleteOrderRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { assertManagerLevel, operatorName, logDelete } = await import("./admin-delete.server");
    await assertManagerLevel(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("orders").select("*").eq("id", data.id).maybeSingle();
    if (!before) throw new Error("订单不存在");
    const { data: wbs } = await supabaseAdmin.from("waybills").select("id").eq("order_id", data.id);
    const wbIds = (wbs ?? []).map((w: any) => w.id);
    if (wbIds.length) {
      await supabaseAdmin.from("invoice_items").update({ waybill_id: null } as any).in("waybill_id", wbIds);
    }
    const { error } = await supabaseAdmin.from("orders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logDelete(supabaseAdmin, {
      entity_type: "order",
      entity_id: data.id,
      before,
      operator_id: context.userId,
      operator_name: await operatorName(supabaseAdmin, context.userId),
      note: `删除订单 ${(before as any).order_no ?? ""}（含 ${wbIds.length} 张运单）`,
    });
    return { ok: true };
  });

export const deleteForwardingRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { assertManagerLevel, operatorName, logDelete } = await import("./admin-delete.server");
    await assertManagerLevel(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("forwarding_orders").select("*").eq("id", data.id).maybeSingle();
    if (!before) throw new Error("集运单不存在");
    const { data: wbs } = await supabaseAdmin.from("waybills").select("id").eq("forwarding_id", data.id);
    const wbIds = (wbs ?? []).map((w: any) => w.id);
    if (wbIds.length) {
      await supabaseAdmin.from("invoice_items").update({ waybill_id: null } as any).in("waybill_id", wbIds);
    }
    const { error } = await supabaseAdmin.from("forwarding_orders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logDelete(supabaseAdmin, {
      entity_type: "forwarding",
      entity_id: data.id,
      before,
      operator_id: context.userId,
      operator_name: await operatorName(supabaseAdmin, context.userId),
      note: `删除集运单 ${(before as any).request_no ?? ""}（含 ${wbIds.length} 张运单）`,
    });
    return { ok: true };
  });

export const deleteBatchRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { assertManagerLevel, operatorName, logDelete } = await import("./admin-delete.server");
    await assertManagerLevel(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("batches").select("*").eq("id", data.id).maybeSingle();
    if (!before) throw new Error("批次不存在");
    // 解绑下属对象，不删除运单 / 箱号 / 托盘本身
    await supabaseAdmin.from("waybills").update({ assigned_batch_id: null } as any).eq("assigned_batch_id", data.id);
    await supabaseAdmin.from("cartons").update({ batch_id: null } as any).eq("batch_id", data.id);
    await supabaseAdmin.from("pallets").update({ batch_id: null } as any).eq("batch_id", data.id);
    const { error } = await supabaseAdmin.from("batches").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logDelete(supabaseAdmin, {
      entity_type: "batch",
      entity_id: data.id,
      before,
      operator_id: context.userId,
      operator_name: await operatorName(supabaseAdmin, context.userId),
      note: `删除批次 ${(before as any).batch_no ?? ""}（下属运单/箱号/托盘已解绑）`,
    });
    return { ok: true };
  });
