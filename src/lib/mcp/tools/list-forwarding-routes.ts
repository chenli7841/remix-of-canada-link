import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { isPermissionError, permissionDeniedResult, queryFailedResult, supabaseForUser, unauthenticatedResult } from "../supabase-user";

export default defineTool({
  name: "list_forwarding_routes",
  title: "List available forwarding routes",
  description:
    "List only YW-origin forwarding routes currently allowed for the signed-in EPLUS customer after customer-code and VIP visibility rules. Each result may include route-specific allowed_items_text and prohibited_items_text. Use only that route's returned cargo guidance; never transfer rules from another route or invent guidance when a field is empty. Present these returned options and ask the customer to choose one; never offer or accept a route that is absent from this result. Monetary pricing is always CAD.",
  inputSchema: {
    direction: z.enum(["forward", "reverse"]).optional().describe("Route direction; defaults to forward."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ direction }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticatedResult();
    const sb = supabaseForUser(ctx);
    const { data: authData, error: authError } = await sb.auth.getUser();
    if (authError || !authData.user) return unauthenticatedResult();
    const { data: warehouse, error: warehouseError } = await sb
      .from("warehouses")
      .select("id, code")
      .eq("code", "YW")
      .eq("is_active", true)
      .single();
    if (warehouseError || !warehouse) {
      console.error("MCP list_forwarding_routes warehouse lookup failed", { code: warehouseError?.code });
      return warehouseError && isPermissionError(warehouseError) ? permissionDeniedResult() : queryFailedResult();
    }
    const [{ data: profile, error: profileError }, { data, error }] = await Promise.all([
      sb.from("profiles").select("customer_code, vip_level").eq("id", authData.user.id).single(),
      sb
      .from("shipping_routes")
      .select(
        "id, code, name_zh, name_en, shipping_method, cargo_type, destination_code, transit_days_min, transit_days_max, item_field_required, allowed_items_text, prohibited_items_text, usage_scope, is_bidirectional, visible_vip_levels, visible_customer_codes, blacklist_vip_levels, blacklist_customer_codes",
      )
      .eq("is_active", true)
      .eq("origin_warehouse_id", warehouse.id)
      .in("usage_scope", ["forwarding", "both"])
      .order("sort_order", { ascending: true }),
    ]);
    if (profileError || error) {
      console.error("MCP list_forwarding_routes failed", { code: (profileError ?? error)?.code });
      const failure = profileError ?? error;
      return failure && isPermissionError(failure) ? permissionDeniedResult() : queryFailedResult();
    }
    const customerCode = String(profile?.customer_code ?? "").trim().toUpperCase();
    const vip = String(profile?.vip_level ?? "");
    const routes = (data ?? []).filter((route: any) => {
      if ((direction ?? "forward") === "reverse" && !route.is_bidirectional) return false;
      const blackCodes = (route.blacklist_customer_codes ?? []).map((code: unknown) => String(code).trim().toUpperCase());
      if (customerCode && blackCodes.includes(customerCode)) return false;
      if (vip && (route.blacklist_vip_levels ?? []).includes(vip)) return false;
      const visibleCodes = (route.visible_customer_codes ?? []).map((code: unknown) => String(code).trim().toUpperCase());
      const visibleVips = route.visible_vip_levels ?? [];
      if (!visibleCodes.length && !visibleVips.length) return true;
      return (customerCode && visibleCodes.includes(customerCode)) || (vip && visibleVips.includes(vip));
    }).map(({ usage_scope, is_bidirectional, visible_vip_levels, visible_customer_codes, blacklist_vip_levels, blacklist_customer_codes, ...route }: any) => route);
    return {
      content: [{ type: "text", text: JSON.stringify({ currency: "CAD", warehouse: warehouse.code, direction: direction ?? "forward", routes }, null, 2) }],
      structuredContent: { currency: "CAD", warehouse: warehouse.code, direction: direction ?? "forward", routes },
    };
  },
});
