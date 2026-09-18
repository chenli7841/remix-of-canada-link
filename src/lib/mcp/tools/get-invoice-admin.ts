import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "get_invoice_admin",
  title: "Get invoice details with staff permissions",
  description: "Read one EPLUS invoice, customer and line items using the signed-in account's normal staff permission. Read-only; all money is CAD. This tool cannot pay, refund, deduct funds, or change payment status.",
  inputSchema: { invoice_no: z.string().min(1).max(100) },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ invoice_no }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_admin_get_invoice", { _invoice_no: invoice_no });
    if (error) return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
