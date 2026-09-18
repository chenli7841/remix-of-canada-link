import { createFileRoute } from "@tanstack/react-router";
import {
  authenticateShipApi,
  requireIdempotencyKey,
  requireIfMatch,
  shipApiJson,
  shipApiOptions,
  ShipApiError,
  withShipApiHandler,
} from "@/lib/ship-api/auth.server";
import { claimIdempotencyKey, completeIdempotencyKey, computeFingerprint, releaseIdempotencyKey } from "@/lib/ship-api/idempotency.server";
import { assembleOrderResponse, resolvePartnerOrder } from "@/lib/ship-api/order-query.server";
import { deleteShipOrder, updateShipOrder } from "@/lib/ship-api/order-mutations.server";

const PATH_PREFIX = "/api/partners/v1/orders/by-domestic-number/";

/**
 * GET/PUT/DELETE /api/partners/v1/orders/by-domestic-number/{domesticNumber}
 *
 * 见 docs/ship-api/shipper-api-v3.md 第 6、7、8 节。
 */
export const Route = createFileRoute("/api/partners/v1/orders/by-domestic-number/$domesticNumber")({
  server: {
    handlers: {
      OPTIONS: async () => shipApiOptions(),

      GET: async ({ request, params }) =>
        withShipApiHandler(async () => {
          const auth = await authenticateShipApi(request, ["orders:read"]);
          const domesticNumber = decodeURIComponent(params.domesticNumber ?? "").trim();

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const admin = supabaseAdmin as any;

          const order = await resolvePartnerOrder(admin, auth.partnerKey, domesticNumber);
          const includeFees = auth.scopes.includes("orders:fees:read");
          const data = await assembleOrderResponse(admin, order, { includeFees });
          if (!includeFees) delete data.fees; // 普通凭证完全省略 fees 字段，不是 amount=null
          return shipApiJson(data);
        }),

      PUT: async ({ request, params }) =>
        withShipApiHandler(async () => {
          const auth = await authenticateShipApi(request, ["orders:write"]);
          const domesticNumber = decodeURIComponent(params.domesticNumber ?? "").trim();
          const idempotencyKey = requireIdempotencyKey(request);
          const ifMatch = requireIfMatch(request);

          let body: any;
          try {
            body = await request.json();
          } catch {
            throw new ShipApiError("INVALID_REQUEST", "请求体不是合法 JSON");
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const admin = supabaseAdmin as any;
          const fingerprint = computeFingerprint("PUT", `${PATH_PREFIX}${domesticNumber}`, ifMatch, body);
          const claim = await claimIdempotencyKey(admin, auth.partnerKey, idempotencyKey, fingerprint);
          if (claim.kind === "replay") return shipApiJson(claim.body, claim.status);

          try {
            const result = await updateShipOrder(admin, auth.partnerKey, domesticNumber, ifMatch, body);
            await completeIdempotencyKey(admin, auth.partnerKey, idempotencyKey, result.status, result.data);
            return shipApiJson(result.data, result.status);
          } catch (e) {
            await releaseIdempotencyKey(admin, auth.partnerKey, idempotencyKey);
            throw e;
          }
        }),

      DELETE: async ({ request, params }) =>
        withShipApiHandler(async () => {
          const auth = await authenticateShipApi(request, ["orders:write"]);
          const domesticNumber = decodeURIComponent(params.domesticNumber ?? "").trim();
          const idempotencyKey = requireIdempotencyKey(request);
          const ifMatch = requireIfMatch(request);

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const admin = supabaseAdmin as any;
          const fingerprint = computeFingerprint("DELETE", `${PATH_PREFIX}${domesticNumber}`, ifMatch, null);
          const claim = await claimIdempotencyKey(admin, auth.partnerKey, idempotencyKey, fingerprint);
          if (claim.kind === "replay") return shipApiJson(claim.body, claim.status);

          try {
            const result = await deleteShipOrder(admin, auth.partnerKey, domesticNumber, ifMatch);
            await completeIdempotencyKey(admin, auth.partnerKey, idempotencyKey, result.status, result.data);
            return shipApiJson(result.data, result.status);
          } catch (e) {
            await releaseIdempotencyKey(admin, auth.partnerKey, idempotencyKey);
            throw e;
          }
        }),
    },
  },
});
