import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";
import { forwardingTotalCad } from "../currency";

export default defineTool({
  name: "list_my_forwardings",
  title: "List my forwarding orders",
  description: "List and count forwarding orders belonging to the currently signed-in EPLUS account. OAuth already identifies and scopes the customer: call this tool directly for requests such as '我的运单/集运单' or '我有多少运单', and never ask for a customer code, phone number, WeChat ID, or another identity value. Filters are optional; an unqualified count means all of the signed-in user's forwarding orders. Returns total_count plus a small page; ask before loading more. All money is CAD.",
  inputSchema: {
    request_no: z.string().max(100).optional(), status: z.string().max(30).optional(),
    date_from: z.string().date().optional(), date_to: z.string().date().optional(),
    offset: z.number().int().min(0).max(10000).optional(), limit: z.number().int().min(1).max(10).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ request_no, status, date_from, date_to, offset, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return unauthenticatedResult();
    }
    const pageSize=limit??5; const start=offset??0; let query=supabaseForUser(ctx)
      .from("forwarding_orders")
      .select(
        "id, request_no, domestic_tracking_no, intl_tracking_no, status, payment_status, shipping_method, route_code, fee_cny, freight_snapshot, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false });
    if(request_no)query=query.ilike("request_no",`%${request_no}%`); if(status)query=query.eq("status",status as never);
    if(date_from)query=query.gte("created_at",`${date_from}T00:00:00.000Z`); if(date_to)query=query.lte("created_at",`${date_to}T23:59:59.999Z`);
    const{data,error,count}=await query.range(start,start+pageSize);
    if (error) {
      console.error("MCP list_my_forwardings failed", { code: error.code });
      return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    }
    const hasMore=(data?.length??0)>pageSize;
    const forwardings = (data ?? []).slice(0,pageSize).map(({ fee_cny, freight_snapshot, ...order }) => {
      return { ...order, total_cad: forwardingTotalCad(fee_cny, freight_snapshot) };
    });
    const result = { currency: "CAD", total_count: count ?? forwardings.length, forwardings, page:{offset:start,limit:pageSize,has_more:hasMore,next_offset:hasMore?start+pageSize:null} };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
