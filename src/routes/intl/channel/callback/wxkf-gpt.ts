import { createFileRoute } from "@tanstack/react-router";

/**
 * 微信客服 GPT 独立快速通道回调（不向腾讯云 ADP 转发任何事件）。
 *   GET  ：URL 验证（校验签名 + 解密 echostr，原样返回明文）
 *   POST ：校验签名 + 解密事件，立即返回 200 success，后台 waitUntil 处理
 */
export const Route = createFileRoute("/intl/channel/callback/wxkf-gpt")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const { kfConfig, kfConfigured } = await import("@/lib/wechat-kf/config.server");
        const cfg = kfConfig();
        if (!kfConfigured(cfg)) return new Response("not_configured", { status: 503 });

        const msgSignature = url.searchParams.get("msg_signature") ?? "";
        const timestamp = url.searchParams.get("timestamp") ?? "";
        const nonce = url.searchParams.get("nonce") ?? "";
        const echostr = url.searchParams.get("echostr") ?? "";
        if (!msgSignature || !echostr) return new Response("bad_request", { status: 400 });

        const { verifySignature, decryptMessage } = await import("@/lib/wechat-kf/crypto.server");
        if (!verifySignature(cfg.token, msgSignature, timestamp, nonce, echostr)) {
          console.info("[wxkf-gpt] verify_url signature=invalid");
          return new Response("invalid_signature", { status: 401 });
        }
        try {
          const plain = decryptMessage(cfg.aesKey, echostr, cfg.corpId);
          console.info("[wxkf-gpt] verify_url signature=ok");
          return new Response(plain, {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
          });
        } catch {
          console.info("[wxkf-gpt] verify_url decrypt=failed");
          return new Response("decrypt_failed", { status: 400 });
        }
      },

      POST: async ({ request }) => {
        const startedAt = Date.now();
        const url = new URL(request.url);
        const raw = await request.text();

        const { kfConfig, kfConfigured } = await import("@/lib/wechat-kf/config.server");
        const cfg = kfConfig();
        if (!kfConfigured(cfg)) return new Response("not_configured", { status: 503 });

        const { verifySignature, decryptMessage, xmlValue } = await import("@/lib/wechat-kf/crypto.server");
        const encrypt = xmlValue(raw, "Encrypt");
        const msgSignature = url.searchParams.get("msg_signature") ?? "";
        const timestamp = url.searchParams.get("timestamp") ?? "";
        const nonce = url.searchParams.get("nonce") ?? "";
        if (!encrypt || !verifySignature(cfg.token, msgSignature, timestamp, nonce, encrypt)) {
          console.info("[wxkf-gpt] callback signature=invalid");
          return new Response("invalid_signature", { status: 401 });
        }

        let plain: string;
        try {
          plain = decryptMessage(cfg.aesKey, encrypt, cfg.corpId);
        } catch {
          console.info("[wxkf-gpt] callback decrypt=failed");
          return new Response("decrypt_failed", { status: 400 });
        }

        const background = (async () => {
          try {
            const { processGptCallback } = await import("@/lib/wechat-kf/gpt-lane.server");
            await processGptCallback(plain, url.origin);
          } catch (e) {
            console.error(`[wxkf-gpt] background_failed ${(e as Error)?.name ?? "error"}`);
          }
        })();

        try {
          const { waitUntil } = await import("cloudflare:workers");
          waitUntil(background);
        } catch {
          void background;
        }

        console.info(`[wxkf-gpt] ack status=200 ack_ms=${Date.now() - startedAt}`);
        return new Response("success", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
