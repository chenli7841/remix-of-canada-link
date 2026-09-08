import { createFileRoute } from "@tanstack/react-router";

/**
 * 微信 / 企业微信 身份绑定接口（一次性绑定码方案）。
 *
 * POST /api/public/ai-bind-wechat
 * { "bind_code": "AB12CD", "visitor_biz_id": "...", "external_userid": "...",
 *   "chat_id": "...", "group_name": "可选，仅展示" }
 *
 * 客户在网站「个人资料 → 微信 AI 客服绑定码」生成 6 位码（10 分钟有效），
 * 在会话中回复，AI 携带当前会话的真实身份字段调用本接口完成绑定。
 * 群聊场景写入 chat_id（一个群只能绑定一个客户号）。
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });

const clean = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s.length ? s : null;
};

export const Route = createFileRoute("/api/public/ai-bind-wechat")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return json({ success: false, result_code: "invalid_field", message: "请求体不是合法 JSON" });
        }

        const bindCode = (clean(body.bind_code) ?? "").toUpperCase();
        const visitorBizId = clean(body.visitor_biz_id);
        const externalUserid = clean(body.external_userid);
        const chatId = clean(body.chat_id) ?? clean(body.open_chat_id);
        const groupName = clean(body.group_name);

        if (!bindCode) return json({ success: false, result_code: "required_field_missing", message: "缺少 bind_code" });
        if (!visitorBizId && !externalUserid && !chatId)
          return json({
            success: false,
            result_code: "invalid_channel_identity",
            message: "缺少可用的渠道身份（chat_id / external_userid / visitor_biz_id 至少一个）",
          });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: row } = await supabaseAdmin
          .from("wechat_ai_bind_codes")
          .select("code, user_id, expires_at, used_at")
          .ilike("code", bindCode)
          .maybeSingle();
        if (row && !row.used_at && new Date(row.expires_at as string).getTime() < Date.now())
          return json({ success: false, result_code: "expired_bind_code", message: "绑定码已过期，请重新生成" });
        if (!row || row.used_at)
          return json({ success: false, result_code: "invalid_bind_code", message: "绑定码无效或已过期，请重新生成" });

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id, customer_code, full_name")
          .eq("id", row.user_id)
          .maybeSingle();
        if (!profile?.customer_code)
          return json({ success: false, result_code: "customer_not_found", message: "客户资料缺少客户号，请联系人工客服" });

        // 该身份是否已绑定到别的客户号 —— 一个群 / 一个身份只能对应一个客户（永久一对一）
        const ors: string[] = [];
        if (chatId) ors.push(`chat_id.eq.${chatId}`);
        if (externalUserid) ors.push(`external_userid.eq.${externalUserid}`);
        if (visitorBizId) ors.push(`visitor_biz_id.eq.${visitorBizId}`);
        const { data: existingAll } = await supabaseAdmin
          .from("wechat_identity_bindings")
          .select("id, customer_code, status")
          .or(ors.join(","));
        const existing = (existingAll ?? []).filter((e: any) => (e.status ?? "active") === "active");
        const conflict = existing.find((e: any) => e.customer_code !== profile.customer_code);
        if (conflict)
          return json({
            success: false,
            result_code: "ambiguous_customer",
            message: `该会话已绑定客户号 ${conflict.customer_code}，如需更换请联系人工客服`,
          });

        const channelType = chatId ? "wecom_group" : externalUserid ? "wechat_kf" : "adp_visitor";
        const bindingSource = chatId ? "chat_id" : externalUserid ? "external_userid" : "visitor_biz_id";

        const { maskName } = await import("@/lib/wechat-identity.server");
        const displayName = maskName(String((profile as any).full_name ?? "")) || null;

        const record = {
          channel_type: channelType,
          visitor_biz_id: visitorBizId,
          external_userid: externalUserid,
          chat_id: chatId,
          customer_code: profile.customer_code,
          user_id: profile.id,
          display_group_name: groupName,
          binding_source: bindingSource,
          verified: true,
          status: "active",
          unbound_at: null,
          bound_at: new Date().toISOString(),
          open_kfid: clean(body.open_kfid),
          customer_display_name: displayName,
          updated_at: new Date().toISOString(),
        };

        if (existing.length) {
          const { error } = await supabaseAdmin
            .from("wechat_identity_bindings")
            .update(record)
            .eq("id", (existing as any[])[0].id);
          if (error) return json({ success: false, result_code: "bind_failed", message: "绑定失败，请稍后重试" });
        } else {
          const { error } = await supabaseAdmin.from("wechat_identity_bindings").insert(record);
          if (error) return json({ success: false, result_code: "bind_failed", message: "绑定失败，请稍后重试" });
        }


        await supabaseAdmin
          .from("wechat_ai_bind_codes")
          .update({ used_at: new Date().toISOString(), used_by_visitor_biz_id: visitorBizId ?? chatId ?? externalUserid })
          .eq("code", bindCode);

        return json({
          success: true,
          result_code: "bound",
          customer_code: profile.customer_code,
          binding_source: bindingSource,
          channel_type: channelType,
          message: `绑定成功，客户号 ${profile.customer_code}`,
        });
      },
    },
  },
});
