import { createFileRoute } from "@tanstack/react-router";

const RESPONSE_HEADERS = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
};

/**
 * EPLUS 群发通知独立应用的企业微信回调。
 *
 * GET 供企业微信验证“接收消息服务器 URL”；POST 只验证并确认事件，
 * 不进入现有微信 AI 客服链路，也不复用它的 Token/AES Key。
 */
export const Route = createFileRoute("/api/public/wecom-notify/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const { wecomNotifyConfig, wecomNotifyCallbackConfigured } = await import(
          "@/lib/wecom-notify/config.server"
        );
        const cfg = wecomNotifyConfig();
        if (!wecomNotifyCallbackConfigured(cfg)) {
          return new Response("not_configured", { status: 503, headers: RESPONSE_HEADERS });
        }

        const msgSignature = url.searchParams.get("msg_signature") ?? "";
        const timestamp = url.searchParams.get("timestamp") ?? "";
        const nonce = url.searchParams.get("nonce") ?? "";
        const echoStr = url.searchParams.get("echostr") ?? "";
        if (!msgSignature || !timestamp || !nonce || !echoStr) {
          return new Response("bad_request", { status: 400, headers: RESPONSE_HEADERS });
        }

        const { verifySignature, decryptMessage } = await import("@/lib/wechat-kf/crypto.server");
        if (!verifySignature(cfg.callbackToken, msgSignature, timestamp, nonce, echoStr)) {
          console.info("[wecom-notify-callback] verify signature=invalid");
          return new Response("invalid_signature", { status: 401, headers: RESPONSE_HEADERS });
        }

        try {
          const plain = decryptMessage(cfg.callbackAesKey, echoStr, cfg.corpId);
          console.info("[wecom-notify-callback] verify signature=ok");
          return new Response(plain, { status: 200, headers: RESPONSE_HEADERS });
        } catch {
          console.info("[wecom-notify-callback] verify decrypt=failed");
          return new Response("decrypt_failed", { status: 400, headers: RESPONSE_HEADERS });
        }
      },

      POST: async ({ request }) => {
        const url = new URL(request.url);
        const raw = await request.text();
        const { wecomNotifyConfig, wecomNotifyCallbackConfigured } = await import(
          "@/lib/wecom-notify/config.server"
        );
        const cfg = wecomNotifyConfig();
        if (!wecomNotifyCallbackConfigured(cfg)) {
          return new Response("not_configured", { status: 503, headers: RESPONSE_HEADERS });
        }

        const { verifySignature, decryptMessage, xmlValue } = await import("@/lib/wechat-kf/crypto.server");
        const encrypt = xmlValue(raw, "Encrypt") ?? "";
        const msgSignature = url.searchParams.get("msg_signature") ?? "";
        const timestamp = url.searchParams.get("timestamp") ?? "";
        const nonce = url.searchParams.get("nonce") ?? "";
        if (!encrypt || !verifySignature(cfg.callbackToken, msgSignature, timestamp, nonce, encrypt)) {
          console.info("[wecom-notify-callback] event signature=invalid");
          return new Response("invalid_signature", { status: 401, headers: RESPONSE_HEADERS });
        }

        try {
          decryptMessage(cfg.callbackAesKey, encrypt, cfg.corpId);
          console.info("[wecom-notify-callback] event accepted");
          return new Response("success", { status: 200, headers: RESPONSE_HEADERS });
        } catch {
          console.info("[wecom-notify-callback] event decrypt=failed");
          return new Response("decrypt_failed", { status: 400, headers: RESPONSE_HEADERS });
        }
      },
    },
  },
});
