/**
 * 透明反向代理工具（用于微信客服 / 腾讯云 ADP 回调转发）。
 *
 * 原则：
 *  - 完整保留 HTTP method、query、raw body、Content-Type
 *  - 不解析、不修改微信加密消息正文
 *  - 上游状态码 / 响应头 / 响应体原样返回
 *  - 不缓存、不记录任何 Token / Secret / 正文
 */

// 逐跳（hop-by-hop）及平台注入的头，不应转发到上游
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-worker",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

const STRIP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
]);

export async function proxyRequest(
  request: Request,
  upstreamBase: string,
  splat: string,
  prebufferedBody?: ArrayBuffer,
): Promise<Response> {
  const startedAt = Date.now();
  const incoming = new URL(request.url);
  const path = splat ? `/${splat.replace(/^\/+/, "")}` : "";
  const target = `${upstreamBase.replace(/\/$/, "")}${path}${incoming.search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  });

  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";
  // raw body，原样透传，不做任何解析
  const body = hasBody ? (prebufferedBody ?? (await request.arrayBuffer())) : undefined;


  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: body as BodyInit | undefined,
      redirect: "manual",
    });
  } catch {
    // 不记录 URL/正文，避免泄漏 token
    console.error(
      `[reverse-proxy] upstream_unreachable method=${method} path=${incoming.pathname} duration_ms=${Date.now() - startedAt}`,
    );
    return new Response("Upstream unreachable", {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  }

  if (incoming.pathname.startsWith("/cgi-bin/")) {
    let wechatResult = "";
    try {
      const payload = (await upstream.clone().json()) as { errcode?: unknown; errmsg?: unknown };
      if (typeof payload.errcode === "number") {
        const errmsg = typeof payload.errmsg === "string" ? payload.errmsg.replace(/[\r\n]/g, " ") : "";
        wechatResult = ` errcode=${payload.errcode} errmsg=${JSON.stringify(errmsg)}`;
      }
    } catch {
      // 非 JSON 响应不读取、不记录正文
    }
    console.info(
      `[reverse-proxy] completed method=${method} path=${incoming.pathname} status=${upstream.status} duration_ms=${Date.now() - startedAt}${wechatResult}`,
    );
  }

  const outHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) outHeaders.set(key, value);
  });
  outHeaders.set("cache-control", "no-store");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: outHeaders,
  });
}

export function proxyHandlers(upstreamBase: string) {
  const handler = async ({ request, params }: { request: Request; params: Record<string, string | undefined> }) =>
    proxyRequest(request, upstreamBase, params._splat ?? "");
  return {
    GET: handler,
    POST: handler,
    PUT: handler,
    PATCH: handler,
    DELETE: handler,
    HEAD: handler,
    OPTIONS: handler,
  };
}

/**
 * 微信客服 / 企业微信回调专用：
 *  - GET（URL 验证）同步透传，必须原样返回 echostr 明文
 *  - POST 的立即确认与 ctx.waitUntil 注册在 src/server.ts 的 Worker 入口完成；
 *    此处理器是无 Worker 执行上下文时的同步安全后备，避免后台任务被静默终止。
 */
export function callbackProxyHandlers(upstreamBase: string) {
  const passthrough = async ({ request, params }: { request: Request; params: Record<string, string | undefined> }) =>
    proxyRequest(request, upstreamBase, params._splat ?? "");

  return {
    GET: passthrough,
    POST: passthrough,
    PUT: passthrough,
    PATCH: passthrough,
    DELETE: passthrough,
    HEAD: passthrough,
    OPTIONS: passthrough,
  };
}

