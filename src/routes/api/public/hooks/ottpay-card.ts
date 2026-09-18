import { createFileRoute } from "@tanstack/react-router";

// OTT Pay callback for Elavon Converge Hosted Payment (credit card).
// Payload: { rsp_code, rsp_msg, merchant_id, data (AES-128-ECB base64), md5 }
export const Route = createFileRoute("/api/public/hooks/ottpay-card")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { decryptHosted, hostedMd5Matches, HOSTED_PAID_STATES, HOSTED_FAILED_STATES } = await import(
          "@/lib/ottpay-hosted.server"
        );
        const supabaseAdmin = ((await import("@/integrations/supabase/client.server")).supabaseAdmin) as any;

        let payload: any;
        try {
          payload = await request.json();
        } catch {
          const form = await request.formData().catch(() => null);
          payload = form ? Object.fromEntries(form.entries()) : null;
        }
        if (!payload?.data || !payload?.md5) return new Response("bad payload", { status: 400 });

        let info: Record<string, any>;
        try {
          info = decryptHosted({ data: String(payload.data), md5: String(payload.md5) });
        } catch (e: any) {
          console.error("[ottpay-card] decrypt failed", e?.message);
          return new Response("invalid signature", { status: 401 });
        }

        // Pin the decrypted body to the signKey-derived md5 so a captured
        // genuine (data, md5) pair can't be replayed with a tampered envelope.
        if (!hostedMd5Matches(String(payload.md5), info)) {
          console.error("[ottpay-card] md5 mismatch — rejecting callback", info.order_id ?? info.orderId);
          return new Response("invalid signature", { status: 401 });
        }

        const reference: string | undefined = info.order_id ?? info.orderId;
        if (!reference) return new Response("SUCCESS");

        const { data: tx } = await supabaseAdmin
          .from("wallet_transactions")
          .select("id, status, amount_cad, provider_payment_id")
          .eq("ref_no", reference)
          .maybeSingle();
        if (!tx) return new Response("SUCCESS");
        if (tx.status === "completed") return new Response("SUCCESS"); // idempotent

        // Money decision comes from the AES-encrypted (signKey-derived) payload,
        // never from the outer plaintext rsp_code/rsp_msg — those aren't signed
        // or encrypted (see the Payload comment above), so a client that has ever
        // captured one genuine encrypted callback for their own reference could
        // otherwise replay it with rsp_code swapped to "SUCCESS" and self-credit
        // their wallet without actually paying. rsp_code is only used below as a
        // non-authoritative hint for logging.
        const st = String(info.order_status ?? info.orderStatus ?? "").toLowerCase();
        const paid = HOSTED_PAID_STATES.has(st);
        const failed = HOSTED_FAILED_STATES.has(st);
        if (!paid && !failed) {
          // Inconclusive decrypted status (includes "processing" and anything
          // unrecognized) — don't guess. Leave the transaction pending; the
          // client's post-redirect syncOttTopup() poll (STATUS_QUERY, also
          // authenticated) is what actually resolves it.
          console.warn("[ottpay-card] inconclusive status, leaving pending", reference, {
            order_status: st,
            rsp_code: payload.rsp_code,
          });
          return new Response("SUCCESS");
        }

        const cents = Number(info.amount ?? 0);
        if (paid && !cents) {
          // Paid but the decrypted payload didn't include an amount to verify
          // against — treat as suspicious rather than silently trusting it.
          console.error("[ottpay-card] paid callback missing amount, leaving pending", reference);
          return new Response("SUCCESS");
        }
        if (paid && Math.abs(cents / 100 - Number(tx.amount_cad)) > 0.01) {
          console.error("[ottpay-card] amount mismatch", reference, cents, tx.amount_cad);
          return new Response("SUCCESS");
        }

        const patch: Record<string, any> = {
          status: paid ? "completed" : "failed",
          verified_at: new Date().toISOString(),
        };
        if (info.bizpay_order_id && !tx.provider_payment_id) {
          patch.provider_payment_id = String(info.bizpay_order_id);
        }
        await supabaseAdmin
          .from("wallet_transactions")
          .update(patch as any)
          .eq("id", tx.id)
          .eq("status", "pending");

        return new Response("SUCCESS");
      },
    },
  },
});
