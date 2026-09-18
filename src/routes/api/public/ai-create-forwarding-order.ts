import { createFileRoute } from "@tanstack/react-router";

/**
 * 腾讯云 ADP 微信 AI 客服「创建运单（FW 集运订单）」接口。
 *
 * POST /api/public/ai-create-forwarding-order
 *
 * 归属只能由服务端通过 visitor_biz_id -> wechat_ai_bindings -> user_id 决定，
 * 请求体里的 customer_code / user_id 一律忽略。
 *
 * confirm=false 只校验并返回确认话术；confirm=true 才真正写库
 * （place_forwarding 一次 RPC = 一个事务，任何一步失败整体回滚）。
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

type Result = {
  success: boolean;
  result_code: string;
  customer_bound: boolean;
  confirmation_text: string | null;
  created: boolean;
  fw_tracking_no: string | null;
  domestic_tracking_no?: string | null;
  customer_display_name?: string | null;
  created_text?: string | null;
  message: string;
  [k: string]: unknown;
};

const fail = (result_code: string, message: string, extra: Record<string, unknown> = {}, status = 200) =>
  json(
    {
      success: false,
      result_code,
      customer_bound: extra.customer_bound === true,
      confirmation_text: null,
      created: false,
      fw_tracking_no: null,
      message,
      ...extra,
    } satisfies Partial<Result>,
    status,
  );

const CARGO_ZH: Record<string, string> = { general: "普货", sensitive: "敏货" };



export const Route = createFileRoute("/api/public/ai-create-forwarding-order")({
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
          return fail("invalid_channel_identity", "缺少可用的渠道身份（chat_id / external_userid / visitor_biz_id 至少一个）");


        const confirm = body.confirm === true || body.confirm === "true";
        const idempotencyKey = str(body.idempotency_key);
        const domesticRaw = str(body.domestic_tracking_no);
        const domestic = domesticRaw.replace(/\s+/g, "").toUpperCase();
        const carrier = str(body.carrier);
        const itemName = str(body.item_name);
        const quantity = Number(body.quantity ?? 1);
        const routeIdIn = str(body.route_id);
        const unitPriceRaw = body.unit_price;
        const unitPrice =
          unitPriceRaw === null || unitPriceRaw === undefined || unitPriceRaw === "" ? null : Number(unitPriceRaw);
        const currency = (str(body.currency) || "CNY").toUpperCase();
        const remark = str(body.remark);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // ---------- 1. 身份解析（唯一入口，忽略请求体里的任何 customer_code） ----------
        const { resolveWechatCustomer } = await import("@/lib/wechat-identity.server");
        const resolved = await resolveWechatCustomer(supabaseAdmin, {
          visitor_biz_id: visitorBizId,
          external_userid: externalUserid,
          chat_id: chatId,
          group_name: str(body.group_name),
        });
        if (!resolved.found || !resolved.user_id) {
          return fail(resolved.result_code, resolved.message, {
            customer_bound: false,
            binding_source: resolved.binding_source,
          });
        }
        const userId = resolved.user_id;
        const displayName = resolved.customer_display_name;

        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("id, customer_code, full_name, email, vip_level")
          .eq("id", userId)
          .maybeSingle();
        if (!profile?.customer_code) {
          return fail("customer_not_found", "绑定的客户资料不存在或缺少客户号，请联系人工客服", { customer_bound: true });
        }

        // ---------- 2. 幂等 ----------
        if (idempotencyKey) {
          const { data: prior } = await supabaseAdmin
            .from("ai_forwarding_requests")
            .select("request_no, domestic_tracking_no, forwarding_id")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();
          if (prior?.request_no) {
            return json({
              success: true,
              result_code: "idempotent_replay",
              customer_bound: true,
              confirmation_text: null,
              created: true,
              fw_tracking_no: prior.request_no,
              domestic_tracking_no: prior.domestic_tracking_no ?? null,
              customer_display_name: displayName,
              created_text: `该录单已创建过，集运单号：${prior.request_no}，国内快递单号：${prior.domestic_tracking_no ?? "-"}。`,
              message: "重复请求，返回已创建的订单",
            } satisfies Result);
          }
        } else if (confirm) {
          return fail("required_field_missing", "确认创建时必须提供 idempotency_key", { customer_bound: true });
        }

        // ---------- 3. 必填校验 ----------
        if (!routeIdIn) return fail("required_field_missing", "缺少线路 route_id（须来自 ai-forwarding-options 接口）", { customer_bound: true });
        if (!domestic) return fail("required_field_missing", "缺少国内快递单号 domestic_tracking_no", { customer_bound: true });
        if (!itemName) return fail("required_field_missing", "缺少物品名称 item_name", { customer_bound: true });
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isInteger(quantity))
          return fail("invalid_field", "件数 quantity 必须为大于 0 的整数", { customer_bound: true });
        if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0))
          return fail("invalid_field", "单价 unit_price 必须为非负数字", { customer_bound: true });
        if (!["CNY", "CAD"].includes(currency))
          return fail("invalid_field", "币种 currency 仅支持 CNY 或 CAD", { customer_bound: true });

        // ---------- 4. 线路二次校验（只信 route_id，不信名称/客户号） ----------
        const { listWechatAiRoutes, getDefaultAddress, shippingMethodZh } = await import(
          "@/lib/wechat-ai-routes.server"
        );
        const vip = String((profile as any).vip_level ?? "normal");
        const code = String((profile as any).customer_code);
        const { warehouse, routes: aiRoutes } = await listWechatAiRoutes(supabaseAdmin, {
          customer_code: code,
          vip_level: vip,
        });
        if (!warehouse)
          return fail("warehouse_not_found", "义乌仓 (YW) 未配置，请联系人工客服", { customer_bound: true });
        const route = aiRoutes.find((r) => String(r.id) === routeIdIn) ?? null;
        if (!route)
          return fail("route_not_available", "所选线路已失效或对该客户不可用，请重新获取线路列表", {
            customer_bound: true,
            available_routes: aiRoutes.map((r) => ({ route_id: r.id, route_code: r.code, route_name: r.name_zh })),
          });

        // 线路要求的逐项必填字段（item_field_required）——AI 单物品录单只能满足
        // name / quantity / unit_price，其它（hscode、材质、箱数…）必须走网站。
        const req = (route.item_field_required ?? {}) as Record<string, boolean>;
        const unsupported = Object.keys(req).filter(
          (f) => req[f] && !["name", "quantity", "unit_price"].includes(f),
        );
        if (unsupported.length)
          return fail("invalid_field", `线路 ${route.code} 需要填写 ${unsupported.join("、")} 等资料，请客户在网站录单或联系人工客服`, {
            customer_bound: true,
          });
        if (req.unit_price && unitPrice === null)
          return fail("required_field_missing", `线路 ${route.code} 要求填写单价 unit_price`, {
            customer_bound: true,
          });

        // ---------- 5. 默认地址（不让客户在微信中选择） ----------
        const address = await getDefaultAddress(supabaseAdmin, userId);
        if (!address)
          return fail("default_address_required", "您的账户尚未设置默认收货地址，请先登录系统设置。", {
            customer_bound: true,
          });
        const addressId = String(address.id);


        // ---------- 6. 国内单号查重（本人或他人均视为重复） ----------
        const { data: dupFo } = await supabaseAdmin
          .from("forwarding_orders")
          .select("id, user_id, request_no")
          .eq("domestic_tracking_no", domestic)
          .limit(1);
        const { data: dupOrder } = await supabaseAdmin
          .from("orders")
          .select("id, user_id")
          .eq("domestic_tracking_no", domestic)
          .limit(1);
        const dup = (dupFo ?? [])[0] ?? (dupOrder ?? [])[0];
        if (dup) {
          const mine = (dup as any).user_id === userId;
          return fail(
            "duplicate_tracking_number",
            mine
              ? `国内单号 ${domestic} 已在您的账户中录入过，请勿重复录单`
              : `国内单号 ${domestic} 已被录入系统，请核对单号或联系人工客服`,
            { customer_bound: true, domestic_tracking_no: domestic },
          );
        }

        // ---------- 7. 确认摘要 ----------
        const declared = unitPrice === null ? null : Number((unitPrice * quantity).toFixed(2));
        const lines = [
          `客户：${displayName}（客户号 ${code}）`,
          `国内快递单号：${domestic}`,
          carrier ? `快递公司：${carrier}` : null,
          `物品名称：${itemName}`,
          `件数：${quantity}`,
          `线路：${route.name_zh}（${route.code}）`,
          `运输方式：${shippingMethodZh(String(route.shipping_method))}`,
          `货物类别：${CARGO_ZH[String(route.cargo_type)] ?? route.cargo_type}`,
          unitPrice !== null ? `单价：${unitPrice} ${currency}（申报价值 ${declared} ${currency}）` : null,
          `收货地址：${address.recipient} / ${address.city} ${address.province}`,
          remark ? `备注：${remark}` : null,
        ].filter(Boolean);
        const confirmationText = `请确认以下录单资料：\n${lines.join("\n")}\n确认无误请回复「确认创建」。`;


        if (!confirm) {
          return json({
            success: true,
            result_code: "validation_passed",
            customer_bound: true,
            confirmation_text: confirmationText,
            created: false,
            fw_tracking_no: null,
            domestic_tracking_no: domestic,
            customer_display_name: displayName,
            message: "资料校验通过，请客户确认",
          } satisfies Result);
        }

        // ---------- 8. 创建（place_forwarding = 单事务） ----------
        const unitField = currency === "CAD" ? "unit_price_cad" : "unit_price_cny";
        const payload: Record<string, unknown> = {
          warehouse: "YW",
          route_code: route.code,
          address_id: addressId || null,
          domestic_tracking_no: domestic,
          cargo_type: route.cargo_type,
          note: [carrier ? `快递公司：${carrier}` : null, remark || null].filter(Boolean).join(" / ") || null,
          items: [
            {
              name: itemName,
              quantity,
              [unitField]: unitPrice ?? "",
              extras: { origin: "China" },
            },
          ],
        };

        let { data: rpc, error: rpcErr } = await supabaseAdmin.rpc("place_forwarding", {
          _payload: payload as any,
          _target_user_id: userId,
        });
        // statement_timeout (57014) rolls back the whole RPC — nothing committed —
        // so one bounded retry is safe here too (mirrors the customer/admin forms).
        const isStatementTimeout = rpcErr?.code === "57014" || /statement timeout/i.test(rpcErr?.message ?? "");
        if (isStatementTimeout) {
          await new Promise((resolve) => setTimeout(resolve, 800));
          const retry = await supabaseAdmin.rpc("place_forwarding", {
            _payload: payload as any,
            _target_user_id: userId,
          });
          rpc = retry.data;
          rpcErr = retry.error;
        }
        const r = rpc as any;
        if (rpcErr || !r?.ok) {
          return fail("creation_failed", rpcErr?.message ?? r?.reason ?? "创建失败，请联系人工客服", {
            customer_bound: true,
          });
        }

        const requestNo: string = r.request_no;
        if (idempotencyKey) {
          await supabaseAdmin.from("ai_forwarding_requests").insert({
            idempotency_key: idempotencyKey,
            visitor_biz_id: visitorBizId || chatId || externalUserid,
            user_id: userId,
            forwarding_id: r.id,
            request_no: requestNo,
            domestic_tracking_no: domestic,
            source: "wechat_ai",
            payload: payload as any,
          });
        }

        return json({
          success: true,
          result_code: "order_created",
          customer_bound: true,
          confirmation_text: null,
          created: true,
          fw_tracking_no: requestNo,
          domestic_tracking_no: domestic,
          customer_display_name: displayName,
          created_text: `录单成功！集运单号：${requestNo}，国内快递单号：${domestic}，物品：${itemName}×${quantity}，线路：${route.name_zh}。包裹到仓后我们会自动更新状态，可随时凭单号查询。`,
          message: "订单创建成功",
        } satisfies Result);
      },
    },
  },
});
