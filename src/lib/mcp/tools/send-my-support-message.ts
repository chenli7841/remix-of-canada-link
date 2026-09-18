import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";
export default defineTool({
  name: "send_my_support_message", title: "Send a message to EPLUS support",
  description: "Send a persistent non-payment message from the signed-in customer to EPLUS staff. Show the exact message and obtain explicit confirmation before calling.",
  inputSchema: { message: z.string().min(1).max(4000), confirmation: z.string().min(1).describe("Must exactly equal SEND TO EPLUS after confirmation.") },
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ message, confirmation }, ctx) => { if (!ctx.isAuthenticated()) return unauthenticatedResult(); if (confirmation !== "SEND TO EPLUS") return { content: [{ type: "text", text: "请先展示完整留言内容并取得明确确认。确认后使用 SEND TO EPLUS。" }], isError: true }; const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_send_my_support_message", { _body: message.trim() }); if (error) return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult(); return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { sent: true, message: data } }; },
});
