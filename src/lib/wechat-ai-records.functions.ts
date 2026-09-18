/**
 * 后台「微信 AI 客服记录」的服务端接口。
 * 只有 staff 可读；绑定关系的变更仅限 owner / manager，并强制写入审计。
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertStaff(supabase: any, userId: string) {
  const { data } = await supabase.rpc("is_staff", { _user_id: userId });
  if (!data) throw new Error("Forbidden");
}

async function assertManager(supabase: any, userId: string) {
  const [owner, manager] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "manager" }),
  ]);
  if (!owner.data && !manager.data) throw new Error("Forbidden");
}

/** 微信身份脱敏展示 */
function mask(id?: string | null): string {
  const s = String(id ?? "");
  if (!s) return "";
  if (s.length <= 8) return `${s.slice(0, 2)}****`;
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}

export const listWechatConversations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q?: string; page?: number; pageSize?: number; date_from?: string; date_to?: string } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, data.pageSize ?? 20));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("wechat_ai_conversations")
      .select("*", { count: "exact" })
      .order("last_message_at", { ascending: false });
    if (data.q?.trim()) {
      const s = data.q.trim();
      q = q.or(`customer_code.ilike.%${s}%,external_userid.ilike.%${s}%,last_tracking_number.ilike.%${s}%`);
    }
    if (data.date_from) q = q.gte("last_message_at", new Date(data.date_from).toISOString());
    if (data.date_to) {
      const to = new Date(data.date_to);
      to.setDate(to.getDate() + 1);
      q = q.lt("last_message_at", to.toISOString());
    }
    const from = (page - 1) * pageSize;
    const { data: rows, count } = await q.range(from, from + pageSize - 1);
    const list = (rows ?? []) as any[];

    // 绑定状态必须来自当前 active 永久绑定，不能只信会话上的旧字段
    const ids = Array.from(new Set(list.map((r) => r.external_userid).filter(Boolean)));
    const bindings = ids.length
      ? (
          await supabaseAdmin
            .from("wechat_identity_bindings")
            .select("external_userid, customer_code, status")
            .in("external_userid", ids)
        ).data ?? []
      : [];
    const activeByUser = new Map<string, string>();
    for (const b of bindings as any[]) {
      if ((b.status ?? "active") === "active" && b.external_userid) activeByUser.set(b.external_userid, b.customer_code);
    }

    return {
      total: count ?? 0,
      items: list.map((r) => {
        const boundCode = activeByUser.get(r.external_userid) ?? null;
        return {
          ...r,
          customer_code: boundCode ?? r.customer_code ?? null,
          bound: Boolean(boundCode),
          external_userid_masked: mask(r.external_userid),
        };
      }),
    };

  });

export const getWechatConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [conv, messages, runs, tools, drafts] = await Promise.all([
      supabaseAdmin.from("wechat_ai_conversations").select("*").eq("id", data.id).maybeSingle(),
      supabaseAdmin
        .from("wechat_ai_messages")
        .select("*")
        .eq("conversation_id", data.id)
        .order("created_at", { ascending: true })
        .limit(500),
      supabaseAdmin
        .from("wechat_ai_agent_runs")
        .select("*")
        .eq("conversation_id", data.id)
        .order("created_at", { ascending: false })
        .limit(200),
      supabaseAdmin
        .from("wechat_ai_tool_runs")
        .select("*")
        .eq("conversation_id", data.id)
        .order("created_at", { ascending: false })
        .limit(300),
      supabaseAdmin
        .from("wechat_forwarding_drafts")
        .select("*")
        .eq("conversation_id", data.id)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const draftIds = ((drafts.data ?? []) as any[]).map((d) => d.id);
    const events = draftIds.length
      ? (
          await supabaseAdmin
            .from("wechat_forwarding_draft_events")
            .select("*")
            .in("draft_id", draftIds)
            .order("created_at", { ascending: true })
            .limit(300)
        ).data ?? []
      : [];
    const c: any = conv.data;
    return {
      conversation: c ? { ...c, external_userid_masked: mask(c.external_userid) } : null,
      messages: messages.data ?? [],
      runs: runs.data ?? [],
      tools: tools.data ?? [],
      drafts: drafts.data ?? [],
      draftEvents: events,
    };
  });

export const listWechatBindings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q?: string; page?: number; pageSize?: number } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, data.pageSize ?? 20));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("wechat_identity_bindings")
      .select("*", { count: "exact" })
      .order("updated_at", { ascending: false });
    if (data.q?.trim()) {
      const s = data.q.trim();
      q = q.or(`customer_code.ilike.%${s}%,external_userid.ilike.%${s}%,chat_id.ilike.%${s}%`);
    }
    const from = (page - 1) * pageSize;
    const { data: rows, count } = await q.range(from, from + pageSize - 1);
    return {
      total: count ?? 0,
      items: ((rows ?? []) as any[]).map((r) => ({ ...r, external_userid_masked: mask(r.external_userid) })),
    };
  });

export const updateWechatBinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; action: "disable" | "enable" | "unbind" | "rebind"; customer_code?: string; reason: string }) => d)
  .handler(async ({ data, context }) => {
    await assertManager(context.supabase, context.userId);
    if (!data.reason?.trim()) throw new Error("请填写操作原因");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("wechat_identity_bindings")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (!before) throw new Error("绑定记录不存在");

    const now = new Date().toISOString();
    let patch: Record<string, unknown> = { updated_at: now };
    if (data.action === "disable") patch = { ...patch, status: "disabled" };
    if (data.action === "enable") patch = { ...patch, status: "active", unbound_at: null };
    if (data.action === "unbind") patch = { ...patch, status: "unbound", unbound_at: now, verified: false };
    if (data.action === "rebind") {
      const code = String(data.customer_code ?? "").trim();
      if (!code) throw new Error("请填写新的客户号");
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("id, customer_code")
        .eq("customer_code", code)
        .maybeSingle();
      if (!profile) throw new Error("客户号不存在");
      patch = { ...patch, customer_code: profile.customer_code, user_id: profile.id, status: "active", unbound_at: null, bound_at: now };
    }

    const { data: after, error } = await supabaseAdmin
      .from("wechat_identity_bindings")
      .update(patch as never)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);

    await supabaseAdmin.from("wechat_ai_admin_audit").insert({
      admin_user_id: context.userId,
      action: data.action,
      target_type: "wechat_identity_binding",
      target_id: data.id,
      before_data: { customer_code: (before as any).customer_code, status: (before as any).status ?? "active" },
      after_data: { customer_code: (after as any)?.customer_code, status: (after as any)?.status },
      reason: data.reason.trim(),
    });
    return { ok: true };
  });

export const listWechatAiAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { limit?: number } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin
      .from("wechat_ai_admin_audit")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Math.min(200, data.limit ?? 50));
    return rows ?? [];
  });

/** GPT / website support messages grouped by the OAuth customer account. */
export const listAiSupportThreads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { q?: string; limit?: number } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let query = supabaseAdmin
      .from("ai_support_threads")
      .select("*")
      .order("last_message_at", { ascending: false })
      .limit(Math.min(100, Math.max(1, data.limit ?? 50)));
    if (data.q?.trim()) query = query.ilike("customer_code", `%${data.q.trim()}%`);
    const { data: threads, error } = await query;
    if (error) throw new Error(error.message);
    return threads ?? [];
  });

export const getAiSupportThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [thread, messages] = await Promise.all([
      supabaseAdmin.from("ai_support_threads").select("*").eq("id", data.id).maybeSingle(),
      supabaseAdmin.from("ai_support_messages").select("*").eq("thread_id", data.id).order("created_at", { ascending: true }).limit(500),
    ]);
    if (thread.error) throw new Error(thread.error.message);
    if (messages.error) throw new Error(messages.error.message);
    await Promise.all([
      supabaseAdmin.from("ai_support_messages").update({ read_by_staff_at: new Date().toISOString() }).eq("thread_id", data.id).is("read_by_staff_at", null),
      supabaseAdmin.from("ai_support_threads").update({ unread_for_staff: 0, updated_at: new Date().toISOString() }).eq("id", data.id),
    ]);
    return { thread: thread.data, messages: messages.data ?? [] };
  });
