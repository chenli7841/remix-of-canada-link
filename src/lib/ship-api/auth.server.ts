// ship API 鉴权地基：/api/partners/v1/* 专用，独立于现有微信 Basic Auth / 网页 Cookie
// 登录 / MCP OAuth，互不影响。见 docs/ship-api/shipper-api-v3.md 第 2 节、
// docs/ship-api/system-change-guide-v3.md 第 8 节。
//
// 注意命名上的一个坑：这里的 scope 概念（routes:read / orders:write 等）跟系统里
// has_role() 的员工角色 "owner" 是两回事；profiles.vip_level 新增的 'owner' 客户分级
// 值也是另一回事——三者共享 "owner" 这个词但完全独立，不要混着判断。

import { createHash, randomBytes } from "node:crypto";

export type ShipApiScope = "routes:read" | "orders:read" | "orders:write" | "customers:write" | "orders:fees:read";

export const SHIP_API_SCOPES: ShipApiScope[] = [
  "routes:read",
  "orders:read",
  "orders:write",
  "customers:write",
  "orders:fees:read",
];

// ship API 对外根地址——凭证管理页面复制"对接信息"时用。跟 OTTPAY_PUBLIC_ORIGIN /
// WECHAT_REDIRECT_ORIGIN 是同一种"每个对外功能各自一个环境变量"的做法，但这里
// 不给兜底域名：这个仓库会被部署到不同域名，猜一个默认值一旦猜错，交付给合作方
// 的地址就是错的——没配置就必须显式告诉管理员"尚未配置"，不能编一个出来。
export function getShipApiPublicOrigin(): string | null {
  const raw = process.env.SHIP_API_PUBLIC_ORIGIN?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}

export type ShipApiErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "SCOPE_FORBIDDEN"
  | "ROUTE_FORBIDDEN"
  | "ORDER_NOT_FOUND"
  | "CUSTOMER_NOT_FOUND"
  | "ROUTE_NOT_FOUND"
  | "DOMESTIC_NUMBER_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "ORDER_LOCKED"
  | "ROUTE_DISABLED"
  | "ROUTE_SCHEMA_CHANGED"
  | "VERSION_CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "VALIDATION_FAILED"
  | "UNKNOWN_FIELD"
  | "PACKAGE_COUNT_MISMATCH"
  | "PRECONDITION_REQUIRED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "TEMPORARILY_UNAVAILABLE";

const CODE_HTTP_STATUS: Record<ShipApiErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  SCOPE_FORBIDDEN: 403,
  ROUTE_FORBIDDEN: 403,
  ORDER_NOT_FOUND: 404,
  CUSTOMER_NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  DOMESTIC_NUMBER_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  ORDER_LOCKED: 409,
  ROUTE_DISABLED: 409,
  ROUTE_SCHEMA_CHANGED: 409,
  VERSION_CONFLICT: 412,
  PAYLOAD_TOO_LARGE: 413,
  VALIDATION_FAILED: 422,
  UNKNOWN_FIELD: 422,
  PACKAGE_COUNT_MISMATCH: 422,
  PRECONDITION_REQUIRED: 428,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  TEMPORARILY_UNAVAILABLE: 503,
};

// 契约里业务错误默认不可重试；只有 429/500/503 这几个"临时性"错误标 retryable=true，
// 具体见 shipper-api-v3.md 第 11 节的错误码表。
const RETRYABLE_CODES = new Set<ShipApiErrorCode>(["RATE_LIMITED", "INTERNAL_ERROR", "TEMPORARILY_UNAVAILABLE"]);

export class ShipApiError extends Error {
  code: ShipApiErrorCode;
  fields?: { path: string; message: string }[];
  retryable: boolean;
  // 额外的错误上下文，合并进 error 对象——目前只用于客户资料 412 冲突时按契约要求
  // 附带 currentEditToken，让 Shipper 能先核对最新资料再决定要不要重新提交。
  meta?: Record<string, unknown>;
  constructor(
    code: ShipApiErrorCode,
    message: string,
    fields?: { path: string; message: string }[],
    meta?: Record<string, unknown>,
  ) {
    super(message);
    this.code = code;
    this.fields = fields;
    this.retryable = RETRYABLE_CODES.has(code);
    this.meta = meta;
  }
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
  "access-control-allow-headers": "content-type, authorization, idempotency-key, if-match, x-request-id",
  "cache-control": "no-store",
} as const;

function newRequestId(): string {
  return `req_${randomBytes(12).toString("hex")}`;
}

export function shipApiJson(data: unknown, status = 200, requestId?: string): Response {
  return new Response(JSON.stringify({ requestId: requestId ?? newRequestId(), data, error: null }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS },
  });
}

export function shipApiError(err: ShipApiError, requestId?: string): Response {
  return new Response(
    JSON.stringify({
      requestId: requestId ?? newRequestId(),
      data: null,
      error: { code: err.code, message: err.message, fields: err.fields ?? [], retryable: err.retryable, ...(err.meta ?? {}) },
    }),
    {
      status: CODE_HTTP_STATUS[err.code],
      headers: { "content-type": "application/json; charset=utf-8", ...CORS },
    },
  );
}

export function shipApiOptions(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

// 统一包一层：捕获 ShipApiError 按契约格式返回；其他异常一律 500 INTERNAL_ERROR，
// 绝不把原始错误信息/堆栈吐给合作方（shipper-api-v3.md 第 11 节："服务方不返回数据库
// 异常堆栈"）。
export async function withShipApiHandler(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (e: any) {
    if (e instanceof ShipApiError) return shipApiError(e);
    console.error("[ship-api] unhandled error:", e);
    return shipApiError(new ShipApiError("INTERNAL_ERROR", "服务器内部错误"));
  }
}

export function sha256Hex(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

// 生成一个不可预测的新 token：前缀方便肉眼分辨环境/用途，主体是加密安全随机串。
// 只有这一次能拿到明文——数据库只存它的哈希。
export function generatePartnerApiToken(): string {
  return `spk_${randomBytes(32).toString("base64url")}`;
}

export type ShipApiAuthContext = {
  tokenId: string;
  partnerKey: string;
  scopes: ShipApiScope[];
};

// 校验 Authorization: Bearer <token>，核对所需 scope。找不到/已撤销/已停用一律
// 401 UNAUTHORIZED（不区分"token 不存在"和"token 已撤销"，避免给探测者可用信息）；
// scope 不够是 403 SCOPE_FORBIDDEN。
// 用 service_role 直查表——这张表 RLS 对 anon/authenticated 全拒绝，只有这条路径能读。
export async function authenticateShipApi(
  request: Request,
  requiredScopes: ShipApiScope[],
): Promise<ShipApiAuthContext> {
  const authHeader = request.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!m || !m[1]) throw new ShipApiError("UNAUTHORIZED", "缺少或格式错误的 Authorization: Bearer <token>");
  const raw = m[1].trim();
  const hash = sha256Hex(raw);

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row, error } = await (supabaseAdmin as any)
    .from("partner_api_tokens")
    .select("id, partner_key, scopes, is_active, revoked_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (error) throw new ShipApiError("INTERNAL_ERROR", "凭证校验失败");
  if (!row || !row.is_active || row.revoked_at) throw new ShipApiError("UNAUTHORIZED", "凭证无效");

  const scopes = (row.scopes ?? []) as ShipApiScope[];
  const missing = requiredScopes.filter((s) => !scopes.includes(s));
  if (missing.length > 0) {
    throw new ShipApiError("SCOPE_FORBIDDEN", `凭证缺少必要权限：${missing.join(", ")}`);
  }

  // 更新 last_used_at 是运维可观测性用途，不是鉴权路径的一部分——失败了也不影响这次请求。
  (supabaseAdmin as any)
    .from("partner_api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(
      () => {},
      () => {},
    );

  return { tokenId: row.id as string, partnerKey: row.partner_key as string, scopes };
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key) throw new ShipApiError("PRECONDITION_REQUIRED", "写操作必须提供 Idempotency-Key 请求头");
  return key;
}

export function getIfMatch(request: Request): string | null {
  const raw = request.headers.get("if-match")?.trim();
  if (!raw) return null;
  // If-Match 按 HTTP 规范可能带引号包裹，例如 "opaque-token"；原样比对前先去掉外层引号。
  return raw.replace(/^"(.*)"$/, "$1");
}

export function requireIfMatch(request: Request): string {
  const v = getIfMatch(request);
  if (!v) throw new ShipApiError("PRECONDITION_REQUIRED", "修改/删除操作必须提供 If-Match 请求头");
  return v;
}
