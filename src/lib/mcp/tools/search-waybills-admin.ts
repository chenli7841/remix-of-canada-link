import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "search_waybills_admin",
  title: "Search waybills with staff permissions",
  description: "Search EPLUS waybills by tracking number, customer, shop order or forwarding request using the signed-in account's normal staff permission. Read-only and CAD-only. When results exceed 5, summarize and ask the user to narrow the search.",
  inputSchema: {
    query: z.string().max(100).optional(),
    status: z.string().max(30).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_admin_search_waybills", {
      _query: query ?? "", _status: status ?? null, _limit: limit ?? 20,
    });
    if (error) return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
