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
import { updateShipCustomerProfile } from "@/lib/ship-api/customer-profile.server";

/**
 * PUT /api/partners/v1/customers/{externalCustomerId}/profile
 *
 * 显式更新已建立的客户资料。见 docs/ship-api/shipper-api-v3.md 第 9 节。
 */
export const Route = createFileRoute("/api/partners/v1/customers/$externalCustomerId/profile")({
  server: {
    handlers: {
      OPTIONS: async () => shipApiOptions(),
      PUT: async ({ request, params }) =>
        withShipApiHandler(async () => {
          const auth = await authenticateShipApi(request, ["customers:write"]);
          const externalCustomerId = decodeURIComponent(params.externalCustomerId ?? "").trim();
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
          const fingerprint = computeFingerprint(
            "PUT",
            `/api/partners/v1/customers/${externalCustomerId}/profile`,
            ifMatch,
            body,
          );
          const claim = await claimIdempotencyKey(admin, auth.partnerKey, idempotencyKey, fingerprint);
          if (claim.kind === "replay") return shipApiJson(claim.body, claim.status);

          try {
            const result = await updateShipCustomerProfile(admin, auth.partnerKey, externalCustomerId, ifMatch, body);
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
