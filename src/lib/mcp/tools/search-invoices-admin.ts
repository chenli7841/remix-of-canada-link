import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "search_invoices_admin",
  title: "Search invoices with staff permissions",
  description: "Search EPLUS invoices using the signed-in account's normal staff permission. Read-only; all money is CAD. This tool cannot pay, refund, deduct funds, or change payment status.",
  inputSchema: {
    query: z.string().max(100).optional(),
    status: z.enum(["unpaid", "paid", "overdue", "void"]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ query, status, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_admin_search_invoices", {
      _query: query ?? "", _status: status ?? null, _limit: limit ?? 20,
    });
    if (error) return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
