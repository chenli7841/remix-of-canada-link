import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "confirm_forwarding_draft",
  title: "Confirm and create forwarding order",
  description:
    "Create the real forwarding order from the exact saved draft version the customer just reviewed, only after explicit confirmation of the final CAD summary. If the version changed, review again. Never call this tool merely to save or preview a draft.",
  inputSchema: {
    draft_id: z.string().uuid(),
    expected_version: z.number().int().positive().describe("Version returned by the immediately preceding get_forwarding_draft review."),
    confirmation: z.literal("CONFIRM").describe("Must be CONFIRM after the customer explicitly approves the final summary."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  handler: async ({ draft_id, expected_version }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("confirm_ai_forwarding_draft", { _draft_id: draft_id, _expected_version: expected_version });
    if (error) {
      console.error("MCP confirm_forwarding_draft failed", { code: error.code });
      return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { currency: "CAD", result: data },
    };
  },
});
