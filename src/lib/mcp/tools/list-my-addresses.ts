import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "list_my_addresses",
  title: "List my delivery addresses",
  description: "List the signed-in customer's own saved EPLUS delivery addresses, with the default address first. When creating a forwarding draft, call this automatically and use the row with is_default=true for recipient name, phone and address; do not ask the customer to retype those fields. Ask the customer only if no default address exists or they explicitly want another saved address.",
  inputSchema: { destination_code: z.string().optional(), offset:z.number().int().min(0).max(10000).optional(), limit:z.number().int().min(1).max(10).optional() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ destination_code, offset, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    let query = supabaseForUser(ctx)
      .from("addresses")
      .select("id, recipient, phone, line1, line2, city, province, postal_code, country, destination_code, is_default")
      .order("is_default", { ascending: false });
    if (destination_code) query = query.eq("destination_code", destination_code);
    const pageSize=limit??5,start=offset??0; const { data, error } = await query.range(start,start+pageSize);
    if (error) {
      console.error("MCP list_my_addresses failed", { code: error.code });
      return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    }
    const hasMore=(data?.length??0)>pageSize; const result={addresses:(data??[]).slice(0,pageSize),page:{offset:start,limit:pageSize,has_more:hasMore,next_offset:hasMore?start+pageSize:null}};
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result };
  },
});
