import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAdminLog } from "@/lib/admin-log";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

// HS 库变动后，重算受影响集运单下所有运单的关税明细（waybill_items）。
// 受影响 = forwarding_items 直接绑定了该 hs_code，或品名/别名命中该 HS 且未手工绑定。
async function recomputeForwardingsForHs(
  admin: any,
  opts: { hs_code?: string | null; names?: (string | null | undefined)[] },
) {
  try {
    const orFilters: string[] = [];
    if (opts.hs_code) orFilters.push(`hs_code.eq.${opts.hs_code}`);
    const names = Array.from(new Set((opts.names ?? []).map((n) => (n ?? "").trim()).filter(Boolean)));
    let byName: any[] = [];
    if (names.length) {
      const { data } = await admin
        .from("forwarding_items")
        .select("forwarding_id, name, hs_code")
        .in("name", names);
      byName = (data ?? []).filter((r: any) => !r.hs_code); // 未手工绑定的才受名称匹配影响
    }
    let byCode: any[] = [];
    if (opts.hs_code) {
      const { data } = await admin.from("forwarding_items").select("forwarding_id").eq("hs_code", opts.hs_code);
      byCode = data ?? [];
    }
    const fwdIds = Array.from(
      new Set([...byName, ...byCode].map((r: any) => r.forwarding_id).filter(Boolean)),
    ) as string[];
    if (!fwdIds.length) return;
    const { persistWaybillItemsForParent } = await import("./duty.server");
    for (const fid of fwdIds) {
      await persistWaybillItemsForParent(admin, { forwarding_id: fid });
    }
  } catch (e) {
    console.error("recomputeForwardingsForHs failed:", e);
  }
}

// ilike 通配符 (% _) 在搜索词里本来就有特殊含义——不转义的话，品名/编码里若恰好出现
// 这两个字符，搜索会被当成通配符而不是字面量。用 \ 转义成字面量（Postgres ILIKE 默认转义符）。
function escapeIlike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

export const listHsCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { search?: string; chapter?: string; active?: boolean; page?: number; pageSize?: number } = {}) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // 分页：不管有没有搜索词，都走 range 分页 + 精确总数，不再对全表套一刀切的 limit(1000)
    // ——超过 1000 条的编码库，1000 条之后的记录之前完全无法被浏览/搜索到。
    const pageSize = Math.min(200, Math.max(1, Math.floor(data.pageSize ?? 50)));
    const page = Math.max(1, Math.floor(data.page ?? 1));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    let q = supabaseAdmin.from("hs_codes").select("*", { count: "exact" }).order("hs_code", { ascending: true });
    if (data.search?.trim()) {
      const s = escapeIlike(data.search.trim());
      // 支持 HS 编码 / 中英文品名 / 别名（aliases 数组）模糊匹配——针对全表搜索，不受分页影响
      q = q.or(`hs_code.ilike.%${s}%,name_zh.ilike.%${s}%,name_en.ilike.%${s}%,aliases.cs.{${s}}`);
    }
    if (data.chapter) q = q.eq("chapter", data.chapter);
    if (typeof data.active === "boolean") q = q.eq("is_active", data.active);
    const { data: rows, error, count } = await q.range(from, to);

    if (error) throw new Error(error.message);
    return { items: rows ?? [], total: count ?? 0, page, pageSize };
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
    // 税率/别名变动 → 重算受影响集运单的关税明细
    await recomputeForwardingsForHs(supabaseAdmin, {
      hs_code: code,
      names: [payload.name_zh, payload.name_en, ...(payload.aliases ?? [])],
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
    if (before) {
      await recomputeForwardingsForHs(supabaseAdmin, {
        hs_code: (before as any).hs_code,
        names: [(before as any).name_zh, (before as any).name_en, ...((before as any).aliases ?? [])],
      });
    }
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
    // 新别名 → 该品名的未绑定物品现在能匹配上，重算
    await recomputeForwardingsForHs(supabaseAdmin, { hs_code: data.hs_code, names: [name] });
    return { ok: true };
  });

// 为单条集运物品手动指定 HS 编码（覆盖名称匹配）
export const setForwardingItemHs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { item_id: string; hs_code: string | null }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("forwarding_items")
      .select("forwarding_id")
      .eq("id", data.item_id)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("forwarding_items")
      .update({ hs_code: data.hs_code || null, hs_confirmed: !!data.hs_code, hs_matched: data.hs_code ? "manual" : "none" })
      .eq("id", data.item_id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "forwarding_item",
      entity_id: data.item_id,
      action: "set_hs_code",
      after: { hs_code: data.hs_code },
      operator_id: context.userId,
    });
    // 该集运单下所有运单的关税明细重算
    if ((before as any)?.forwarding_id) {
      try {
        const { persistWaybillItemsForParent } = await import("./duty.server");
        await persistWaybillItemsForParent(supabaseAdmin, { forwarding_id: (before as any).forwarding_id });
      } catch (e) {
        console.error("persistWaybillItemsForParent failed (setForwardingItemHs)", e);
      }
    }
    return { ok: true };
  });

// 手动重算一个集运单 / 电商订单下所有运单的关税明细（waybill_items）。
// 供员工在订单详情 / 运单关税卡片主动触发。
export const recomputeParentDuty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { forwardingId?: string; orderId?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { persistWaybillItemsForParent } = await import("./duty.server");
    const n = await persistWaybillItemsForParent(supabaseAdmin, {
      forwarding_id: data.forwardingId ?? null,
      order_id: data.orderId ?? null,
    });
    return { ok: true, waybills: n };
  });
