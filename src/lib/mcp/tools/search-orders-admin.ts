import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "search_orders_admin",
  title: "Search shop orders with staff permissions",
  description: "Search EPLUS shop orders using the signed-in account's normal staff permission. Read-only; all totals are CAD.",
  inputSchema: { query: z.string().max(100).optional(), limit: z.number().int().min(1).max(50).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_admin_search_orders", { _query: query ?? "", _limit: limit ?? 20 });
    if (error) return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
