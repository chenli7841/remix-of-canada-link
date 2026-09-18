import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import {
  isPermissionError,
  permissionDeniedResult,
  queryFailedResult,
  supabaseForUser,
  unauthenticatedResult,
} from "../supabase-user";
import { cnyToCad } from "../currency";

export default defineTool({
  name: "get_my_order",
  title: "Get my shop order details",
  description: "Get one shop order belonging to the signed-in customer, including items and waybills. All money is returned in CAD. This tool cannot pay.",
  inputSchema: { order_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ order_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const sb = supabaseForUser(ctx);
    const { data: order, error: orderError } = await sb
      .from("orders")
      .select("id,order_no,status,payment_status,created_at,shipping_method,tracking_no,domestic_tracking_no,intl_tracking_no,batch_no,eta,address_snapshot,note,customer_code,destination_code,route_code,company_code,box_no,pallet_no,box_count,subtotal_cny,shipping_cny,insurance_cny,customs_cny,total_cny,fx_rate")
      .eq("id", order_id)
      .maybeSingle();
    if (orderError) return isPermissionError(orderError) ? permissionDeniedResult() : queryFailedResult();
    if (!order) return permissionDeniedResult();

    const [{ data: itemRows, error: itemError }, { data: waybillRows, error: waybillError }] = await Promise.all([
      sb.from("order_items").select("id,name_zh,name_en,sku,quantity,paid,subtotal_cny,unit_price_cny,waybill_id").eq("order_id", order_id).order("created_at"),
      sb.from("waybills").select("id,waybill_no,status,shipping_method,weight_kg,length_cm,width_cm,height_cm,eta,intl_tracking_no,batch_no,box_no,pallet_no,items_summary,freight_cad,duty_cad,clearance_cad,insurance_cad,surcharge_cad,created_at,updated_at").eq("order_id", order_id).order("created_at"),
    ]);
    const childError = itemError ?? waybillError;
    if (childError) return isPermissionError(childError) ? permissionDeniedResult() : queryFailedResult();

    const cad = (value: unknown) => cnyToCad(value, order.fx_rate);
    const { subtotal_cny, shipping_cny, insurance_cny, customs_cny, total_cny, fx_rate, ...safeOrder } = order;
    const items = (itemRows ?? []).map(({ subtotal_cny: subtotal, unit_price_cny: unitPrice, ...item }) => ({
      ...item,
      unit_price_cad: cad(unitPrice),
      subtotal_cad: cad(subtotal),
    }));
    const result = {
      currency: "CAD",
      payment_available_here: false,
      order: {
        ...safeOrder,
        subtotal_cad: cad(subtotal_cny),
        shipping_cad: cad(shipping_cny),
        insurance_cad: cad(insurance_cny),
        customs_cad: cad(customs_cny),
        total_cad: cad(total_cny),
      },
      items,
      waybills: waybillRows ?? [],
    };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
