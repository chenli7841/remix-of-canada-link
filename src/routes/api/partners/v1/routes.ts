import { createFileRoute } from "@tanstack/react-router";
import { authenticateShipApi, shipApiJson, shipApiOptions, withShipApiHandler } from "@/lib/ship-api/auth.server";
import { isRouteVisibleToShip, mapRouteSummary } from "@/lib/ship-api/routes.server";

/**
 * GET /api/partners/v1/routes
 *
 * 返回 ship 可用线路（不含价格）。见 docs/ship-api/shipper-api-v3.md 第 4 节。
 */
export const Route = createFileRoute("/api/partners/v1/routes")({
  server: {
    handlers: {
      OPTIONS: async () => shipApiOptions(),
      GET: async ({ request }) =>
        withShipApiHandler(async () => {
          await authenticateShipApi(request, ["routes:read"]);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: rows, error } = await (supabaseAdmin as any)
            .from("shipping_routes")
            .select(
              "code, name_zh, name_en, is_active, destination_code, shipping_method, cargo_type, origin_warehouse_id, item_fields, item_field_required, usage_scope, visible_vip_levels, blacklist_vip_levels, sort_order",
            )
            .order("sort_order", { ascending: true });
          if (error) throw error;

          const visible = ((rows ?? []) as any[]).filter(isRouteVisibleToShip);
          const warehouseIds = Array.from(new Set(visible.map((r) => r.origin_warehouse_id).filter(Boolean)));
          const whMap = new Map<string, string>();
          if (warehouseIds.length) {
            const { data: whs } = await supabaseAdmin.from("warehouses").select("id, code").in("id", warehouseIds);
            for (const w of (whs ?? []) as any[]) whMap.set(w.id, w.code);
          }

          const routes = visible.map((r) =>
            mapRouteSummary({ ...r, origin_warehouse_code: r.origin_warehouse_id ? (whMap.get(r.origin_warehouse_id) ?? null) : null }),
          );
          return shipApiJson({ routes });
        }),
    },
  },
});
