import { createFileRoute } from "@tanstack/react-router";

/**
 * 微信 AI 客服「可用线路查询」只读接口。
 *
 * POST /api/public/ai-forwarding-options
 * { "visitor_biz_id": "...", "external_userid": "可选", "chat_id": "可选" }
 *
 * 只返回：有效 + 起点仓义乌(YW) + 对该客户可用 + wechat_ai_enabled=true 的线路。
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

const fail = (result_code: string, message: string, extra: Record<string, unknown> = {}) =>
  json({
    found: false,
    result_code,
    warehouse_code: "YW",
    warehouse_name: "义乌仓",
    default_address_found: false,
    routes: [],
    options_text: null,
    message,
    ...extra,
  });

export const Route = createFileRoute("/api/public/ai-forwarding-options")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request }) => {
        let body: any;
        try {
          body = await request.json();
        } catch {
          return fail("invalid_field", "请求体不是合法 JSON");
        }

        const str = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
        const visitorBizId = str(body.visitor_biz_id);
        const externalUserid = str(body.external_userid);
        const chatId = str(body.chat_id) || str(body.open_chat_id);
        if (!visitorBizId && !externalUserid && !chatId)
          return fail("invalid_channel_identity", "缺少可用的渠道身份（visitor_biz_id / external_userid / chat_id 至少一个）");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { resolveWechatCustomer } = await import("@/lib/wechat-identity.server");
        const { listWechatAiRoutes, toRouteOption, getDefaultAddress, shippingMethodZh } = await import(
          "@/lib/wechat-ai-routes.server"
        );

        const resolved = await resolveWechatCustomer(supabaseAdmin, {
          visitor_biz_id: visitorBizId,
          external_userid: externalUserid,
          chat_id: chatId,
          group_name: str(body.group_name),
        });
        if (!resolved.found || !resolved.user_id) return fail(resolved.result_code, resolved.message);

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id, customer_code, vip_level")
          .eq("id", resolved.user_id)
          .maybeSingle();
        if (!profile?.customer_code)
          return fail("customer_not_found", "绑定的客户资料不存在或缺少客户号，请联系人工客服");

        const { warehouse, routes } = await listWechatAiRoutes(supabaseAdmin, {
          customer_code: String(profile.customer_code),
          vip_level: String((profile as any).vip_level ?? "normal"),
        });
        if (!warehouse) return fail("warehouse_not_found", "义乌仓 (YW) 未配置，请联系人工客服");

        const address = await getDefaultAddress(supabaseAdmin, resolved.user_id);

        if (!routes.length)
          return json({
            found: false,
            result_code: "no_routes_available",
            warehouse_code: warehouse.code,
            warehouse_name: warehouse.name,
            default_address_found: !!address,
            customer_display_name: resolved.customer_display_name,
            routes: [],
            options_text: null,
            message: "该客户当前没有可用于微信 AI 录单的线路，请联系人工客服",
          });

        const options = routes.map(toRouteOption);
        const optionsText = `请选择运输线路：\n${options
          .map(
            (o, i) =>
              `${i + 1}. ${o.route_name}（${shippingMethodZh(o.shipping_method)}${
                o.transit_time_text ? "，" + o.transit_time_text : ""
              }${o.price_text ? "，" + o.price_text : ""}）`,
          )
          .join("\n")}`;

        return json({
          found: true,
          result_code: "options_found",
          warehouse_code: warehouse.code,
          warehouse_name: warehouse.name,
          customer_display_name: resolved.customer_display_name,
          default_address_found: !!address,
          routes: options,
          options_text: optionsText,
          message: address ? "线路可选" : "线路可选，但该客户尚未设置默认收货地址",
        });
      },
    },
  },
});
