import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";
export default defineTool({
  name: "list_my_support_messages", title: "List my EPLUS support messages",
  description: "List support messages belonging to the signed-in EPLUS customer, newest first. Never accept a customer code from chat.",
  inputSchema: { limit: z.number().int().min(1).max(50).optional() }, annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => { if (!ctx.isAuthenticated()) return unauthenticatedResult(); const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_list_my_support_messages", { _limit: limit ?? 20 }); if (error) return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult(); return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { messages: data ?? [] } }; },
});
