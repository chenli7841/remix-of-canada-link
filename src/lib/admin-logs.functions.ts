import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

export type AdminLog = {
  id: string;
  entity_type: string;
  entity_id: string;
  action: string;
  before: any;
  after: any;
  operator_id: string | null;
  operator_name: string | null;
  note: string | null;
  created_at: string;
};

export const listAdminLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      d: {
        entity_type?: string;
        entity_id?: string;
        action?: string;
        q?: string;
        date_from?: string;
        date_to?: string;
        page?: number;
        pageSize?: number;
      } = {},
    ) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(200, Math.max(5, data.pageSize ?? 20));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("admin_action_logs")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false });
    if (data.entity_type) q = q.eq("entity_type", data.entity_type);
    if (data.entity_id) q = q.eq("entity_id", data.entity_id);
    if (data.action) q = q.eq("action", data.action);
    if (data.date_from) q = q.gte("created_at", new Date(data.date_from).toISOString());
    if (data.date_to) {
      const to = new Date(data.date_to);
      to.setDate(to.getDate() + 1);
      q = q.lt("created_at", to.toISOString());
    }
    if (data.q?.trim()) {
      const s = data.q.trim();
      q = q.or(`operator_name.ilike.%${s}%,note.ilike.%${s}%,entity_id.ilike.%${s}%`);
    }
    const from = (page - 1) * pageSize;
    const { data: rows, error, count } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return { items: (rows ?? []) as AdminLog[], total: count ?? 0, page, pageSize };
  });

export const logFacets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("admin_action_logs")
      .select("entity_type, action")
      .order("created_at", { ascending: false })
      .limit(3000);
    if (error) throw new Error(error.message);
    const types = Array.from(new Set((rows ?? []).map((r: any) => r.entity_type).filter(Boolean))).sort() as string[];
    const actions = Array.from(new Set((rows ?? []).map((r: any) => r.action).filter(Boolean))).sort() as string[];
    return { types, actions };
  });
