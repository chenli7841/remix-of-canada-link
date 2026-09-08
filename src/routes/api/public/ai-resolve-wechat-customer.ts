import { createFileRoute } from "@tanstack/react-router";

/**
 * 微信 / 企业微信 身份解析接口（只读）。
 *
 * POST /api/public/ai-resolve-wechat-customer
 * { "visitor_biz_id": "...", "external_userid": "...", "chat_id": "...", "group_name": "可选，仅记录" }
 *
 * 解析优先级：chat_id（群聊） > external_userid（单聊） > visitor_biz_id（ADP 访客）。
 * 群名称、微信备注不参与解析，只能用于首次绑定的辅助信息。
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

export const Route = createFileRoute("/api/public/ai-resolve-wechat-customer")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return json({
            found: false,
            result_code: "invalid_channel_identity",
            customer_code: null,
            customer_display_name: null,
            binding_source: null,
            verified: false,
            message: "请求体不是合法 JSON",
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { resolveWechatCustomer } = await import("@/lib/wechat-identity.server");

        const r = await resolveWechatCustomer(supabaseAdmin, {
          visitor_biz_id: body.visitor_biz_id,
          external_userid: body.external_userid,
          chat_id: body.chat_id ?? body.open_chat_id,
          group_name: body.group_name,
        });

        return json({
          found: r.found,
          result_code: r.result_code,
          customer_code: r.customer_code,
          customer_display_name: r.customer_display_name,
          binding_source: r.binding_source,
          verified: r.verified,
          message: r.message,
        });
      },
    },
  },
});
