import { createFileRoute } from "@tanstack/react-router";
import {
  authenticateShipApi,
  shipApiJson,
  shipApiOptions,
  withShipApiHandler,
  ShipApiError,
} from "@/lib/ship-api/auth.server";
import { buildItemFields, computeSchemaVersion, isRouteVisibleToShip } from "@/lib/ship-api/routes.server";

/**
 * GET /api/partners/v1/routes/{routeCode}/order-schema
 *
 * 返回这条线路的录单要求。见 docs/ship-api/shipper-api-v3.md 第 4、5.1 节。
 */
export const Route = createFileRoute("/api/partners/v1/routes/$routeCode/order-schema")({
  server: {
    handlers: {
      OPTIONS: async () => shipApiOptions(),
      GET: async ({ request, params }) =>
        withShipApiHandler(async () => {
          await authenticateShipApi(request, ["routes:read"]);
          const routeCode = decodeURIComponent(params.routeCode ?? "").trim();
          if (!routeCode) throw new ShipApiError("ROUTE_NOT_FOUND", "线路不存在");

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: route, error } = await (supabaseAdmin as any)
            .from("shipping_routes")
            .select(
              "code, is_active, usage_scope, item_fields, item_field_required, origin_warehouse_id, cargo_type, shipping_method, destination_code, visible_vip_levels, blacklist_vip_levels",
            )
            .eq("code", routeCode)
            .maybeSingle();
          if (error) throw error;
          // 线路不存在，或存在但没对 ship 开放，一律 404——不区分这两种情况，避免把
          // "有哪些线路代号存在"暴露给未授权访问。
          if (!route || !isRouteVisibleToShip(route)) throw new ShipApiError("ROUTE_NOT_FOUND", "线路不存在");

          return shipApiJson({
            routeCode: route.code,
            schemaVersion: computeSchemaVersion(route),
            fields: buildItemFields(route),
          });
        }),
    },
  },
});
