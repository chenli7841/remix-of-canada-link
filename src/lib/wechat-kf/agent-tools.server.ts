/**
 * 微信客服 GPT 通道的 function tools 定义与真实执行层。
 *
 * 所有工具都复用项目已有的真实服务端接口（/api/public/*），
 * 不做任何猜测式回答。身份字段一律由服务端注入，GPT 无法伪造 customer_code。
 *
 * 日志规范：只记录工具名、result_code、耗时；不记录单号、正文、身份或密钥。
 */

export type ToolCtx = {
  baseUrl: string;
  openKfid: string;
  externalUserid: string;
  /** 会话记忆里的最近单号，用于「这个单」「运费呢」等指代 */
  lastTrackingNumber?: string | null;
};

export type ToolResult = { ok: boolean; data: any };

const TRANSFER_TEXT = "已为您转接人工客服，请稍候，客服会尽快回复您。";

/** 内部 HTTP 调用（同源），失败时返回 null */
async function post(baseUrl: string, path: string, body: unknown): Promise<any | null> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch {
    return null;
  }
}

/** 从文本中提取一个明确的单号（FW / 纯数字 10-30 位 / 字母数字混合快递单号） */
export function extractTrackingNumber(text: string): string | null {
  const s = String(text ?? "").toUpperCase();
  const fw = s.match(/FW[0-9A-Z]{4,}/);
  if (fw) return fw[0];
  const num = s.match(/\b[0-9]{8,30}\b/);
  if (num) return num[0];
  const mixed = s.match(/\b[A-Z]{2,4}[0-9]{8,}\b/);
  return mixed ? mixed[0] : null;
}

// ---------------------------------------------------------------- tools

export async function queryTrackingStatus(ctx: ToolCtx, trackingNumber: string): Promise<ToolResult> {
  const n = String(trackingNumber ?? "").trim();
  if (!n) return { ok: false, data: { found: false, result_code: "required_field_missing" } };

  const track = await post(ctx.baseUrl, "/api/public/ai-track", { tracking_number: n });
  const statusCode = track?.status_code ?? (track?.found ? "in_progress" : "not_found");
  let scan: any = null;
  if (!track || statusCode === "pending_intake" || statusCode === "not_found") {
    scan = await post(ctx.baseUrl, "/api/public/ai-warehouse-scan", { tracking_number: n });
  }

  const found = Boolean(track?.found) || Boolean(scan?.found);
  const resultCode = scan?.result_code ?? statusCode ?? "not_found";
  return {
    ok: Boolean(track || scan),
    data: {
      found,
      result_code: resultCode,
      tracking_number: n,
      status_text: track?.status_text ?? null,
      tracking_text: track?.tracking_text ?? null,
      scan_text: scan?.scan_text ?? null,
      needs_order_entry: scan?.needs_order_entry ?? false,
      fw_tracking_no: scan?.fw_tracking_no ?? (track?.found ? track?.tracking_no ?? null : null),
      domestic_tracking_no: scan?.domestic_tracking_no ?? null,
    },
  };
}

export async function queryOrderBilling(ctx: ToolCtx, trackingNumber: string): Promise<ToolResult> {
  const n = String(trackingNumber ?? "").trim();
  if (!n) return { ok: false, data: { found: false, result_code: "required_field_missing" } };
  const r = await post(ctx.baseUrl, "/api/public/ai-order-billing", { tracking_number: n });
  if (!r) return { ok: false, data: { found: false, result_code: "service_unavailable" } };
  return {
    ok: true,
    data: {
      found: r.found ?? false,
      result_code: r.result_code ?? null,
      billing_text: r.billing_text ?? null,
      waybills: r.waybills ?? null,
      batch: r.batch ?? null,
      customer_waybill_count: r.batch?.customer_waybill_count ?? r.customer_waybill_count ?? null,
      customer_billing: r.customer_billing ?? null,
      estimated_arrival_text: r.estimated_arrival_text ?? null,
      eta_disclaimer: r.eta_disclaimer ?? null,
    },
  };
}

export async function resolveOrBindCustomer(ctx: ToolCtx, bindCode?: string | null): Promise<ToolResult> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const code = String(bindCode ?? "").trim().toUpperCase();

  if (code) {
    const r = await post(ctx.baseUrl, "/api/public/ai-bind-wechat", {
      bind_code: code,
      external_userid: ctx.externalUserid,
    });
    if (r?.success) {
      return { ok: true, data: { bound: true, result_code: "bound", message: "绑定成功" } };
    }
    return {
      ok: true,
      data: { bound: false, result_code: r?.result_code ?? "bind_failed", message: r?.message ?? "绑定失败" },
    };
  }

  const { resolveWechatCustomer } = await import("@/lib/wechat-identity.server");
  const resolved = await resolveWechatCustomer(supabaseAdmin, { external_userid: ctx.externalUserid });
  return {
    ok: true,
    data: {
      bound: resolved.found,
      result_code: resolved.result_code,
      // 只暴露脱敏显示名，绝不返回 user_id
      customer_display_name: resolved.customer_display_name,
      message: resolved.message,
    },
  };
}

export async function getForwardingOptions(ctx: ToolCtx): Promise<ToolResult> {
  const r = await post(ctx.baseUrl, "/api/public/ai-forwarding-options", {
    external_userid: ctx.externalUserid,
  });
  if (!r) return { ok: false, data: { found: false, result_code: "service_unavailable" } };
  return {
    ok: true,
    data: {
      found: r.found ?? false,
      result_code: r.result_code ?? null,
      warehouse_code: r.warehouse_code ?? "YW",
      default_address_found: r.default_address_found ?? false,
      customer_display_name: r.customer_display_name ?? null,
      routes: (r.routes ?? []).map((o: any) => ({
        route_id: o.route_id ?? o.id,
        route_code: o.route_code ?? o.code,
        route_name: o.route_name ?? o.name_zh,
        shipping_method: o.shipping_method ?? null,
        transit_time_text: o.transit_time_text ?? null,
        price_text: o.price_text ?? null,
      })),
      options_text: r.options_text ?? null,
      message: r.message ?? null,
    },
  };
}

export async function createForwardingOrder(
  ctx: ToolCtx,
  args: {
    route_id?: string;
    domestic_tracking_no?: string;
    item_name?: string;
    quantity?: number;
    unit_price?: number | null;
    confirm?: boolean;
    idempotency_key?: string;
  },
): Promise<ToolResult> {
  const confirm = args.confirm === true;
  const r = await post(ctx.baseUrl, "/api/public/ai-create-forwarding-order", {
    external_userid: ctx.externalUserid,
    route_id: args.route_id,
    domestic_tracking_no: args.domestic_tracking_no,
    item_name: args.item_name,
    quantity: args.quantity,
    unit_price: args.unit_price ?? null,
    confirm,
    idempotency_key:
      args.idempotency_key || (confirm ? `wxkf-${ctx.externalUserid}-${args.domestic_tracking_no ?? ""}` : ""),
  });
  if (!r) return { ok: false, data: { success: false, result_code: "service_unavailable" } };
  return {
    ok: true,
    data: {
      success: r.success ?? false,
      result_code: r.result_code ?? null,
      customer_bound: r.customer_bound ?? false,
      confirmation_text: r.confirmation_text ?? null,
      created: r.created ?? false,
      fw_tracking_no: r.fw_tracking_no ?? null,
      created_text: r.created_text ?? null,
      message: r.message ?? null,
    },
  };
}

export function transferToHuman(reason?: string): ToolResult {
  return { ok: true, data: { transferred: true, reason: reason ?? "customer_request", reply_text: TRANSFER_TEXT } };
}

// ---------------------------------------------------------------- dispatch

export async function executeTool(name: string, args: any, ctx: ToolCtx): Promise<ToolResult> {
  const t0 = Date.now();
  let out: ToolResult;
  try {
    switch (name) {
      case "query_tracking_status":
        out = await queryTrackingStatus(ctx, args?.tracking_number ?? ctx.lastTrackingNumber ?? "");
        break;
      case "query_order_billing":
        out = await queryOrderBilling(ctx, args?.tracking_number ?? ctx.lastTrackingNumber ?? "");
        break;
      case "resolve_or_bind_customer":
        out = await resolveOrBindCustomer(ctx, args?.bind_code ?? null);
        break;
      case "get_forwarding_options":
        out = await getForwardingOptions(ctx);
        break;
      case "create_forwarding_order":
        out = await createForwardingOrder(ctx, args ?? {});
        break;
      case "transfer_to_human":
        out = transferToHuman(args?.reason);
        break;
      default:
        out = { ok: false, data: { error: "unknown_tool" } };
    }
  } catch {
    out = { ok: false, data: { error: "tool_failed" } };
  }
  console.info(
    `[wxkf-gpt] tool=${name} ok=${out.ok} result_code=${out.data?.result_code ?? out.data?.error ?? "n/a"} tool_ms=${Date.now() - t0}`,
  );
  return out;
}

export const TOOL_DEFS = [
  {
    type: "function",
    name: "query_tracking_status",
    description:
      "查询运单物流状态与到仓扫描情况。支持国内快递单号、FW 集运单号、国际单号。物流状态相关问题必须调用本工具，不得凭常识猜测。",
    parameters: {
      type: "object",
      properties: {
        tracking_number: { type: "string", description: "客户提供的单号；若客户说“这个单”可留空由系统使用最近单号" },
      },
      required: ["tracking_number"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "query_order_billing",
    description:
      "查询运单的运费、长宽高、实际重量、体积重量、计费重量、该客户在批次中的运单数量与预计到达时间。费用/重量/时效问题必须调用本工具。",
    parameters: {
      type: "object",
      properties: { tracking_number: { type: "string", description: "运单号或国内快递单号" } },
      required: ["tracking_number"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "resolve_or_bind_customer",
    description:
      "检查当前微信客户是否已绑定 EPLUS 账号；若客户提供了 6 位绑定码则完成绑定。创建运单前必须先调用。不得根据姓名或群名猜测客户。",
    parameters: {
      type: "object",
      properties: {
        bind_code: { type: ["string", "null"], description: "客户提供的 6 位绑定码，没有则为 null" },
      },
      required: ["bind_code"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "get_forwarding_options",
    description: "获取当前客户可用的集运线路列表（仓库固定义乌 YW）与默认地址状态。创建运单前必须调用以取得合法 route_id。",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: "function",
    name: "create_forwarding_order",
    description:
      "创建集运运单。confirm=false 只校验并返回确认话术；只有客户明确回复“确认创建/确认录单”后才可 confirm=true。confirm=true 必须提供 idempotency_key。",
    parameters: {
      type: "object",
      properties: {
        route_id: { type: "string", description: "必须来自 get_forwarding_options 返回的 route_id" },
        domestic_tracking_no: { type: "string" },
        item_name: { type: "string" },
        quantity: { type: "integer" },
        unit_price: { type: ["number", "null"], description: "单价（人民币），没有则 null" },
        confirm: { type: "boolean" },
        idempotency_key: { type: ["string", "null"] },
      },
      required: ["route_id", "domestic_tracking_no", "item_name", "quantity", "unit_price", "confirm", "idempotency_key"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "transfer_to_human",
    description: "转人工客服。客户明确要求人工、连续两次无法理解、工具数据异常、创建失败无法恢复、投诉或紧急问题时调用。",
    parameters: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
] as const;

export const HUMAN_TRANSFER_TEXT = TRANSFER_TEXT;
