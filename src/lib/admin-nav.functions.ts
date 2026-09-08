import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AppRole } from "@/lib/admin.functions";
import { recordAdminLog } from "@/lib/admin-log";

// Backs the admin sidebar (admin/route.tsx) and its owner-only settings page
// (admin/nav-settings.tsx): which roles can see each section, which category
// it's grouped under, and the display order of both groups and items.
// Any staff member can read this (they need it to build their own sidebar);
// only the owner can change it.

async function assertStaff(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_staff", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: staff only");
}
async function assertOwner(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "owner" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: owner only");
}

export interface NavItemRow {
  id: string;
  path: string;
  label: string;
  icon: string;
  group_title: string;
  group_sort_order: number;
  item_sort_order: number;
  roles: AppRole[];
}

// Read-only for any staff member — used to render their own sidebar.
export const listNavItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("admin_nav_items")
      .select("*")
      .order("group_sort_order", { ascending: true })
      .order("item_sort_order", { ascending: true });
    if (error) throw new Error(error.message);
    return { items: (data ?? []) as unknown as NavItemRow[] };
  });

// Owner-only: bulk-save the full nav config (roles / group / order per item).
export const saveNavConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      items: Array<{
        id: string;
        group_title: string;
        group_sort_order: number;
        item_sort_order: number;
        roles: string[];
      }>;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    for (const it of data.items) {
      const { error } = await supabaseAdmin
        .from("admin_nav_items")
        .update({
          group_title: it.group_title,
          group_sort_order: it.group_sort_order,
          item_sort_order: it.item_sort_order,
          roles: it.roles,
        })
        .eq("id", it.id);
      if (error) throw new Error(error.message);
    }
    await recordAdminLog(supabaseAdmin, {
      entity_type: "nav_config",
      entity_id: "nav_config",
      action: "save",
      after: { item_count: data.items.length },
      operator_id: context.userId,
    });
    return { ok: true };
  });
