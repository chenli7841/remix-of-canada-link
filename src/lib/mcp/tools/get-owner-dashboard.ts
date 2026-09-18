import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "get_owner_dashboard",
  title: "Get EPLUS owner dashboard",
  description: "Read current EPLUS operational counts using the signed-in owner's permissions. It never changes data.",
  inputSchema: { include: z.literal("current_summary").optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_owner_dashboard");
    if (error) { console.error("MCP get_owner_dashboard failed", { code: error.code }); return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult(); }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { dashboard: data } };
  },
});
