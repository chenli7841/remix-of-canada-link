import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "get_customer_admin",
  title: "Get customer details with staff permissions",
  description: "Read one EPLUS customer's profile (including phone and email), account counts, CAD wallet balance and recent business records using the signed-in account's server-verified staff permission. Use after a customer code has been uniquely identified. Return only the field requested when the user asks for one detail. This tool cannot pay or deduct funds.",
  inputSchema: { customer_code: z.string().min(1).max(50) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ customer_code }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_admin_get_customer", { _customer_code: customer_code });
    if (error) return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
