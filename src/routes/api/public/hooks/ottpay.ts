import { createFileRoute } from "@tanstack/react-router";

// OTT Pay asynchronous payment notification.
// Payload: { data (AES-128-ECB, base64), md5, merchant_id, rsp_code, rsp_msg }
export const Route = createFileRoute("/api/public/hooks/ottpay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { decryptOttCallback, ottCallbackMd5Matches, OTT_SUCCESS_STATES, OTT_FAILED_STATES } = await import("@/lib/ottpay.server");
        const supabaseAdmin = ((await import("@/integrations/supabase/client.server")).supabaseAdmin) as any;

        let payload: any;
        try {
          payload = await request.clone().json();
        } catch {
          const form = await request.formData().catch(() => null);
          payload = form ? Object.fromEntries(form.entries()) : null;
        }
        if (!payload?.data || !payload?.md5) return new Response("bad payload", { status: 400 });

        let info: Record<string, any>;
        try {
          info = decryptOttCallback({ data: String(payload.data), md5: String(payload.md5) });
        } catch (e: any) {
          console.error("[ottpay] decrypt failed", e?.message);
          return new Response("invalid signature", { status: 401 });
        }

        // Pin the decrypted body to the signKey-derived md5 (replay / tamper guard).
        if (!ottCallbackMd5Matches(String(payload.md5), info)) {
          console.error("[ottpay] md5 mismatch — rejecting callback", info.reference ?? info.remarks);
          return new Response("invalid signature", { status: 401 });
        }

        const reference: string | undefined = info.reference || info.remarks;
        if (!reference) return new Response("SUCCESS");

        const { data: tx, error: readError } = await supabaseAdmin
          .from("wallet_transactions")
          .select("id, status, amount_cad, provider_payment_id")
          .eq("ref_no", reference)
          .maybeSingle();
        // Allow a retry if the database is unavailable or the local insert is still in flight.
        if (readError || !tx) return new Response("transaction unavailable", { status: 503 });
        if (tx.status === "completed") return new Response("SUCCESS"); // idempotent

        // Only a captured/successful payment credits the wallet. Authorization,
        // processing, and missing/unknown statuses remain pending for verification.
        const status = String(info.order_status ?? "").toLowerCase();
        const paid = OTT_SUCCESS_STATES.has(status);
        const failed = OTT_FAILED_STATES.has(status);
        if (!paid && !failed) {
          console.warn("[ottpay] inconclusive status, leaving pending", reference);
          return new Response("SUCCESS");
        }
        const cents = Number(info.amount ?? 0);
        if (paid && (!Number.isSafeInteger(cents) || cents <= 0)) {
          console.error("[ottpay] paid callback missing amount, leaving pending", reference);
          return new Response("SUCCESS");
        }
        if (paid && (!Number.isFinite(Number(tx.amount_cad)) || cents !== Math.round(Number(tx.amount_cad) * 100))) {
          console.error("[ottpay] amount mismatch", reference, cents, tx.amount_cad);
          return new Response("SUCCESS");
        }

        const patch: Record<string, any> = {
          status: paid ? "completed" : "failed",
          verified_at: new Date().toISOString(),
        };
        if (info.order_id && !tx.provider_payment_id) patch.provider_payment_id = String(info.order_id);
        // 只改还在 pending 的行——已被对账/客户端 poll 处理过的不再翻，触发器也只加一次余额
        const { error: updateError } = await supabaseAdmin
          .from("wallet_transactions")
          .update(patch as any)
          .eq("id", tx.id)
          .eq("status", "pending");
        if (updateError) return new Response("database update failed", { status: 503 });

        return new Response("SUCCESS");
      },
    },
  },
});
