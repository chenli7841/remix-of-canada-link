import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "correct_my_pending_tracking",
  title: "Correct my pending domestic tracking number",
  description: "Correct a domestic tracking number only for the OAuth-signed-in customer's own pending-intake order. First call diagnose_my_pending_intake, show the exact EPLUS order number, current number and detained number, and ask whether the customer authorizes that exact change. Call only after an explicit yes in the current conversation. The server requires an active detained number, checks the current value and status, rejects duplicates, and writes an audit log. This does not intake or release the package.",
  inputSchema: {
    order_type: z.enum(["forwarding", "order"]),
    record_id: z.string().uuid(),
    expected_tracking_no: z.string().min(5).max(100),
    new_tracking_no: z.string().min(5).max(100),
    reason: z.string().min(2).max(500),
    confirmation: z.literal("CONFIRM_CORRECT_PENDING_TRACKING"),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_correct_my_pending_tracking", {
      _order_type: input.order_type,
      _record_id: input.record_id,
      _expected_tracking_no: input.expected_tracking_no,
      _new_tracking_no: input.new_tracking_no,
      _reason: input.reason,
      _confirmation: input.confirmation,
    });
    if (error) return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
