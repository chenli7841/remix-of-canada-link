import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAdminLog } from "@/lib/admin-log";

async function assertStaffOrSelf(supabase: any, userId: string, targetUserId: string) {
  if (userId === targetUserId) return;
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

export type CustomerHsItem = {
  id: string;
  user_id: string;
  sku: string | null;
  description: string;
  unit_price_cad: number | null;
  items_per_carton: number | null;
  ctns: number | null;
  hs_code: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export const listCustomerHsItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; search?: string } = { userId: "" }) => d)
  .handler(async ({ data, context }) => {
    await assertStaffOrSelf(context.supabase, context.userId, data.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("customer_hs_items")
      .select("*")
      .eq("user_id", data.userId)
      .order("sku", { ascending: true })
      .limit(2000);
    if (data.search?.trim()) {
      const s = data.search.trim();
      q = q.or(`sku.ilike.%${s}%,description.ilike.%${s}%,hs_code.ilike.%${s}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { items: (rows ?? []) as CustomerHsItem[] };
  });

export const upsertCustomerHsItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id?: string;
      user_id: string;
      sku?: string | null;
      description: string;
      unit_price_cad?: number | null;
      items_per_carton?: number | null;
      ctns?: number | null;
      hs_code?: string | null;
      note?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaffOrSelf(context.supabase, context.userId, data.user_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const payload: any = {
      user_id: data.user_id,
      sku: data.sku ?? null,
      description: (data.description ?? "").trim(),
      unit_price_cad: data.unit_price_cad ?? null,
      items_per_carton: data.items_per_carton ?? null,
      ctns: data.ctns ?? null,
      hs_code: (data.hs_code ?? "").trim() || null,
      note: data.note ?? null,
    };
    if (!payload.description) throw new Error("品名不能为空");
    // Only log when staff is acting on someone else's items — a customer
    // editing their own "我的物品" library is routine self-service, not an
    // admin operation.
    const isAdminAction = context.userId !== data.user_id;
    if (data.id) {
      const { error } = await supabaseAdmin.from("customer_hs_items").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      if (isAdminAction) {
        await recordAdminLog(supabaseAdmin, {
          entity_type: "customer_hs_item",
          entity_id: data.id,
          action: "update",
          after: payload,
          operator_id: context.userId,
          note: `代客户 ${data.user_id} 编辑物品`,
        });
      }
      return { ok: true, id: data.id };
    }
    const { data: row, error } = await supabaseAdmin.from("customer_hs_items").insert(payload).select("id").single();
    if (error) throw new Error(error.message);
    if (isAdminAction) {
      await recordAdminLog(supabaseAdmin, {
        entity_type: "customer_hs_item",
        entity_id: row.id,
        action: "create",
        after: payload,
        operator_id: context.userId,
        note: `代客户 ${data.user_id} 新增物品`,
      });
    }
    return { ok: true, id: row.id };
  });

export const deleteCustomerHsItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; user_id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaffOrSelf(context.supabase, context.userId, data.user_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("customer_hs_items").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (context.userId !== data.user_id) {
      await recordAdminLog(supabaseAdmin, {
        entity_type: "customer_hs_item",
        entity_id: data.id,
        action: "delete",
        operator_id: context.userId,
        note: `代客户 ${data.user_id} 删除物品`,
      });
    }
    return { ok: true };
  });

export const bulkImportCustomerHsItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      user_id: string;
      replace?: boolean;
      rows: Array<{
        sku?: string | null;
        description: string;
        unit_price_cad?: number | null;
        items_per_carton?: number | null;
        ctns?: number | null;
        hs_code?: string | null;
      }>;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaffOrSelf(context.supabase, context.userId, data.user_id);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows = (data.rows ?? [])
      .map((r) => ({
        user_id: data.user_id,
        sku: r.sku ?? null,
        description: (r.description ?? "").trim(),
        unit_price_cad: r.unit_price_cad ?? null,
        items_per_carton: r.items_per_carton ?? null,
        ctns: r.ctns ?? null,
        hs_code: (r.hs_code ?? "").trim() || null,
      }))
      .filter((r) => r.description);
    if (data.replace) {
      const { error: delErr } = await supabaseAdmin.from("customer_hs_items").delete().eq("user_id", data.user_id);
      if (delErr) throw new Error(delErr.message);
    }
    if (rows.length === 0) return { ok: true, inserted: 0 };
    const { error } = await supabaseAdmin.from("customer_hs_items").insert(rows);
    if (error) throw new Error(error.message);
    if (context.userId !== data.user_id) {
      await recordAdminLog(supabaseAdmin, {
        entity_type: "customer_hs_item",
        entity_id: data.user_id,
        action: "bulk_import",
        after: { count: rows.length, replace: !!data.replace },
        operator_id: context.userId,
        note: `代客户 ${data.user_id} 批量导入物品`,
      });
    }
    return { ok: true, inserted: rows.length };
  });
