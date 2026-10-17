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
    const groups: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from("wecom_notify_groups")
        .select("chat_id, name, owner_userid, owner_name, member_count, synced_at, is_blocked, wecom_notify_group_members(external_userid, display_name)")
        .order("synced_at", { ascending: false })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      groups.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const bindings: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from("wecom_notify_bindings")
        .select("chat_id,customer_code")
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      bindings.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const codeByChat = new Map(bindings.map((row) => [row.chat_id, row.customer_code]));
    return {
      items: groups.map((group) => ({
        ...group,
        matched_customer_code: codeByChat.get(group.chat_id) ?? null,
      })),
    };
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
    const { listExternalGroups, getExternalGroupDetails } = await import("@/lib/wecom-notify/client.server");
    let groups = await listExternalGroups();
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const now = new Date().toISOString();
    if (groups.length) {
      const existingRows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error: existingError } = await supabaseAdmin
          .from("wecom_notify_groups")
          .select("chat_id,name,owner_userid,owner_name,member_count,is_blocked")
          .range(from, from + 999);
        if (existingError) throw new Error(existingError.message);
        existingRows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      const existingByChatId = new Map(
        existingRows.map((row: any) => [String(row.chat_id), row]),
      );
      // 网关的列表接口只负责分页返回 chat_id。对新群、以及尚未取得有效资料且未屏蔽的群，
      // 再分批拉取详情；否则新群会以空名称写入，之后无法按客户号搜索或自动匹配。
      const detailChatIds = groups
        .filter((group) => {
          const existing = existingByChatId.get(group.chat_id);
          if (!existing) return true;
          if (existing.is_blocked) return false;
          return !String(existing.name ?? "").trim()
            || !existing.owner_userid
            || Number(existing.member_count ?? 0) <= 0;
        })
        .map((group) => group.chat_id);
      const details = [];
      for (let from = 0; from < detailChatIds.length; from += 50) {
        details.push(...await getExternalGroupDetails(detailChatIds.slice(from, from + 50)));
      }
      if (details.length) {
        const detailsByChatId = new Map(details.map((group) => [group.chat_id, group]));
        groups = groups.map((group) => detailsByChatId.get(group.chat_id) ?? group);
      }
      // 使用补全后的详情更新新群与已有群的群名、群主和人数。
      const { error } = await supabaseAdmin.from("wecom_notify_groups").upsert(
        groups.map((g) => {
          const existing = existingByChatId.get(g.chat_id);
          const hasValidDetails = Boolean(g.name.trim()) || g.member_count > 0 || g.external_members.length > 0;
          return {
            chat_id: g.chat_id,
            // 企业微信偶尔会只返回 chat_id；不允许空响应覆盖已保存的群资料。
            name: g.name.trim() || existing?.name || "",
            owner_userid: g.owner_userid || existing?.owner_userid || null,
            owner_name: g.owner_name || existing?.owner_name || null,
            member_count: hasValidDetails ? g.member_count : Number(existing?.member_count ?? 0),
            synced_at: now,
          };
        }),
        { onConflict: "chat_id" },
      );
      if (error) throw new Error(error.message);
      const smallGroupIds = groups.filter((group) => group.member_count <= 15).map((group) => group.chat_id);
      for (let from = 0; from < smallGroupIds.length; from += 100) {
        const chatIdBatch = smallGroupIds.slice(from, from + 100);
        const { error: deleteError } = await supabaseAdmin
          .from("wecom_notify_group_members")
          .delete()
          .in("chat_id", chatIdBatch);
        if (deleteError) throw new Error(deleteError.message);
      }
      const externalMembers = groups.flatMap((group) =>
        (group.member_count <= 15 ? group.external_members : []).map((member) => ({
          chat_id: group.chat_id,
          external_userid: member.external_userid,
          display_name: member.display_name,
          synced_at: now,
        })),
      );
      for (let from = 0; from < externalMembers.length; from += 500) {
        const memberBatch = externalMembers.slice(from, from + 500);
        const { error: memberError } = await supabaseAdmin
          .from("wecom_notify_group_members")
          .upsert(memberBatch, { onConflict: "chat_id,external_userid" });
        if (memberError) throw new Error(memberError.message);
      }
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

export const setWecomGroupBlocked = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chatId: string; blocked: boolean }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const chatId = data.chatId.trim();
    if (!chatId) throw new Error("群 ID 不能为空");
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data: group, error } = await supabaseAdmin
      .from("wecom_notify_groups")
      .update({
        is_blocked: data.blocked,
        blocked_at: data.blocked ? new Date().toISOString() : null,
        blocked_by: data.blocked ? context.userId : null,
      })
      .eq("chat_id", chatId)
      .select("chat_id,name,is_blocked")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!group) throw new Error("群不存在");
    await recordAdminLog(supabaseAdmin, {
      entity_type: "wecom_notify_group",
      entity_id: chatId,
      action: data.blocked ? "block" : "unblock",
      after: { name: group.name, is_blocked: data.blocked },
      operator_id: context.userId,
      note: data.blocked ? "屏蔽群发消息" : "取消群发屏蔽",
    });
    return { ok: true, blocked: data.blocked };
  });

export const refreshSingleWecomGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chatId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!wecomNotifyConfigured()) throw new Error("企业微信凭证尚未配置");
    const chatId = data.chatId.trim();
    if (!chatId) throw new Error("群 ID 不能为空");
    const { getExternalGroupDetails } = await import("@/lib/wecom-notify/client.server");
    const [group] = await getExternalGroupDetails([chatId]);
    if (!group) throw new Error("企业微信未返回该群资料，群可能已经解散或无权限访问");
    if (!group.name.trim() && group.member_count === 0 && !group.external_members.length) {
      throw new Error("企业微信未返回有效群资料，已保留原群名");
    }
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from("wecom_notify_groups")
      .update({
        ...(group.name.trim() ? { name: group.name.trim() } : {}),
        ...(group.owner_userid ? { owner_userid: group.owner_userid } : {}),
        ...(group.owner_name ? { owner_name: group.owner_name } : {}),
        member_count: group.member_count,
        synced_at: now,
      })
      .eq("chat_id", chatId);
    if (error) throw new Error(error.message);
    if (group.member_count <= 15) {
      const { error: deleteError } = await supabaseAdmin
        .from("wecom_notify_group_members")
        .delete()
        .eq("chat_id", chatId);
      if (deleteError) throw new Error(deleteError.message);
      if (group.external_members.length) {
        const { error: memberError } = await supabaseAdmin
          .from("wecom_notify_group_members")
          .insert(group.external_members.map((member) => ({
            chat_id: chatId,
            external_userid: member.external_userid,
            display_name: member.display_name,
            synced_at: now,
          })));
        if (memberError) throw new Error(memberError.message);
      }
    }
    return { ok: true, name: group.name || "（企业微信未返回群名）", memberCount: group.member_count };
  });

export const refreshWecomGroupsBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chatIds: string[] }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!wecomNotifyConfigured()) throw new Error("企业微信凭证尚未配置");
    const chatIds = [...new Set(data.chatIds.map((id) => id.trim()).filter(Boolean))];
    if (!chatIds.length) throw new Error("本页没有可刷新的群");
    if (chatIds.length > 50) throw new Error("一次最多刷新 50 个群");
    const { getExternalGroupDetails } = await import("@/lib/wecom-notify/client.server");
    const groups = await getExternalGroupDetails(chatIds);
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const now = new Date().toISOString();
    for (const group of groups) {
      const hasName = Boolean(group.name.trim());
      const hasValidDetails = hasName || group.member_count > 0 || group.external_members.length > 0;
      if (!hasValidDetails) continue;
      const { error } = await supabaseAdmin
        .from("wecom_notify_groups")
        .update({
          ...(hasName ? { name: group.name.trim() } : {}),
          ...(group.owner_userid ? { owner_userid: group.owner_userid } : {}),
          ...(group.owner_name ? { owner_name: group.owner_name } : {}),
          member_count: group.member_count,
          synced_at: now,
        })
        .eq("chat_id", group.chat_id);
      if (error) throw new Error(error.message);
      if (group.member_count <= 15) {
        const { error: deleteError } = await supabaseAdmin
          .from("wecom_notify_group_members")
          .delete()
          .eq("chat_id", group.chat_id);
        if (deleteError) throw new Error(deleteError.message);
        if (group.external_members.length) {
          const { error: memberError } = await supabaseAdmin
            .from("wecom_notify_group_members")
            .insert(group.external_members.map((member) => ({
              chat_id: group.chat_id,
              external_userid: member.external_userid,
              display_name: member.display_name,
              synced_at: now,
            })));
          if (memberError) throw new Error(memberError.message);
        }
      }
    }
    await recordAdminLog(supabaseAdmin, {
      entity_type: "wecom_notify_group",
      entity_id: "batch-refresh",
      action: "batch_refresh",
      after: { requested: chatIds.length, refreshed: groups.length },
      operator_id: context.userId,
    });
    return { ok: true, requested: chatIds.length, refreshed: groups.length, missing: chatIds.length - groups.length };
  });

export const autoMatchSingleWecomGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chatId: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    const chatId = data.chatId.trim();
    if (!chatId) throw new Error("群 ID 不能为空");
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data: group, error: groupError } = await supabaseAdmin
      .from("wecom_notify_groups")
      .select("chat_id,name,owner_userid,member_count,is_blocked")
      .eq("chat_id", chatId)
      .maybeSingle();
    if (groupError) throw new Error(groupError.message);
    if (!group) throw new Error("群不存在");
    if (!String(group.name ?? "").trim() || !group.owner_userid || Number(group.member_count ?? 0) <= 0) {
      throw new Error("该群尚未取得有效群名、群主和成员资料，不能自动匹配");
    }
    if (group.is_blocked) throw new Error("该群已屏蔽，不能自动匹配");
    const runs = [...new Set(String(group.name ?? "").match(/\d{4,}/g) ?? [])]
      .filter((digits) => digits.length === 4 || digits.length === 5)
      .map((digits) => (digits.length === 4 ? `0${digits}` : digits));
    const candidates = [...new Set(runs)];
    if (!candidates.length) throw new Error("群名中没有可匹配的 4/5 位客户号");
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("customer_code")
      .in("customer_code", candidates);
    if (profileError) throw new Error(profileError.message);
    const matchedCodes: string[] = [
      ...new Set<string>((profiles ?? []).map((profile: any) => String(profile.customer_code))),
    ];
    if (!matchedCodes.length) throw new Error(`找不到客户号：${candidates.join("、")}`);
    if (matchedCodes.length > 1) throw new Error("群名中匹配到多个客户号，请手动分配");
    const customerCode = matchedCodes[0];
    const [{ data: byGroup }, { data: byCustomer }] = await Promise.all([
      supabaseAdmin.from("wecom_notify_bindings").select("customer_code").eq("chat_id", chatId).maybeSingle(),
      supabaseAdmin.from("wecom_notify_bindings").select("chat_id").eq("customer_code", customerCode).maybeSingle(),
    ]);
    if (byGroup && byGroup.customer_code !== customerCode) throw new Error("该群已绑定其它客户");
    if (byCustomer && byCustomer.chat_id !== chatId) throw new Error("该客户号已绑定其它群，请手动处理");
    if (!byGroup) {
      const { error } = await supabaseAdmin.from("wecom_notify_bindings").insert({
        customer_code: customerCode,
        chat_id: chatId,
        bound_by: context.userId,
        bound_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true, customerCode, alreadyMatched: Boolean(byGroup) };
  });

// 管理员在各列表中明确勾选群后直接提交群发。屏蔽群也只有在管理员主动勾选、
// 填写正文并通过最终确认时才能从这个入口发送，普通群发仍严格排除屏蔽群。
export const sendSelectedWecomGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { chatIds: string[]; content: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!wecomNotifyConfigured()) throw new Error("企业微信凭证尚未配置");
    if (!wecomNotifyEnabled()) throw new Error("WECOM_ENABLED 尚未开启，禁止真实发送");
    const chatIds = [...new Set(data.chatIds.map((id) => id.trim()).filter(Boolean))];
    const content = data.content.trim();
    if (!chatIds.length) throw new Error("请至少选择一个测试群");
    if (chatIds.length > 50) throw new Error("一次最多发送 50 个群");
    if (!content) throw new Error("测试消息不能为空");
    if (content.length > 2000) throw new Error("测试消息不能超过 2000 个字符");
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data: groups, error } = await supabaseAdmin
      .from("wecom_notify_groups")
      .select("chat_id,name,owner_userid,is_blocked")
      .in("chat_id", chatIds);
    if (error) throw new Error(error.message);
    if ((groups ?? []).length !== chatIds.length) throw new Error("部分群不存在，请刷新页面后重试");
    const withoutOwner = (groups ?? []).filter((group: any) => !group.owner_userid);
    if (withoutOwner.length)
      throw new Error(`这些群尚未取得群主信息，请先逐个刷新群名：${withoutOwner.map((g: any) => g.name || g.chat_id).join("、")}`);
    const byOwner = new Map<string, string[]>();
    for (const group of groups ?? []) {
      const ids = byOwner.get(group.owner_userid) ?? [];
      ids.push(group.chat_id);
      byOwner.set(group.owner_userid, ids);
    }
    const { sendGroupMsgTemplate } = await import("@/lib/wecom-notify/client.server");
    const results = [];
    for (const [senderUserId, ownerChatIds] of byOwner) {
      const result = await sendGroupMsgTemplate({ senderUserId, chatIds: ownerChatIds, content });
      if (!result.ok) throw new Error(`企业微信提交失败：${JSON.stringify(result.raw)}`);
      results.push({ senderUserId, chatIds: ownerChatIds, msgid: result.msgid ?? null });
    }
    await recordAdminLog(supabaseAdmin, {
      entity_type: "wecom_notify_test",
      entity_id: results.map((result) => result.msgid).filter(Boolean).join(",") || "submitted",
      action: "send_selected_groups",
      after: { chat_ids: chatIds, group_count: chatIds.length, content, results },
      operator_id: context.userId,
      note: "管理员在群列表中明确勾选群并确认群发",
    });
    return { ok: true, groupCount: chatIds.length, results };
  });

// 每次只补全一小批尚无群名的群，避免 1000+ 群详情请求触发超时。
export const enrichWecomGroups = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!wecomNotifyConfigured()) throw new Error("企业微信网关或凭证尚未配置");
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data: pending, error: pendingError } = await supabaseAdmin
      .from("wecom_notify_groups")
      .select("chat_id")
      .or("name.eq.,name.is.null")
      .order("synced_at", { ascending: true })
      .limit(50);
    if (pendingError) throw new Error(pendingError.message);
    const chatIds = (pending ?? []).map((row: any) => row.chat_id as string);
    if (!chatIds.length) return { ok: true, count: 0, remaining: 0 };

    const { getExternalGroupDetails } = await import("@/lib/wecom-notify/client.server");
    const groups = await getExternalGroupDetails(chatIds);
    const now = new Date().toISOString();
    for (const group of groups) {
      // 企业微信会对部分历史群返回空 name。写入明确占位值，避免这些群
      // 永远被下一批再次选中，导致后续有真实群名的群无法被处理。
      const storedName = group.name.trim() || "（企业微信未返回群名）";
      const hasName = Boolean(group.name.trim());
      const { error: groupError } = await supabaseAdmin
        .from("wecom_notify_groups")
        .update({
          name: storedName,
          ...(group.owner_userid ? { owner_userid: group.owner_userid } : {}),
          member_count: Number(group.member_count) || 0,
          synced_at: now,
          ...(hasName ? {} : { is_blocked: true, blocked_at: now, blocked_by: null }),
        })
        .eq("chat_id", group.chat_id);
      if (groupError) throw new Error(groupError.message);
      await supabaseAdmin.from("wecom_notify_group_members").delete().eq("chat_id", group.chat_id);
      if (group.member_count <= 15 && group.external_members.length) {
        const { error: memberError } = await supabaseAdmin.from("wecom_notify_group_members").insert(
          group.external_members.map((member) => ({
            chat_id: group.chat_id,
            external_userid: member.external_userid,
            display_name: member.display_name,
            synced_at: now,
          })),
        );
        if (memberError) throw new Error(memberError.message);
      }
    }
    const { count: remaining } = await supabaseAdmin
      .from("wecom_notify_groups")
      .select("chat_id", { count: "exact", head: true })
      .or("name.eq.,name.is.null");
    return { ok: true, count: groups.length, remaining: remaining ?? 0 };
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
      .select("id, customer_code, chat_id, bound_at, wecom_notify_groups(name, owner_userid, owner_name, member_count)")
      .order("bound_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { items: data ?? [] };
  });

// 从群名中提取至少 4 位连续数字，并与 profiles.customer_code 精确匹配。
// 仅自动写入唯一且无冲突的 1:1 关系；同一客户号出现在多个群时跳过，避免误绑。
export const autoBindWecomGroupsByName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };

    const fetchAll = async (table: string, columns: string) => {
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabaseAdmin
          .from(table)
          .select(columns)
          .range(from, from + 999);
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return rows;
    };

    const [groups, profiles, existing] = await Promise.all([
      fetchAll("wecom_notify_groups", "chat_id,name,owner_userid,member_count,is_blocked"),
      fetchAll("profiles", "customer_code"),
      fetchAll("wecom_notify_bindings", "customer_code,chat_id"),
    ]);

    const profileCodes = new Map<string, string>();
    for (const profile of profiles) {
      const code = String(profile.customer_code ?? "").trim();
      if (code) profileCodes.set(code.toUpperCase(), code);
    }
    const boundCodes = new Set(existing.map((row) => row.customer_code));
    const boundChats = new Set(existing.map((row) => row.chat_id));
    const candidatesByCode = new Map<string, Array<{ chat_id: string; name: string }>>();
    let groupsWithoutNumber = 0;
    let groupsWithoutCustomer = 0;

    for (const group of groups) {
      if (boundChats.has(group.chat_id)) continue;
      const name = String(group.name ?? "");
      // 只有企业微信确实返回了完整、当前可访问的群资料，才允许自动建立绑定。
      // 历史 chat_id、已退出/解散群或无权限群可能只有 ID；这些记录不能占用客户号。
      if (!name.trim() || !group.owner_userid || Number(group.member_count ?? 0) <= 0 || group.is_blocked) {
        continue;
      }
      const digitRuns = [...new Set(name.match(/\d{4,}/g) ?? [])];
      if (!digitRuns.length) {
        groupsWithoutNumber += 1;
        continue;
      }
      const matchedCodes = [...new Set(
        digitRuns
          .filter((digits) => digits.length === 4 || digits.length === 5)
          .map((digits) => (digits.length === 4 ? `0${digits}` : digits))
          .map((code) => profileCodes.get(code.toUpperCase()))
          .filter((code): code is string => Boolean(code)),
      )];
      if (matchedCodes.length !== 1) {
        groupsWithoutCustomer += 1;
        continue;
      }
      const code = matchedCodes[0];
      const list = candidatesByCode.get(code) ?? [];
      list.push({ chat_id: group.chat_id, name });
      candidatesByCode.set(code, list);
    }

    const ambiguous = [...candidatesByCode.values()].filter((items) => items.length > 1).length;
    const rows = [...candidatesByCode.entries()]
      .filter(([code, items]) => !boundCodes.has(code) && items.length === 1)
      .map(([customer_code, items]) => ({
        customer_code,
        chat_id: items[0].chat_id,
        bound_by: context.userId,
        bound_at: new Date().toISOString(),
      }));

    for (let index = 0; index < rows.length; index += 200) {
      const { error } = await supabaseAdmin
        .from("wecom_notify_bindings")
        .insert(rows.slice(index, index + 200));
      if (error) throw new Error(error.message);
    }

    await recordAdminLog(supabaseAdmin, {
      entity_type: "wecom_notify_binding",
      entity_id: "auto-match-by-group-name",
      action: "bind",
      after: {
        matched: rows.length,
        ambiguous,
        groups_without_number: groupsWithoutNumber,
        groups_without_customer: groupsWithoutCustomer,
      },
      operator_id: context.userId,
      note: "按群名中的连续数字自动匹配客户号",
    });

    return {
      ok: true,
      matched: rows.length,
      ambiguous,
      groupsWithoutNumber,
      groupsWithoutCustomer,
    };
  });

export const listWecomProblemGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const fetchAll = async (table: string, columns: string) => {
      const rows: any[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
        if (error) throw new Error(error.message);
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return rows;
    };
    const [groups, profiles, bindings] = await Promise.all([
      fetchAll("wecom_notify_groups", "chat_id,name,owner_userid,owner_name,member_count,synced_at,is_blocked"),
      fetchAll("profiles", "customer_code"),
      fetchAll("wecom_notify_bindings", "customer_code,chat_id"),
    ]);
    const profileCodes = new Map(
      profiles
        .map((profile) => String(profile.customer_code ?? "").trim())
        .filter(Boolean)
        .map((code) => [code.toUpperCase(), code]),
    );
    const boundChats = new Set(bindings.map((row) => row.chat_id));
    const boundCodes = new Set(bindings.map((row) => row.customer_code));
    const analyzed = groups
      .filter((group) => !boundChats.has(group.chat_id) && !group.is_blocked)
      .map((group) => {
        const runs = [...new Set(String(group.name ?? "").match(/\d{4,}/g) ?? [])];
        const normalized = [...new Set(
          runs
            .filter((digits) => digits.length === 4 || digits.length === 5)
            .map((digits) => (digits.length === 4 ? `0${digits}` : digits)),
        )];
        const matchedCodes = normalized
          .map((code) => profileCodes.get(code.toUpperCase()))
          .filter((code): code is string => Boolean(code));
        return { ...group, runs, normalized, matchedCodes: [...new Set(matchedCodes)] };
      });
    const countByCode = new Map<string, number>();
    for (const group of analyzed) {
      if (group.matchedCodes.length === 1) {
        const code = group.matchedCodes[0];
        countByCode.set(code, (countByCode.get(code) ?? 0) + 1);
      }
    }
    const items = analyzed.map((group) => {
      let problem_type = "no_number";
      let problem_label = "群名没有 4/5 位连续客户号";
      let candidate_customer_code: string | null = null;
      if (group.normalized.length && group.matchedCodes.length === 0) {
        problem_type = "customer_not_found";
        problem_label = "群名号码找不到对应客户";
        candidate_customer_code = group.normalized[0] ?? null;
      } else if (group.matchedCodes.length > 1) {
        problem_type = "multiple_numbers";
        problem_label = "群名包含多个有效客户号";
      } else if (group.matchedCodes.length === 1) {
        const matchedCode = group.matchedCodes[0];
        candidate_customer_code = matchedCode;
        if (boundCodes.has(matchedCode)) {
          problem_type = "customer_already_bound";
          problem_label = "该客户号已经绑定其它群";
        } else if ((countByCode.get(matchedCode) ?? 0) > 1) {
          problem_type = "duplicate_customer_code";
          problem_label = "多个群对应同一客户号";
        } else {
          problem_type = "unmatched";
          problem_label = "尚未匹配";
        }
      }
      return {
        chat_id: group.chat_id,
        name: group.name,
        owner_userid: group.owner_userid,
        member_count: group.member_count,
        synced_at: group.synced_at,
        is_blocked: Boolean(group.is_blocked),
        candidate_customer_code,
        problem_type,
        problem_label,
      };
    });
    const order: Record<string, number> = {
      duplicate_customer_code: 0,
      customer_already_bound: 1,
      customer_not_found: 2,
      multiple_numbers: 3,
      no_number: 4,
      unmatched: 5,
    };
    items.sort((a, b) => (order[a.problem_type] ?? 99) - (order[b.problem_type] ?? 99));
    return { items };
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
    .select("customer_code, chat_id, wecom_notify_groups(name, owner_userid, owner_name, is_blocked)");
  if (params.targetScope === "selected") {
    if (!params.targetCustomerCodes.length) return [];
    bindingsQuery = bindingsQuery.in("customer_code", params.targetCustomerCodes);
  }
  const { data: bindings, error } = await bindingsQuery;
  if (error) throw new Error(error.message);
  const activeBindings = ((bindings ?? []) as any[]).filter(
    (binding) => !(binding.wecom_notify_groups as any)?.is_blocked,
  );
  const codes = activeBindings.map((b) => b.customer_code);
  if (!codes.length) return [];
  const { data: profs } = await admin
    .from("profiles")
    .select("customer_code, full_name, username")
    .in("customer_code", codes);
  const profByCode = new Map(((profs ?? []) as any[]).map((p) => [p.customer_code, p]));
  return activeBindings.map((b) => {
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

// ============ 每日自动通知：按日期审核 / 修改 ============
export const listDailyWecomDraftDates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase, context.userId);
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabaseAdmin
        .from("wecom_daily_notification_drafts")
        .select("service_date,status,updated_at")
        .order("service_date", { ascending: false })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const byDate = new Map<string, any>();
    for (const row of rows) {
      const item = byDate.get(row.service_date) ?? {
        service_date: row.service_date,
        customer_count: 0,
        editable_count: 0,
        sent_count: 0,
        failed_count: 0,
        updated_at: row.updated_at,
      };
      item.customer_count += 1;
      if (row.status === "draft") item.editable_count += 1;
      if (row.status === "sent" || row.status === "submitted") item.sent_count += 1;
      if (row.status === "failed" || row.status === "partially_failed") item.failed_count += 1;
      if (String(row.updated_at) > String(item.updated_at)) item.updated_at = row.updated_at;
      byDate.set(row.service_date, item);
    }
    return { items: [...byDate.values()] };
  });

export const listDailyWecomDrafts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { serviceDate: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.serviceDate)) throw new Error("发送日期格式不正确");
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data: drafts, error } = await supabaseAdmin
      .from("wecom_daily_notification_drafts")
      .select("id,service_date,customer_code,rendered_content,edited_content,status,failure_reason,updated_at,submitted_at,sent_at")
      .eq("service_date", data.serviceDate)
      .order("customer_code", { ascending: true });
    if (error) throw new Error(error.message);
    const codes = [...new Set(((drafts ?? []) as any[]).map((row) => row.customer_code))];
    const { data: bindings, error: bindingError } = codes.length
      ? await supabaseAdmin
          .from("wecom_notify_bindings")
          .select("customer_code,chat_id")
          .in("customer_code", codes)
      : { data: [], error: null };
    if (bindingError) throw new Error(bindingError.message);
    const chatIds = [...new Set(((bindings ?? []) as any[]).map((row) => row.chat_id).filter(Boolean))];
    const { data: groups, error: groupError } = chatIds.length
      ? await supabaseAdmin
          .from("wecom_notify_groups")
          .select("chat_id,name,is_blocked")
          .in("chat_id", chatIds)
      : { data: [], error: null };
    if (groupError) throw new Error(groupError.message);
    const bindingByCode = new Map(((bindings ?? []) as any[]).map((row) => [row.customer_code, row]));
    const groupByChat = new Map(((groups ?? []) as any[]).map((row) => [row.chat_id, row]));
    return {
      items: ((drafts ?? []) as any[]).map((row) => {
        const binding: any = bindingByCode.get(row.customer_code);
        const group: any = binding ? groupByChat.get(binding.chat_id) : null;
        return {
          ...row,
          content: row.edited_content ?? row.rendered_content,
          is_edited: row.edited_content != null,
          chat_id: binding?.chat_id ?? null,
          group_name: group?.name ?? null,
          group_blocked: Boolean(group?.is_blocked),
        };
      }),
    };
  });

export const updateDailyWecomDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { draftId: string; content: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!UUID_RE.test(data.draftId)) throw new Error("预发送信息 ID 格式不正确");
    const content = data.content.trim();
    if (!content) throw new Error("发送内容不能为空");
    if (content.length > 4000) throw new Error("发送内容不能超过 4000 个字符");
    const { supabaseAdmin } = (await import("@/integrations/supabase/client.server")) as {
      supabaseAdmin: any;
    };
    const { data: draft, error: readError } = await supabaseAdmin
      .from("wecom_daily_notification_drafts")
      .select("id,status")
      .eq("id", data.draftId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!draft) throw new Error("预发送信息不存在");
    if (draft.status !== "draft") throw new Error("该信息已提交或发送，只能查看，不能修改");
    const { error } = await supabaseAdmin
      .from("wecom_daily_notification_drafts")
      .update({ edited_content: content, updated_at: new Date().toISOString() })
      .eq("id", data.draftId)
      .eq("status", "draft");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const sendDailyWecomDraftsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { serviceDate: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase, context.userId);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.serviceDate)) throw new Error("发送日期格式不正确");
    const { sendDueDailyWecomDrafts } = await import("@/lib/wecom-daily-send.server");
    return sendDueDailyWecomDrafts({ serviceDate: data.serviceDate, bypassHour: true, retryFailed: true });
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
      .select("id, chat_id, rendered_content, status")
      .eq("message_id", data.messageId);
    if (tErr) throw new Error(tErr.message);
    if (!targets?.length) throw new Error("该消息没有任何目标，无法发送");

    // message_targets.chat_id intentionally has no database foreign key to the group table.
    // Fetch group metadata explicitly instead of asking PostgREST to expand a relationship
    // that is not present in its schema cache.
    const chatIds = [...new Set((targets as any[]).map((target) => target.chat_id))];
    const { data: targetGroups, error: groupErr } = await supabaseAdmin
      .from("wecom_notify_groups")
      .select("chat_id,owner_userid,is_blocked")
      .in("chat_id", chatIds);
    if (groupErr) throw new Error(groupErr.message);
    const groupByChatId = new Map(
      ((targetGroups ?? []) as any[]).map((group) => [group.chat_id, group]),
    );
    const targetsWithGroup = (targets as any[]).map((target) => ({
      ...target,
      group: groupByChatId.get(target.chat_id) ?? null,
    }));
    // A partially failed task may be retried. Never submit targets that were already
    // accepted by WeCom, otherwise customers can receive duplicate notifications.
    const retryableTargets = targetsWithGroup.filter((target) =>
      ["pending", "failed"].includes(target.status),
    );
    if (!retryableTargets.length) {
      return { ok: true, already_processed: true, status: msg.status };
    }
    const missingGroups = retryableTargets.filter((target) => !target.group);
    if (missingGroups.length) {
      await supabaseAdmin
        .from("wecom_notify_message_targets")
        .update({ status: "failed", error: "目标群不存在，请刷新群列表后重试" })
        .in("id", missingGroups.map((target) => target.id));
    }
    const blockedTargets = retryableTargets.filter((target) => target.group?.is_blocked);
    const activeTargets = retryableTargets.filter(
      (target) => target.group && !target.group.is_blocked,
    );
    if (blockedTargets.length) {
      await supabaseAdmin
        .from("wecom_notify_message_targets")
        .update({ status: "skipped_blocked", error: "该群已被管理员屏蔽" })
        .in("id", blockedTargets.map((target) => target.id));
    }
    if (!activeTargets.length) throw new Error("该任务的目标群均已被屏蔽，未发送任何消息");

    if (!wecomNotifyEnabled()) {
      await supabaseAdmin
        .from("wecom_notify_messages")
        .update({ status: "preview_only" })
        .eq("id", data.messageId);
      await supabaseAdmin
        .from("wecom_notify_message_targets")
        .update({ status: "skipped_disabled" })
        .in("id", activeTargets.map((target) => target.id));
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
    for (const t of activeTargets) {
      const owner = t.group?.owner_userid;
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
