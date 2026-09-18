import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "search_forwardings_admin",
  title: "Search forwarding orders with staff permissions",
  description: "Search EPLUS forwarding orders across statuses using the signed-in account's normal staff permission. Read-only; all customer-facing money is CAD. When results exceed 5, summarize and ask the user to narrow the search instead of displaying all records.",
  inputSchema: {
    query: z.string().max(100).optional(),
    status: z.string().max(30).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_admin_search_forwardings", {
      _query: query ?? "", _status: status ?? null, _limit: limit ?? 20,
    });
    if (error) return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
