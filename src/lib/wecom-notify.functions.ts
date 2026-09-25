// EPLUS 群发通知（企业微信客户群发，独立应用 AgentId 1000005）后台管理函数。
// 跟现有「微信客服 AI」（wechat-kf 那一整套）完全独立，互不调用、互不影响；
// 本阶段只服务测试域名，WECOM_ENABLED 默认 false——同步群列表 / 真正发送这两个
// 会触达企业微信接口的动作在总开关关闭时一律拒绝执行，只有"绑定管理"和"发送
// 预览"（纯本地渲染，不调用企业微信任何接口）可以直接用。
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAdminLog } from "@/lib/admin-log";
import { wecomNotifyConfigured, wecomNotifyEnabled } from "@/lib/wecom-notify/config.server";

async function assertOwner(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "owner" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: owner only");
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ============ 状态 ============
// 页面顶部横幅：有没有配好凭证、总开关是不是开着。不返回任何密钥本身。
export const getWecomNotifyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase, context.userId);
    const { wecomNotifyConfig } = await import("@/lib/wecom-notify/config.server");
    const config = wecomNotifyConfig();
    return {
      configured: wecomNotifyConfigured(config),
      enabled: wecomNotifyEnabled(),
      usingGateway: Boolean(config.gatewayUrl),
    };
  });

export const testWecomNotifyConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!wecomNotifyConfigured()) throw new Error("尚未配置企业微信群发应用凭证");
    const { testWecomConnection } = await import("@/lib/wecom-notify/client.server");
    await testWecomConnection();
    return { ok: true };
  });

// ============ 群列表 ============
export const listWecomGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data, error } = await supabaseAdmin
      .from("wecom_notify_groups")
      .select("chat_id, name, owner_userid, member_count, synced_at")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

// 真正调用企业微信「客户群」接口拉取群列表——总开关关闭/凭证没配好时直接拒绝，
// 不会静默返回空列表让人误以为"同步成功但是没有群"。
export const syncWecomGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!wecomNotifyConfigured())
      throw new Error("尚未配置 WECOM_NOTIFY_CORP_ID / AGENT_ID / SECRET，无法同步");
    // 群同步是只读操作，允许在发送总开关关闭时执行。WECOM_ENABLED 只控制发送。
    const { listExternalGroups } = await import("@/lib/wecom-notify/client.server");
    const groups = await listExternalGroups();
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const now = new Date().toISOString();
    if (groups.length) {
      const { error } = await supabaseAdmin.from("wecom_notify_groups").upsert(
        groups.map((g) => ({
          chat_id: g.chat_id,
          name: g.name,
          owner_userid: g.owner_userid,
          member_count: g.member_count,
          synced_at: now,
        })),
      );
      if (error) throw new Error(error.message);
    }
    await recordAdminLog(supabaseAdmin, {
      entity_type: "wecom_notify_group",
      entity_id: "sync",
      action: "sync",
      after: { count: groups.length },
      operator_id: context.userId,
    });
    return { ok: true, count: groups.length };
  });

// ============ 客户 ↔ 专属群绑定（1:1） ============
export const listWecomBindings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data, error } = await supabaseAdmin
      .from("wecom_notify_bindings")
      .select("id, customer_code, chat_id, bound_at, wecom_notify_groups(name, member_count)")
      .order("bound_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

// 按客户号/姓名找客户，供绑定弹窗里的搜索框用。跟企业微信无关，纯本地查询。
export const searchCustomersForBinding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { query: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const q = data.query.trim();
    if (!q) return { items: [] };
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data: rows, error } = await supabaseAdmin
      .from("profiles")
      .select("id, customer_code, full_name, username")
      .or(`customer_code.ilike.%${q}%,full_name.ilike.%${q}%,username.ilike.%${q}%`)
      .limit(20);
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

export const bindCustomerGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { customerCode: string; chatId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const customerCode = data.customerCode.trim();
    const chatId = data.chatId.trim();
    if (!customerCode || !chatId) throw new Error("客户号和群都必须选择");
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("customer_code", customerCode)
      .maybeSingle();
    if (!prof) throw new Error("客户号不存在");
    const { data: group } = await supabaseAdmin
      .from("wecom_notify_groups")
      .select("chat_id")
      .eq("chat_id", chatId)
      .maybeSingle();
    if (!group) throw new Error("群不存在，请先同步群列表");

    // 1:1——这个客户已经绑了别的群，或这个群已经绑了别的客户，都要先解绑再重新绑，
    // 不做"自动覆盖"，避免管理员没注意到已有绑定就顶掉。
    const { data: existingByCustomer } = await supabaseAdmin
      .from("wecom_notify_bindings")
      .select("chat_id")
      .eq("customer_code", customerCode)
      .maybeSingle();
    if (existingByCustomer && existingByCustomer.chat_id !== chatId) {
      throw new Error("该客户已绑定其它群，请先解绑");
    }
    const { data: existingByGroup } = await supabaseAdmin
      .from("wecom_notify_bindings")
      .select("customer_code")
      .eq("chat_id", chatId)
      .maybeSingle();
    if (existingByGroup && existingByGroup.customer_code !== customerCode) {
      throw new Error("该群已绑定其它客户，请先解绑");
    }

    const { error } = await supabaseAdmin.from("wecom_notify_bindings").upsert(
      {
        customer_code: customerCode,
        chat_id: chatId,
        bound_by: context.userId,
        bound_at: new Date().toISOString(),
      },
      { onConflict: "customer_code" },
    );
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "wecom_notify_binding",
      entity_id: customerCode,
      action: "bind",
      after: { chat_id: chatId },
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const unbindCustomerGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { customerCode: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { error } = await supabaseAdmin
      .from("wecom_notify_bindings")
      .delete()
      .eq("customer_code", data.customerCode);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "wecom_notify_binding",
      entity_id: data.customerCode,
      action: "unbind",
      operator_id: context.userId,
    });
    return { ok: true };
  });

// ============ 群发消息：草稿 / 预览 / 发送 ============
// 模板变量目前只支持 {{customer_name}} / {{customer_code}}，够用再加。
function renderTemplate(
  template: string,
  vars: { customer_name: string; customer_code: string },
): string {
  return template
    .replace(/\{\{\s*customer_name\s*\}\}/g, vars.customer_name)
    .replace(/\{\{\s*customer_code\s*\}\}/g, vars.customer_code);
}

async function resolveTargets(
  admin: any,
  params: {
    targetScope: "all_bound" | "selected";
    targetCustomerCodes: string[];
    contentTemplate: string;
  },
) {
  let bindingsQuery = admin
    .from("wecom_notify_bindings")
    .select("customer_code, chat_id, wecom_notify_groups(name, owner_userid)");
  if (params.targetScope === "selected") {
    if (!params.targetCustomerCodes.length) return [];
    bindingsQuery = bindingsQuery.in("customer_code", params.targetCustomerCodes);
  }
  const { data: bindings, error } = await bindingsQuery;
  if (error) throw new Error(error.message);
  const codes = ((bindings ?? []) as any[]).map((b) => b.customer_code);
  if (!codes.length) return [];
  const { data: profs } = await admin
    .from("profiles")
    .select("customer_code, full_name, username")
    .in("customer_code", codes);
  const profByCode = new Map(((profs ?? []) as any[]).map((p) => [p.customer_code, p]));
  return ((bindings ?? []) as any[]).map((b) => {
    const prof = profByCode.get(b.customer_code);
    const customerName = prof?.full_name || prof?.username || b.customer_code;
    return {
      customer_code: b.customer_code as string,
      chat_id: b.chat_id as string,
      group_name: (b.wecom_notify_groups as any)?.name ?? "",
      owner_userid: (b.wecom_notify_groups as any)?.owner_userid ?? null,
      rendered_content: renderTemplate(params.contentTemplate, {
        customer_name: customerName,
        customer_code: b.customer_code,
      }),
    };
  });
}

// 纯本地渲染，不调用企业微信任何接口——WECOM_ENABLED 是什么值都能用。
export const previewWecomMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      targetScope: "all_bound" | "selected";
      targetCustomerCodes: string[];
      contentTemplate: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const template = data.contentTemplate.trim();
    if (!template) throw new Error("消息内容不能为空");
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const targets = await resolveTargets(supabaseAdmin, { ...data, contentTemplate: template });
    return { items: targets, count: targets.length };
  });

export const createWecomMessageDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      title: string;
      targetScope: "all_bound" | "selected";
      targetCustomerCodes: string[];
      contentTemplate: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const template = data.contentTemplate.trim();
    if (!template) throw new Error("消息内容不能为空");
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const targets = await resolveTargets(supabaseAdmin, { ...data, contentTemplate: template });
    if (!targets.length) throw new Error("没有匹配到任何已绑定专属群的客户，无法创建群发任务");

    const { data: msg, error } = await supabaseAdmin
      .from("wecom_notify_messages")
      .insert({
        title: data.title.trim() || "(未命名)",
        content_template: template,
        target_scope: data.targetScope,
        target_customer_codes: data.targetScope === "selected" ? data.targetCustomerCodes : [],
        status: "previewed",
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const { error: tErr } = await supabaseAdmin.from("wecom_notify_message_targets").insert(
      targets.map((t) => ({
        message_id: msg.id,
        customer_code: t.customer_code,
        chat_id: t.chat_id,
        rendered_content: t.rendered_content,
      })),
    );
    if (tErr) throw new Error(tErr.message);
    return { ok: true, message_id: msg.id, count: targets.length };
  });

export const listWecomMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data, error } = await supabaseAdmin
      .from("wecom_notify_messages")
      .select("id, title, target_scope, status, created_at, sent_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

export const getWecomMessageDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!UUID_RE.test(data.messageId)) throw new Error("消息 ID 格式不正确");
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data: msg, error } = await supabaseAdmin
      .from("wecom_notify_messages")
      .select("*")
      .eq("id", data.messageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!msg) throw new Error("消息不存在");
    const { data: targets } = await supabaseAdmin
      .from("wecom_notify_message_targets")
      .select("customer_code, chat_id, rendered_content, status, error, sent_at")
      .eq("message_id", data.messageId);
    return { message: msg, targets: targets ?? [] };
  });

// 发送：WECOM_ENABLED=false（测试环境默认状态）时只会把消息标成 preview_only，
// 绝不调用企业微信、绝不能返回"已发送"。真正打开开关之后，也只是把
// "群发任务提交给企业微信"这一步做了——企业微信客户群发的官方语义是任务仍需要
// 对应的企业微信成员（sender）在客户端确认执行，接口调用成功≠客户已经收到消息，
// 这一点在没有真机联调验证之前，页面和这里的返回文案都不能说成"已送达"。
export const sendWecomMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!UUID_RE.test(data.messageId)) throw new Error("消息 ID 格式不正确");
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data: msg, error } = await supabaseAdmin
      .from("wecom_notify_messages")
      .select("id, status, content_template")
      .eq("id", data.messageId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!msg) throw new Error("消息不存在");
    if (
      ["submitted", "waiting_employee_confirmation", "sent", "preview_only"].includes(msg.status)
    ) {
      return { ok: true, already_processed: true, status: msg.status };
    }
    const { data: targets, error: tErr } = await supabaseAdmin
      .from("wecom_notify_message_targets")
      .select("id, chat_id, rendered_content, wecom_notify_groups(owner_userid)")
      .eq("message_id", data.messageId);
    if (tErr) throw new Error(tErr.message);
    if (!targets?.length) throw new Error("该消息没有任何目标，无法发送");

    if (!wecomNotifyEnabled()) {
      await supabaseAdmin
        .from("wecom_notify_messages")
        .update({ status: "preview_only" })
        .eq("id", data.messageId);
      await supabaseAdmin
        .from("wecom_notify_message_targets")
        .update({ status: "skipped_disabled" })
        .eq("message_id", data.messageId);
      await recordAdminLog(supabaseAdmin, {
        entity_type: "wecom_notify_message",
        entity_id: data.messageId,
        action: "preview_only",
        operator_id: context.userId,
        note: "WECOM_ENABLED=false，未真实发送",
      });
      return { ok: true, sent: false, status: "preview_only", reason: "wecom_disabled" };
    }

    if (!wecomNotifyConfigured())
      throw new Error("尚未配置 WECOM_NOTIFY_CORP_ID / AGENT_ID / SECRET，无法发送");
    const { sendGroupMsgTemplate } = await import("@/lib/wecom-notify/client.server");

    // 按 (owner_userid, 渲染后内容) 分组——同一批调用要求 sender 相同且内容相同，
    // 内容不同（比如带了客户姓名变量）就拆成多次调用。
    let anyOk = false;
    let anyFail = false;
    const groups = new Map<
      string,
      { senderUserId: string; content: string; chatIds: string[]; targetIds: string[] }
    >();
    for (const t of targets as any[]) {
      const owner = t.wecom_notify_groups?.owner_userid;
      if (!owner) {
        anyFail = true;
        await supabaseAdmin
          .from("wecom_notify_message_targets")
          .update({ status: "failed", error: "群没有群主 owner_userid，无法确定发送人" })
          .eq("id", t.id);
        continue;
      }
      const key = `${owner}::${t.rendered_content}`;
      const g = groups.get(key) ?? {
        senderUserId: owner,
        content: t.rendered_content,
        chatIds: [] as string[],
        targetIds: [] as string[],
      };
      g.chatIds.push(t.chat_id);
      g.targetIds.push(t.id);
      groups.set(key, g);
    }

    const results: any[] = [];
    for (const g of groups.values()) {
      try {
        const r = await sendGroupMsgTemplate({
          senderUserId: g.senderUserId,
          chatIds: g.chatIds,
          content: g.content,
        });
        results.push({ sender: g.senderUserId, ok: r.ok, raw: r.raw });
        if (r.ok) {
          anyOk = true;
          await supabaseAdmin
            .from("wecom_notify_message_targets")
            .update({
              status: "waiting_employee_confirmation",
              wecom_msgid: r.msgid,
              sender_userid: g.senderUserId,
              submitted_at: new Date().toISOString(),
            })
            .in("id", g.targetIds);
        } else {
          anyFail = true;
          await supabaseAdmin
            .from("wecom_notify_message_targets")
            .update({ status: "failed", error: JSON.stringify(r.raw) })
            .in("id", g.targetIds);
        }
      } catch (e: any) {
        anyFail = true;
        results.push({ sender: g.senderUserId, ok: false, error: e?.message });
        await supabaseAdmin
          .from("wecom_notify_message_targets")
          .update({ status: "failed", error: e?.message ?? "send_failed" })
          .in("id", g.targetIds);
      }
    }
    const finalStatus =
      anyOk && !anyFail ? "waiting_employee_confirmation" : anyOk ? "partially_failed" : "failed";
    await supabaseAdmin
      .from("wecom_notify_messages")
      .update({
        status: finalStatus,
        submitted_at: anyOk ? new Date().toISOString() : null,
        send_result: results,
      })
      .eq("id", data.messageId);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "wecom_notify_message",
      entity_id: data.messageId,
      action: "send",
      after: { status: finalStatus },
      operator_id: context.userId,
    });
    // sent 只代表"群发任务已提交给企业微信"，不代表客户已经在群里看到消息——
    // 该任务通常还要求对应群主在自己的企业微信客户端里确认执行。
    return { ok: true, sent: anyOk, status: finalStatus, results };
  });

export const refreshWecomMessageStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { messageId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!UUID_RE.test(data.messageId)) throw new Error("消息 ID 格式不正确");
    if (!wecomNotifyConfigured() || !wecomNotifyEnabled()) {
      throw new Error("企业微信连接未启用，无法刷新发送状态");
    }
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data: targets, error } = await supabaseAdmin
      .from("wecom_notify_message_targets")
      .select("id, wecom_msgid, sender_userid")
      .eq("message_id", data.messageId)
      .not("wecom_msgid", "is", null);
    if (error) throw new Error(error.message);
    if (!targets?.length) throw new Error("该任务没有可查询的企业微信 msgid");

    const { getGroupMsgSendResult } = await import("@/lib/wecom-notify/client.server");
    const tasks = new Map<string, { msgid: string; senderUserId: string; targetIds: string[] }>();
    for (const target of targets as any[]) {
      if (!target.wecom_msgid || !target.sender_userid) continue;
      const key = `${target.wecom_msgid}:${target.sender_userid}`;
      const task = tasks.get(key) ?? {
        msgid: target.wecom_msgid,
        senderUserId: target.sender_userid,
        targetIds: [] as string[],
      };
      task.targetIds.push(target.id);
      tasks.set(key, task);
    }

    const checkedAt = new Date().toISOString();
    for (const task of tasks.values()) {
      const result = await getGroupMsgSendResult(task);
      await supabaseAdmin
        .from("wecom_notify_message_targets")
        .update({
          status: result.status,
          last_checked_at: checkedAt,
          sent_at: result.status === "sent" ? checkedAt : null,
        })
        .in("id", task.targetIds);
    }

    const { data: refreshed } = await supabaseAdmin
      .from("wecom_notify_message_targets")
      .select("status")
      .eq("message_id", data.messageId);
    const statuses = (refreshed ?? []).map((row: { status: string }) => row.status);
    const finalStatus = statuses.every((status: string) => status === "sent")
      ? "sent"
      : statuses.every((status: string) => status === "failed")
        ? "failed"
        : statuses.some((status: string) => status === "failed")
          ? "partially_failed"
          : "waiting_employee_confirmation";
    await supabaseAdmin
      .from("wecom_notify_messages")
      .update({ status: finalStatus, sent_at: finalStatus === "sent" ? checkedAt : null })
      .eq("id", data.messageId);
    return { ok: true, status: finalStatus };
  });
