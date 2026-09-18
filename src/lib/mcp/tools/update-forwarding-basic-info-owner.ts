import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "update_forwarding_basic_info_owner",
  title: "Update forwarding basic information as owner",
  description: "Owner-only mapping of the existing EPLUS admin basic-info edit. Review the latest order and obtain explicit confirmation first.",
  inputSchema: {
    request_no: z.string().min(1).max(100), expected_updated_at: z.string().datetime(),
    patch: z.object({ warehouse: z.string().max(100).optional(), shipping_method: z.string().max(100).optional(),
      destination_code: z.string().max(100).optional(), domestic_tracking_no: z.string().max(200).optional(), intl_tracking_no: z.string().max(200).optional() }),
    reason: z.string().min(2).max(500), confirmation: z.literal("CONFIRM_UPDATE_FORWARDING"),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const { data, error } = await supabaseForUser(ctx).rpc("chatgpt_owner_update_forwarding_basic_info", {
      _request_no: input.request_no, _expected_updated_at: input.expected_updated_at, _patch: input.patch,
      _reason: input.reason, _confirmation: input.confirmation,
    });
    if (error) { console.error("MCP update_forwarding_basic_info_owner failed", { code: error.code }); return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult(); }
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: { result: data } };
  },
});
