import { createFileRoute } from "@tanstack/react-router";
import {
  authenticateShipApi,
  requireIdempotencyKey,
  shipApiJson,
  shipApiOptions,
  ShipApiError,
  withShipApiHandler,
} from "@/lib/ship-api/auth.server";
import { claimIdempotencyKey, completeIdempotencyKey, computeFingerprint, releaseIdempotencyKey } from "@/lib/ship-api/idempotency.server";
import { createShipOrder } from "@/lib/ship-api/orders.server";

/**
 * POST /api/partners/v1/orders
 *
 * 录单并返回号码和打印数据。见 docs/ship-api/shipper-api-v3.md 第 5、5.1 节。
 */
export const Route = createFileRoute("/api/partners/v1/orders")({
  server: {
    handlers: {
      OPTIONS: async () => shipApiOptions(),
      POST: async ({ request }) =>
        withShipApiHandler(async () => {
          const auth = await authenticateShipApi(request, ["orders:write"]);
          const idempotencyKey = requireIdempotencyKey(request);

          let body: any;
          try {
            body = await request.json();
          } catch {
            throw new ShipApiError("INVALID_REQUEST", "请求体不是合法 JSON");
          }

          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const admin = supabaseAdmin as any;
          const fingerprint = computeFingerprint("POST", "/api/partners/v1/orders", null, body);
          const claim = await claimIdempotencyKey(admin, auth.partnerKey, idempotencyKey, fingerprint);
          if (claim.kind === "replay") {
            const data = claim.body && typeof claim.body === "object" ? { ...(claim.body as any), replayed: true } : claim.body;
            return shipApiJson(data, claim.status);
          }

          try {
            const result = await createShipOrder(admin, auth.partnerKey, body);
            await completeIdempotencyKey(admin, auth.partnerKey, idempotencyKey, result.status, result.data);
            return shipApiJson(result.data, result.status);
          } catch (e) {
            // 幂等占位记录只在"这次真的失败了"时删除，让同 key 同内容的重试有机会重新
            // 尝试；已经在业务层判定为"重放成功"的情况不会走到这个 catch。
            await releaseIdempotencyKey(admin, auth.partnerKey, idempotencyKey);
            throw e;
          }
        }),
    },
  },
});
