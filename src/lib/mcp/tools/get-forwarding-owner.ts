import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "get_forwarding_owner",
  title: "Get a forwarding order as owner",
  description: "Read one forwarding order using the signed-in owner's permissions. Use immediately before proposing any write action.",
  inputSchema: { request_no: z.string().min(1).max(100) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ request_no }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_owner_get_forwarding", { _request_no: request_no });
    if (error) { console.error("MCP get_forwarding_owner failed", { code: error.code }); return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult(); }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
