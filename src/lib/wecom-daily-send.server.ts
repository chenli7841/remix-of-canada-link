import { wecomNotifyConfigured, wecomNotifyEnabled } from "@/lib/wecom-notify/config.server";

const TORONTO_TIME_ZONE = "America/Toronto";

function torontoClock(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TORONTO_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
  };
}

export async function sendDueDailyWecomDrafts(options?: {
  serviceDate?: string;
  bypassHour?: boolean;
  retryFailed?: boolean;
}) {
  if (!wecomNotifyConfigured()) throw new Error("企业微信群发应用凭证尚未配置");
  if (!wecomNotifyEnabled()) throw new Error("WECOM_ENABLED=false，无法提交真实消息");
  const clock = torontoClock();
  if (!options?.bypassHour && clock.hour < 10) {
    return { ok: true, skipped: "before_10_00", submitted: 0, failed: 0 };
  }
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { sendGroupMsgTemplate } = await import("@/lib/wecom-notify/client.server");
  let query = (supabaseAdmin as any)
    .from("wecom_daily_notification_drafts")
    .select("id,service_date,customer_code,rendered_content,edited_content,status")
    .order("service_date", { ascending: true })
    .order("customer_code", { ascending: true })
    .limit(500);
  query = options?.serviceDate
    ? query.eq("service_date", options.serviceDate)
    : query.eq("service_date", clock.date);
  query = options?.retryFailed ? query.in("status", ["draft", "failed"]) : query.eq("status", "draft");
  const { data: drafts, error } = await query;
  if (error) throw new Error(error.message);

  let submitted = 0;
  let failed = 0;
  const errors: Array<{ customerCode: string; error: string }> = [];
  for (const draft of drafts ?? []) {
    // Claim each row before the network call. A concurrent cron invocation then
    // cannot submit the same customer message twice.
    const claimedAt = new Date().toISOString();
    const previousStatus = draft.status;
    const { data: claimed, error: claimError } = await (supabaseAdmin as any)
      .from("wecom_daily_notification_drafts")
      .update({ status: "submitted", submitted_at: claimedAt, updated_at: claimedAt, failure_reason: null })
      .eq("id", draft.id)
      .eq("status", previousStatus)
      .select("id")
      .maybeSingle();
    if (claimError) throw new Error(claimError.message);
    if (!claimed) continue;
    try {
      const { data: binding, error: bindingError } = await (supabaseAdmin as any)
        .from("wecom_notify_bindings")
        .select("chat_id")
        .eq("customer_code", draft.customer_code)
        .maybeSingle();
      if (bindingError) throw new Error(bindingError.message);
      if (!binding?.chat_id) throw new Error("没有绑定客户群");
      const { data: group, error: groupError } = await (supabaseAdmin as any)
        .from("wecom_notify_groups")
        .select("owner_userid,is_blocked,name")
        .eq("chat_id", binding.chat_id)
        .maybeSingle();
      if (groupError) throw new Error(groupError.message);
      if (!group) throw new Error("绑定的企业微信群不存在");
      if (group.is_blocked) throw new Error("客户群已屏蔽");
      if (!group.owner_userid) throw new Error("已绑定群，但群主 ID 尚未获取");
      const content = String(draft.edited_content ?? draft.rendered_content ?? "").trim();
      if (!content) throw new Error("预发送内容为空");
      const result = await sendGroupMsgTemplate({
        senderUserId: group.owner_userid,
        chatIds: [binding.chat_id],
        content,
      });
      if (!result.ok) throw new Error(JSON.stringify(result.raw));
      submitted += 1;
    } catch (sendError) {
      failed += 1;
      const message = sendError instanceof Error ? sendError.message : "发送失败";
      errors.push({ customerCode: draft.customer_code, error: message });
      await (supabaseAdmin as any)
        .from("wecom_daily_notification_drafts")
        .update({ status: "failed", failure_reason: message, updated_at: new Date().toISOString() })
        .eq("id", draft.id);
    }
  }
  return { ok: true, submitted, failed, errors };
}
