import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Kick off the WeChat "bind account" flow from the Profile tab. Returns
// `configured: false` until an admin sets WECHAT_APPID/WECHAT_APPSECRET
// (same gate as the /api/public/wechat/callback scaffold), so the UI can show
// a friendly "coming soon" message instead of a broken redirect.
export const startWechatBind = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { origin: string }) => d)
  .handler(async ({ data, context }) => {
    const appid = process.env.WECHAT_APPID;
    if (!appid) return { configured: false as const };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { randomBytes } = await import("node:crypto");
    const state = randomBytes(24).toString("hex");

    // Best-effort cleanup of stale (>15min) pending states.
    await supabaseAdmin
      .from("wechat_bind_states")
      .delete()
      .lt("created_at", new Date(Date.now() - 15 * 60 * 1000).toISOString());

    const { error } = await supabaseAdmin.from("wechat_bind_states").insert({ state, user_id: context.userId });
    if (error) throw new Error(error.message);

    // WeChat validates redirect_uri against the single 授权回调域 registered on
    // open.weixin.qq.com. Preview/localhost origins are rejected with
    // "redirect_uri 参数错误", so always use the registered public origin.
    const authorizedOrigin =
      process.env.WECHAT_REDIRECT_ORIGIN?.replace(/\/$/, "") || "https://shopper.epluscanada.com";
    void data.origin;
    const redirectUri = `${authorizedOrigin}/api/public/wechat/callback`;
    const url =
      `https://open.weixin.qq.com/connect/qrconnect?appid=${encodeURIComponent(appid)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=snsapi_login` +
      `&state=${state}#wechat_redirect`;
    return { configured: true as const, url };
  });

export const unbindWechat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ wechat_openid: null, wechat_nickname: null })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
