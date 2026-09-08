import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// 生成一次性微信 AI 客服绑定码（6 位，10 分钟有效）。
// 客户在微信里把这个码发给 AI 客服，AI 调用 /api/public/ai-bind-wechat 完成绑定。
export const generateWechatAiBindCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { randomInt } = await import("node:crypto");

    // 清理过期/已用的旧码
    await supabaseAdmin
      .from("wechat_ai_bind_codes")
      .delete()
      .eq("user_id", context.userId)
      .lt("expires_at", new Date().toISOString());

    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const { error } = await supabaseAdmin
        .from("wechat_ai_bind_codes")
        .insert({ code, user_id: context.userId, expires_at: expiresAt });
      if (!error) return { code, expires_at: expiresAt };
      if (error.code !== "23505") throw new Error(error.message);
    }
    throw new Error("生成绑定码失败，请重试");
  });
