import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";
import { cnyToCad } from "../currency";

export default defineTool({
  name: "list_my_orders",
  title: "List my orders",
  description: "List the signed-in user's EPLUS shop orders with optional order-number, status and date filters. Returns a small page newest first; ask before loading more. All totals are CAD.",
  inputSchema: {
    order_no: z.string().max(100).optional(), status: z.string().max(30).optional(),
    date_from: z.string().date().optional(), date_to: z.string().date().optional(),
    offset: z.number().int().min(0).max(10000).optional(),
    limit: z.number().int().min(1).max(10).optional().describe("Page size (default 5)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ order_no, status, date_from, date_to, offset, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return unauthenticatedResult();
    }
    const pageSize=limit??5; const start=offset??0;
    let query = supabaseForUser(ctx)
      .from("orders")
      .select(
        "id, order_no, status, payment_status, total_cny, fx_rate, shipping_method, route_code, tracking_no, created_at",
      )
      .order("created_at", { ascending: false });
    if(order_no)query=query.ilike("order_no",`%${order_no}%`); if(status)query=query.eq("status",status as never);
    if(date_from)query=query.gte("created_at",`${date_from}T00:00:00.000Z`); if(date_to)query=query.lte("created_at",`${date_to}T23:59:59.999Z`);
    const {data,error}=await query.range(start,start+pageSize);
    if (error) {
      console.error("MCP list_my_orders failed", { code: error.code });
      return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    }
    const hasMore=(data?.length??0)>pageSize;
    const orders = (data ?? []).slice(0,pageSize).map(({ total_cny, fx_rate, ...order }) => ({
      ...order,
      total_cad: cnyToCad(total_cny, fx_rate),
    }));
    const result = { currency: "CAD", orders, page:{offset:start,limit:pageSize,has_more:hasMore,next_offset:hasMore?start+pageSize:null} };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
