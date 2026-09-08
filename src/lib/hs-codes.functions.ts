import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAdminLog } from "@/lib/admin-log";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

export const listHsCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { search?: string; chapter?: string; active?: boolean } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin.from("hs_codes").select("*").order("hs_code", { ascending: true }).limit(1000);
    if (data.search?.trim()) {
      const s = data.search.trim();
      // 支持 HS 编码 / 中英文品名 / 别名（aliases 数组）模糊匹配
      q = q.or(`hs_code.ilike.%${s}%,name_zh.ilike.%${s}%,name_en.ilike.%${s}%,aliases.cs.{${s}}`);
    }
    if (data.chapter) q = q.eq("chapter", data.chapter);
    if (typeof data.active === "boolean") q = q.eq("is_active", data.active);
    const { data: rows, error } = await q;

    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

export const upsertHsCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id?: string;
      hs_code: string;
      chapter?: string;
      name_zh: string;
      name_en?: string;
      unit?: string;
      mfn_rate?: number;
      gst_rate?: number;
      anti_dumping_rate?: number;
      anti_dumping_note?: string;
      surtax_rate?: number;
      surtax_note?: string;
      excise_rate?: number;
      excise_note?: string;
      mfn_text?: string;
      parent_description?: string;
      import_control?: string[];
      requires_permit?: boolean;
      control_note?: string;
      is_hazmat?: boolean;
      contains_battery?: boolean;
      note?: string;
      material?: string;
      origin?: string;
      aliases?: string[];
      sima_involved?: boolean;
      is_active?: boolean;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const code = data.hs_code.replace(/\s+/g, "").trim();
    if (!code) throw new Error("HS 编码不能为空");
    const payload: any = {
      hs_code: code,
      chapter: data.chapter ?? code.slice(0, 2),
      name_zh: data.name_zh,
      name_en: data.name_en ?? null,
      unit: data.unit ?? null,
      mfn_rate: data.mfn_rate ?? 0,
      gst_rate: data.gst_rate ?? 0.05,
      anti_dumping_rate: data.anti_dumping_rate ?? 0,
      anti_dumping_note: data.anti_dumping_note ?? null,
      surtax_rate: data.surtax_rate ?? 0,
      surtax_note: data.surtax_note?.trim() || null,
      excise_rate: data.excise_rate ?? 0,
      excise_note: data.excise_note?.trim() || null,
      mfn_text: data.mfn_text?.trim() || null,
      parent_description: data.parent_description?.trim() || null,
      import_control: (data.import_control ?? []).map((s) => s.trim()).filter(Boolean),
      requires_permit: data.requires_permit ?? false,
      control_note: data.control_note?.trim() || null,
      is_hazmat: data.is_hazmat ?? false,
      contains_battery: data.contains_battery ?? false,
      note: data.note ?? null,
      material: data.material?.trim() || null,
      // 产地固定默认 China（可手工覆盖）
      origin: data.origin?.trim() || "China",
      aliases: (data.aliases ?? []).map((s) => s.trim()).filter(Boolean),
      sima_involved: data.sima_involved ?? false,
      is_active: data.is_active ?? true,
    };


    let id = data.id;
    if (data.id) {
      const { error } = await supabaseAdmin.from("hs_codes").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { data: ins, error } = await supabaseAdmin.from("hs_codes").insert(payload).select("id").single();
      if (error) throw new Error(error.message);
      id = ins!.id;
    }
    await recordAdminLog(supabaseAdmin, {
      entity_type: "hs_code",
      entity_id: id!,
      action: data.id ? "update" : "create",
      after: payload,
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const deleteHsCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("hs_codes").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("hs_codes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "hs_code",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });

// 把品名追加到指定 HS 的 aliases（去重），便于以后自动匹配
export const bindNameToHs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { hs_code: string; name: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const name = (data.name ?? "").trim();
    if (!name) throw new Error("name required");
    const { data: row, error: e1 } = await supabaseAdmin
      .from("hs_codes")
      .select("id, aliases")
      .eq("hs_code", data.hs_code)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!row) throw new Error("HS 编码不存在");
    const set = new Set<string>([...(row.aliases ?? []), name]);
    const { error } = await supabaseAdmin
      .from("hs_codes")
      .update({ aliases: [...set] })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "hs_code",
      entity_id: row.id,
      action: "bind_name",
      after: { name },
      operator_id: context.userId,
    });
    return { ok: true };
  });

// 为单条集运物品手动指定 HS 编码（覆盖名称匹配）
export const setForwardingItemHs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { item_id: string; hs_code: string | null }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("forwarding_items")
      .update({ hs_code: data.hs_code || null })
      .eq("id", data.item_id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "forwarding_item",
      entity_id: data.item_id,
      action: "set_hs_code",
      after: { hs_code: data.hs_code },
      operator_id: context.userId,
    });
    return { ok: true };
  });
