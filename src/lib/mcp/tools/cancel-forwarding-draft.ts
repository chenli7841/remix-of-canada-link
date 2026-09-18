import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "cancel_forwarding_draft",
  title: "Cancel a forwarding draft",
  description: "Cancel the signed-in customer's active forwarding draft only after explicit confirmation. This never cancels an already-created order.",
  inputSchema: {
    draft_id: z.string().uuid(),
    confirmation: z.literal("CONFIRM_CANCEL_DRAFT"),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
  handler: async ({ draft_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("cancel_ai_forwarding_draft", { _draft_id: draft_id });
    if (error) {
      console.error("MCP cancel_forwarding_draft failed", { code: error.code });
      return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
