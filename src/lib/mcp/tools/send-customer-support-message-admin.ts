import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";
export default defineTool({
  name: "send_customer_support_message_admin", title: "Send an EPLUS account message to a customer",
  description: "Owner/manager only. Send a persistent message to a customer's EPLUS account. Show the exact customer code and message, then obtain explicit confirmation. This cannot push into a private ChatGPT conversation.",
  inputSchema: { customer_code: z.string().min(1).max(50), message: z.string().min(1).max(4000), confirmation: z.string().min(1).describe("Must exactly equal SEND TO <customer_code> after confirmation.") },
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ customer_code, message, confirmation }, ctx) => { if (!ctx.isAuthenticated()) return unauthenticatedResult(); const code = customer_code.trim(); if (confirmation !== `SEND TO ${code}`) return { content: [{ type: "text", text: `请先展示客户号和完整留言并取得明确确认。确认后使用 SEND TO ${code}。` }], isError: true }; const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_staff_send_support_message", { _customer_code: code, _body: message.trim() }); if (error) return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult(); return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { sent: true, message: data } }; },
});
