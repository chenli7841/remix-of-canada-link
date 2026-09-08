import { createFileRoute } from "@tanstack/react-router";

/**
 * Start "sign in with WeChat" (no session required).
 *
 * Mints a `login:<random>` state, stored single-use in wechat_login_states
 * (mirrors the "bind" flow's wechat_bind_states — same reasoning: the state
 * must be verified server-side, not just pattern-matched by prefix, or it
 * gives no real protection against authorization-code-injection replay),
 * and redirects to the WeChat QR authorization page.
 */
export const Route = createFileRoute("/api/public/wechat/login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const appid = process.env.WECHAT_APPID;
        if (!appid) {
          return new Response("WeChat sign-in not configured.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { randomBytes } = await import("node:crypto");
        const state = `login:${randomBytes(16).toString("hex")}`;

        // Best-effort cleanup of stale (>15min) pending states.
        await supabaseAdmin
          .from("wechat_login_states")
          .delete()
          .lt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());

        const { error } = await supabaseAdmin.from("wechat_login_states").insert({ state });
        if (error) {
          console.error("[wechat/login] failed to store state", error.message);
          return new Response("WeChat sign-in temporarily unavailable.", { status: 503 });
        }

        // Must match the 授权回调域 registered on open.weixin.qq.com, otherwise
        // WeChat responds with "redirect_uri 参数错误".
        const authorizedOrigin =
          process.env.WECHAT_REDIRECT_ORIGIN?.replace(/\/$/, "") || "https://shopper.epluscanada.com";
        void url;
        const redirectUri = `${authorizedOrigin}/api/public/wechat/callback`;
        const target =
          `https://open.weixin.qq.com/connect/qrconnect?appid=${encodeURIComponent(appid)}` +
          `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_login` +
          `&state=${state}#wechat_redirect`;
        return Response.redirect(target, 302);
      },
    },
  },
});
