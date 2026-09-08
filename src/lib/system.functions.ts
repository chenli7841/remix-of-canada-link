import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAdminLog } from "@/lib/admin-log";

async function assertOwnerOrManager(supabase: any, userId: string) {
  const [{ data: o }, { data: m }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "manager" }),
  ]);
  if (!o && !m) throw new Error("Forbidden: owner/manager only");
}
async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

export const getAppSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { keys?: string[] } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("app_settings").select("*");
    if (data.keys?.length) q = q.in("key", data.keys);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const map: Record<string, any> = {};
    for (const r of rows ?? []) map[r.key] = r.value;
    return { settings: map };
  });

export const setAppSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { key: string; value: any }) => d)
  .handler(async ({ data, context }) => {
    await assertOwnerOrManager(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({ key: data.key, value: data.value }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "app_setting",
      entity_id: data.key,
      action: "set",
      after: { value: data.value },
      operator_id: context.userId,
    });
    return { ok: true };
  });
