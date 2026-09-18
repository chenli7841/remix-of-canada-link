import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "quote_forwarding_cad",
  title: "Quote forwarding in CAD",
  description:
    "Calculate an EPLUS forwarding estimate from the active database pricing rule after route, weight, required dimensions and declared CAD value are known. Never guess missing measurements. Every monetary value is CAD, never CNY/RMB.",
  inputSchema: {
    route_code: z.string().min(1),
    weight_kg: z.number().nonnegative(),
    volume_cm3: z.number().nonnegative().optional(),
    declared_value_cad: z.number().nonnegative().optional(),
    direction: z.enum(["forward", "reverse"]).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const sb = supabaseForUser(ctx);
    const { data, error } = await sb.rpc("quote_forwarding_cad", {
      _route_code: input.route_code,
      _weight_kg: input.weight_kg,
      _volume_cm3: input.volume_cm3 ?? 0,
      _declared_cad: input.declared_value_cad ?? 0,
      _direction: input.direction ?? "forward",
    });
    if (error) {
      console.error("MCP quote_forwarding_cad failed", { code: error.code });
      return isPermissionError(error) ? permissionDeniedResult() : queryFailedResult();
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { quote: data },
    };
  },
});
