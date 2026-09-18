import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "get_forwarding_draft",
  title: "Review a forwarding draft",
  description: "Retrieve the signed-in customer's draft. Present every item, route, address, and CAD value before asking for confirmation.",
  inputSchema: { draft_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ draft_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).from("ai_forwarding_drafts")
      .select("id, status, version, draft_data, forwarding_id, request_no, updated_at, expires_at, confirmed_at")
      .eq("id", draft_id).single();
    if (error) {
      console.error("MCP get_forwarding_draft failed", { code: error.code });
      return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { currency: "CAD", draft: data } };
  },
});
