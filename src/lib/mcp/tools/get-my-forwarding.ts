import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  isPermissionError,
  permissionDeniedResult,
  queryFailedResult,
  supabaseForUser,
  unauthenticatedResult,
} from "../supabase-user";
import { forwardingTotalCad } from "../currency";

export default defineTool({
  name: "get_my_forwarding",
  title: "Get my forwarding order details",
  description: "Get one forwarding order belonging to the signed-in customer, including items and waybills. All money is returned in CAD. This tool cannot pay.",
  inputSchema: { forwarding_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ forwarding_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const sb = supabaseForUser(ctx);
    const { data: forwarding, error: forwardingError } = await sb
      .from("forwarding_orders")
      .select("id,request_no,status,payment_status,created_at,updated_at,domestic_tracking_no,intl_tracking_no,tracking_no,batch_no,box_no,pallet_no,company_code,destination_code,route_code,shipping_method,warehouse,weight_kg,actual_weight_kg,length_cm,width_cm,height_cm,box_count,declared_value_cad,insured,items_desc,note,eta,eta_label,fee_cny,freight_snapshot")
      .eq("id", forwarding_id)
      .maybeSingle();
    if (forwardingError) return isPermissionError(forwardingError) ? permissionDeniedResult() : queryFailedResult();
    if (!forwarding) return permissionDeniedResult();

    const [{ data: itemRows, error: itemError }, { data: waybillRows, error: waybillError }] = await Promise.all([
      sb.from("forwarding_items").select("id,name,quantity,hs_code,unit_price_cad,extras,created_at").eq("forwarding_id", forwarding_id).order("created_at"),
      sb.from("waybills").select("id,waybill_no,status,shipping_method,weight_kg,length_cm,width_cm,height_cm,eta,intl_tracking_no,batch_no,box_no,pallet_no,items_summary,freight_cad,duty_cad,clearance_cad,insurance_cad,surcharge_cad,created_at,updated_at").eq("forwarding_id", forwarding_id).order("created_at"),
    ]);
    const childError = itemError ?? waybillError;
    if (childError) return isPermissionError(childError) ? permissionDeniedResult() : queryFailedResult();

    const { fee_cny, freight_snapshot, ...safeForwarding } = forwarding;
    const result = {
      currency: "CAD",
      payment_available_here: false,
      forwarding: { ...safeForwarding, total_cad: forwardingTotalCad(fee_cny, freight_snapshot) },
      items: itemRows ?? [],
      waybills: waybillRows ?? [],
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
