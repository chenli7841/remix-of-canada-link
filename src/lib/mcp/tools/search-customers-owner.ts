import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "search_customers_owner",
  title: "Search EPLUS customers as owner",
  description: "Owner only, enforced by the server. Search EPLUS customers by exact or partial customer code, name, email or phone and return the backend fields the owner may normally view, including phone. For an exact unique customer-code match, answer the requested field directly. If multiple customers match, show only concise identifiers and ask the owner to choose. Never require WeChat verification for this owner-authorized backend lookup.",
  inputSchema: { query: z.string().max(100).optional(), limit: z.number().int().min(1).max(50).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_owner_search_customers", { _query: query ?? "", _limit: limit ?? 20 });
    if (error) { console.error("MCP search_customers_owner failed", { code: error.code }); return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult(); }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
