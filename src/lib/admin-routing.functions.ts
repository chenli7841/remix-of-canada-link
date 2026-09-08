import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * 管理员变更订单 / 集运单线路：
 * - 调用数据库 admin_change_route RPC
 * - 自动生成新的订单号 / 所有运单号、把旧号写入 aliases、重算唛头号
 * - 写入 admin_action_logs 操作日志
 */
export const adminChangeRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    entityType: "order" | "forwarding";
    entityId: string;
    newRouteCode: string;
    note?: string;
  }) => d)
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ok } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!ok) throw new Error("Forbidden");
    const { data: result, error } = await supabaseAdmin.rpc("admin_change_route", {
      _entity_type: data.entityType,
      _entity_id: data.entityId,
      _new_route_code: data.newRouteCode,
      _operator_id: context.userId,
      _note: data.note ?? undefined,
    });
    if (error) throw new Error(error.message);
    if (data.entityType === "forwarding") {
      const { recomputeForwardingTotal } = await import("@/lib/orders.functions");
      await recomputeForwardingTotal(supabaseAdmin, data.entityId);
    }
    return result as { ok: boolean; old_no?: string; new_no?: string; waybills_changed?: number; unchanged?: boolean };
  });

/** 通过任意单号 (运单 / 电商订单 / 集运单, 支持旧号、忽略线路目的地段) 查找实体 */
export const findByAnyNo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { code: string }) => d)
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!ok) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: result } = await supabaseAdmin.rpc("find_by_any_no", { _input: data.code });
    return result as null | {
      kind: "waybill" | "order" | "forwarding";
      id: string;
      no: string;
      order_id?: string | null;
      forwarding_id?: string | null;
    };
  });

/** 管理员编辑单条运单的尺寸 / 重量 */
export const adminUpdateWaybillDims = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    waybillId: string;
    weight_kg?: number | null;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
  }) => d)
  .handler(async ({ data, context }) => {
    const { data: ok } = await context.supabase.rpc("is_staff", { _user_id: context.userId });
    if (!ok) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("waybills").select("weight_kg, length_cm, width_cm, height_cm").eq("id", data.waybillId).maybeSingle();
    const patch: any = {};
    (["weight_kg","length_cm","width_cm","height_cm"] as const).forEach((k) => {
      if (data[k] !== undefined) patch[k] = data[k];
    });
    const { error } = await supabaseAdmin.from("waybills").update(patch).eq("id", data.waybillId);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("admin_action_logs").insert({
      entity_type: "waybill", entity_id: data.waybillId, action: "update_dims",
      before, after: patch, operator_id: context.userId, note: "编辑运单尺寸/重量",
    });
    // Recompute per-waybill fees and parent forwarding totals
    const { data: wb } = await supabaseAdmin.from("waybills").select("forwarding_id").eq("id", data.waybillId).maybeSingle();
    if (wb?.forwarding_id) {
      const { recomputeForwardingTotal } = await import("@/lib/orders.functions");
      await recomputeForwardingTotal(supabaseAdmin, wb.forwarding_id);
    }
    return { ok: true };
  });
