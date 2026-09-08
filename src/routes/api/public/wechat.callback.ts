import { createFileRoute } from "@tanstack/react-router";

/**
 * WeChat OAuth callback (网页授权).
 *
 * Flow:
 *  1. Frontend (Profile tab → "绑定微信") calls startWechatBind, which stores
 *     a random `state` -> user_id row and redirects to:
 *       https://open.weixin.qq.com/connect/qrconnect
 *         ?appid=WECHAT_APPID
 *         &redirect_uri={origin}/api/public/wechat/callback
 *         &response_type=code&scope=snsapi_login&state=...
 *  2. WeChat redirects back here with ?code=...&state=...
 *  3. We exchange code -> access_token + openid via:
 *       https://api.weixin.qq.com/sns/oauth2/access_token
 *  4. Fetch nickname via /sns/userinfo, look up `state` to find which
 *     account requested the binding, and upsert profiles.wechat_openid.
 *
 * STATUS: bind flow implemented; sign-in-with-WeChat (no prior session) is
 * still a scaffold — an admin must set WECHAT_APPID and WECHAT_APPSECRET
 * for any of this to activate.
 */
export const Route = createFileRoute("/api/public/wechat/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const appid = process.env.WECHAT_APPID;
        const secret = process.env.WECHAT_APPSECRET;
        const accountUrl = (params: string) => new URL(`/account?tab=profile&${params}`, url.origin).toString();

        if (!appid || !secret) {
          return new Response("WeChat sign-in not configured. Admin must set WECHAT_APPID and WECHAT_APPSECRET.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        if (!code || !state) {
          return new Response("Missing ?code or ?state", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        try {
          const tokenRes = await fetch(
            `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(appid)}` +
              `&secret=${encodeURIComponent(secret)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`,
          );
          const token = await tokenRes.json();
          if (token.errcode) return Response.redirect(accountUrl(`wechat=failed`), 302);

          const { access_token, openid } = token;
          const userRes = await fetch(
            `https://api.weixin.qq.com/sns/userinfo?access_token=${encodeURIComponent(access_token)}` +
              `&openid=${encodeURIComponent(openid)}&lang=zh_CN`,
          );
          const wechatUser = await userRes.json();
          const nickname: string | null = wechatUser?.nickname ?? null;

          // Login mode: state minted by /api/public/wechat/login (no session yet).
          if (state.startsWith("login:")) {
            const { data: loginState } = await supabaseAdmin
              .from("wechat_login_states")
              .select("state")
              .eq("state", state)
              .maybeSingle();
            if (!loginState) {
              return Response.redirect(new URL("/auth?wechat=failed", url.origin).toString(), 302);
            }
            // Single-use — consume before doing anything else, regardless of outcome.
            await supabaseAdmin.from("wechat_login_states").delete().eq("state", state);

            const { data: linked } = await supabaseAdmin
              .from("profiles")
              .select("id, email")
              .eq("wechat_openid", openid)
              .maybeSingle();

            if (!linked?.email) {
              return Response.redirect(new URL("/auth?wechat=notbound", url.origin).toString(), 302);
            }

            const { data: link, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
              type: "magiclink",
              email: linked.email,
              options: { redirectTo: new URL("/account", url.origin).toString() },
            });
            if (linkErr || !link?.properties?.action_link) {
              return Response.redirect(new URL("/auth?wechat=failed", url.origin).toString(), 302);
            }
            return Response.redirect(link.properties.action_link, 302);
          }

          // Bind mode: this `state` was minted by startWechatBind for a logged-in user.
          const { data: pending } = await supabaseAdmin
            .from("wechat_bind_states")
            .select("user_id")
            .eq("state", state)
            .maybeSingle();

          if (!pending) {
            return new Response("WeChat callback received, but this link has expired. Please try binding again.", {
              status: 400,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
          }

          await supabaseAdmin.from("wechat_bind_states").delete().eq("state", state);

          const { error } = await supabaseAdmin
            .from("profiles")
            .update({ wechat_openid: openid, wechat_nickname: nickname })
            .eq("id", pending.user_id);

          if (error) {
            // Most likely the unique index on wechat_openid — this WeChat account is
            // already linked to a different SinoCargo account.
            const reason = error.code === "23505" ? "taken" : "failed";
            return Response.redirect(accountUrl(`wechat=${reason}`), 302);
          }

          return Response.redirect(accountUrl("wechat=bound"), 302);
        } catch {
          return Response.redirect(accountUrl("wechat=failed"), 302);
        }
      },
    },
  },
});
