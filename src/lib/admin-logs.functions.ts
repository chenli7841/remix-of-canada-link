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
        entity_types?: string[];
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
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (data.entity_type) q = q.eq("entity_type", data.entity_type);
    if (data.entity_types?.length) q = q.in("entity_type", data.entity_types);
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

export const listAuditChildren = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: "batch" | "route" | "trip"; id: string }) => {
    if (!["batch", "route", "trip"].includes(d.kind) || !d.id) throw new Error("记录范围无效");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const rows: { id: string; label: string }[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = data.kind === "batch"
        ? await supabaseAdmin.from("batch_settlements").select("id,customer_code").eq("batch_id", data.id).order("id").range(offset, offset + 499)
        : data.kind === "route"
        ? await supabaseAdmin.from("freight_rules").select("id").eq("route_id", data.id).order("id").range(offset, offset + 499)
        : await supabaseAdmin.from("driver_trips").select("id,created_at").eq("loading_trip_id", data.id).order("id").range(offset, offset + 499);
      if (result.error) throw new Error("关联记录读取失败");
      rows.push(...(result.data ?? []).map((r: any, i: number) => ({id:r.id, label:data.kind === "batch" ? `客户 ${r.customer_code} 结算` : data.kind === "route" ? `运费规则 ${offset + i + 1}` : `派送趟 ${r.created_at}`})));
      if ((result.data ?? []).length < 500) break;
    }
    return rows;
  });
