import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "list_pending_forwardings_owner",
  title: "List pending EPLUS forwardings as owner",
  description: "Read pending or unpaid forwarding orders using the signed-in owner's permissions. Monetary values are CAD.",
  inputSchema: { limit: z.number().int().min(1).max(50).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_owner_pending_forwardings", { _limit: limit ?? 20 });
    if (error) { console.error("MCP list_pending_forwardings_owner failed", { code: error.code }); return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult(); }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
