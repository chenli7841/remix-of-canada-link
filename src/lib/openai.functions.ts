import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** 登录用户可触发的 OpenAI 连通性测试；只返回成功/失败、状态码、耗时。 */
export const openAiPing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { pingOpenAi } = await import("./openai.server");
    return await pingOpenAi();
  });
