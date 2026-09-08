import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

const FORWARDING_DONE = ["delivered", "completed"];
const SHOP_DONE = ["delivered", "completed", "received"];
const WAYBILL_DONE = ["delivered", "received"];

export const listHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind?: "forwarding" | "shop" | "waybill"; q?: string; limit?: number } | undefined) => d ?? {})
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const kind = data.kind ?? "forwarding";
    const limit = Math.min(Math.max(data.limit ?? 200, 1), 500);
    const q = (data.q ?? "").trim();

    if (kind === "forwarding") {
      let query = supabaseAdmin.from("forwarding_orders")
        .select("id, request_no, status, customer_code, weight_kg, fee_cny, tracking_no, batch_no, created_at, updated_at, user_id")
        .in("status", FORWARDING_DONE as any)
        .order("updated_at", { ascending: false }).limit(limit);
      if (q) query = query.or(`request_no.ilike.%${q}%,customer_code.ilike.%${q}%,tracking_no.ilike.%${q}%`);
      const { data: rows, error } = await query;
      if (error) throw new Error(error.message);
      return { items: rows ?? [] };
    }
    if (kind === "shop") {
      let query = supabaseAdmin.from("orders")
        .select("id, order_no, status, total_cny, tracking_no, customer_code, paid_at, shipped_at, completed_at, created_at, updated_at, user_id")
        .in("status", SHOP_DONE as any)
        .order("updated_at", { ascending: false }).limit(limit);
      if (q) query = query.or(`order_no.ilike.%${q}%,customer_code.ilike.%${q}%,tracking_no.ilike.%${q}%`);
      const { data: rows, error } = await query;
      if (error) throw new Error(error.message);
      return { items: rows ?? [] };
    }
    // waybill
    let query = supabaseAdmin.from("waybills")
      .select("id, waybill_no, status, weight_kg, freight_cad, intl_tracking_no, batch_no, created_at, updated_at, user_id, order_id, forwarding_id")
      .in("status", WAYBILL_DONE as any)
      .order("updated_at", { ascending: false }).limit(limit);
    if (q) query = query.or(`waybill_no.ilike.%${q}%,intl_tracking_no.ilike.%${q}%`);
    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });
