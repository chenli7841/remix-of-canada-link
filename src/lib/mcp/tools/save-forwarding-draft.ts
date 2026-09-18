import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

const itemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unit_price_cad: z.number().nonnegative().describe("Declared unit value in CAD."),
  extras: z.record(z.string(), z.unknown()).optional(),
});

export default defineTool({
  name: "save_forwarding_draft",
  title: "Save a forwarding draft",
  description:
    "Create or update the OAuth-signed-in customer's forwarding draft. Never accept a customer code from chat. Use warehouse YW automatically. If address_id is omitted, this tool automatically uses the signed-in customer's default saved address; do not ask them to retype recipient name, address or phone. route_code must come from list_forwarding_routes. This does not create an order. All item values must be CAD; never convert or relabel them as yuan. For fields derived from media or speech, show the structured draft and obtain explicit confirmation before saving; never guess unreadable values.",
  inputSchema: {
    draft_id: z.string().uuid().optional(),
    route_code: z.string().min(1),
    warehouse: z.literal("YW").optional().describe("Optional; always defaults to the YW warehouse."),
    domestic_tracking_no: z.string().optional(),
    address_id: z.string().uuid().optional(),
    cargo_type: z.string().optional(),
    insured: z.boolean().optional(),
    note: z.string().max(1000).optional(),
    items: z.array(itemSchema).min(1),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ draft_id, ...draftData }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const sb = supabaseForUser(ctx);
    let addressId = draftData.address_id;
    if (!addressId) {
      const { data: defaultAddress, error: addressError } = await sb
        .from("addresses")
        .select("id")
        .eq("is_default", true)
        .limit(1)
        .maybeSingle();
      if (addressError) {
        console.error("MCP save_forwarding_draft default address lookup failed", { code: addressError.code });
        return isPermissionError(addressError) ? permissionDeniedResult() : queryFailedResult();
      }
      if (!defaultAddress) {
        return {
          content: [{ type: "text", text: "No default EPLUS delivery address is configured. Ask the customer to create or select a saved address before saving the draft." }],
          structuredContent: { order_created: false, draft_saved: false, reason: "default_address_required" },
          isError: true,
        };
      }
      addressId = defaultAddress.id;
    }
    const payload = { ...draftData, warehouse: "YW", address_id: addressId, currency: "CAD" };
    const query = draft_id
      ? sb
          .from("ai_forwarding_drafts")
          .update({ draft_data: payload })
          .eq("id", draft_id)
          .eq("status", "active")
          .select("id, status, version, draft_data, updated_at, expires_at")
          .single()
      : sb
          .from("ai_forwarding_drafts")
          .insert({ draft_data: payload })
          .select("id, status, version, draft_data, updated_at, expires_at")
          .single();
    const { data, error } = await query;
    if (error) {
      console.error("MCP save_forwarding_draft failed", { code: error.code });
      return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    }
    return {
      content: [{ type: "text", text: `Draft saved. No order has been created.\n${JSON.stringify(data, null, 2)}` }],
      structuredContent: { currency: "CAD", order_created: false, draft: data },
    };
  },
});
