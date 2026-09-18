import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "diagnose_my_pending_intake",
  title: "Diagnose my package pending intake",
  description: "Diagnose why a domestic package belonging to the OAuth-signed-in EPLUS customer has not entered the warehouse. Compares the customer's exact pending order, order-entry time, detained scan, first warehouse scan and similar customer-owned pending tracking numbers. Call this before answering any signed-but-not-intaked question. Never ask for or accept a customer code. Never claim a typo or offer a correction unless result_code is possible_tracking_typo and the returned candidate identifies the selected record.",
  inputSchema: {
    tracking_no: z.string().min(5).max(100).describe("Domestic carrier tracking number supplied by the customer."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ tracking_no }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_diagnose_my_pending_intake", { _tracking_no: tracking_no });
    if (error) return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { diagnosis: data } };
  },
});
