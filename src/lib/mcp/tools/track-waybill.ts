import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "track_waybill",
  title: "Track a waybill",
  description: "Look up a SinoCargo waybill by its waybill number. Access is scoped by RLS to waybills the signed-in user owns.",
  inputSchema: {
    waybill_no: z.string().trim().min(1).describe("Waybill number, e.g. SC240101ABC."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ waybill_no }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return unauthenticatedResult();
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("waybills")
      .select(
        "id, waybill_no, status, intl_tracking_no, shipping_method, eta, payment_status, freight_cad, insurance_cad, clearance_cad, duty_cad, surcharge_cad, created_at, updated_at",
      )
      .eq("waybill_no", waybill_no)
      .maybeSingle();
    if (error) {
      console.error("MCP track_waybill failed", { code: error.code });
      return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    }
    if (!data) return { content: [{ type: "text", text: "Waybill not found or not accessible." }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { waybill: data },
    };
  },
});
