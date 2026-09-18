import "./lib/error-capture";

import { waitUntil } from "cloudflare:workers";
import { consumeLastCapturedError, isAbortError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { proxyRequest } from "./lib/reverse-proxy";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

const ACK_BODY = "success";
const ACK_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};

async function handleAdpCallback(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url);
  const prefix = "/intl/channel/callback/";
  if (!url.pathname.startsWith(prefix)) return undefined;
  // GPT 独立快速通道由 TanStack 路由自行处理，绝不转发 ADP
  if (url.pathname === "/intl/channel/callback/wxkf-gpt") return undefined;


  const splat = url.pathname.slice(prefix.length);
  if (request.method !== "POST") {
    return proxyRequest(request, "https://adp.tencentcloud.com/intl/channel/callback", splat);
  }

  const startedAt = Date.now();
  const rawBody = await request.arrayBuffer();

  const { callbackFingerprint, claimCallback } = await import("./lib/wechat-callback-dedup.server");
  const hash = await callbackFingerprint(url.search, rawBody);
  const short = hash.slice(0, 8);

  const forwardPromise = (async () => {
    const first = await claimCallback(hash);
    if (!first) {
      console.info(`[adp-callback] duplicate_skipped hash=${short} duplicate=true`);
      return;
    }

    // 本地快速通道：图片识别 / 查询 / 录单固定业务，不经过 ADP。
    try {
      const { kfConfig, kfConfigured, kfEnabled, kfTestUsers } = await import("./lib/wechat-kf/config.server");
      const cfg = kfConfig();
      if (kfEnabled() && kfConfigured(cfg)) {
        const { verifySignature, decryptMessage } = await import("./lib/wechat-kf/crypto.server");
        const raw = new TextDecoder().decode(rawBody);
        const { xmlValue } = await import("./lib/wechat-kf/crypto.server");
        const encrypt = xmlValue(raw, "Encrypt");
        const msgSignature = url.searchParams.get("msg_signature") ?? "";
        const timestamp = url.searchParams.get("timestamp") ?? "";
        const nonce = url.searchParams.get("nonce") ?? "";
        if (encrypt && verifySignature(cfg.token, msgSignature, timestamp, nonce, encrypt)) {
          const plain = decryptMessage(cfg.aesKey, encrypt, cfg.corpId);
          const { processCallback } = await import("./lib/wechat-kf/dispatch.server");
          const handled = await processCallback(plain, url.origin, kfTestUsers());

          if (handled > 0) {
            console.info(`[wechat-kf] fast_lane_handled hash=${short} count=${handled}`);
            return; // 已本地处理，不再转发 ADP
          }
        }
      }
    } catch (e) {
      console.error(`[wechat-kf] fast_lane_failed hash=${short} ${(e as Error)?.message ?? "unknown"}`);
    }

    console.info(`[adp-callback] background_forward_started hash=${short} duplicate=false`);

    const forwardStartedAt = Date.now();
    try {
      const upstream = await proxyRequest(
        request,
        "https://adp.tencentcloud.com/intl/channel/callback",
        splat,
        rawBody,
      );
      console.info(
        `[adp-callback] background_forward_completed hash=${short} adp_upstream_status=${upstream.status} adp_upstream_duration_ms=${Date.now() - forwardStartedAt}`,
      );
    } catch {
      console.error(
        `[adp-callback] background_forward_failed hash=${short} adp_upstream_status=unavailable adp_upstream_duration_ms=${Date.now() - forwardStartedAt}`,
      );
    }
  })();

  waitUntil(forwardPromise);
  console.info(
    `[adp-callback] wait_until_registered hash=${short} status=200 response_duration_ms=${Date.now() - startedAt}`,
  );
  return new Response(ACK_BODY, { status: 200, headers: ACK_HEADERS });
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  const captured = consumeLastCapturedError();
  // 客户端主动断开（AbortError）不是应用错误：不打日志、不返回错误页。
  if (isAbortError(captured)) return new Response(null, { status: 499 });

  console.error(captured ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const callbackResponse = await handleAdpCallback(request);
      if (callbackResponse) return callbackResponse;

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      if (isAbortError(error)) return new Response(null, { status: 499 });
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
