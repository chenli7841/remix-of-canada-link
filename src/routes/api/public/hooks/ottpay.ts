import { createFileRoute } from "@tanstack/react-router";

// OTT Pay asynchronous payment notification.
// Payload: { data (AES-128-ECB, base64), md5, merchant_id, rsp_code, rsp_msg }
export const Route = createFileRoute("/api/public/hooks/ottpay")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { decryptOttCallback, ottCallbackMd5Matches, OTT_SUCCESS_STATES } = await import("@/lib/ottpay.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

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

        const { data: tx } = await supabaseAdmin
          .from("wallet_transactions")
          .select("id, status, amount_cad, note")
          .eq("ref_no", reference)
          .maybeSingle();
        if (!tx) return new Response("SUCCESS");
        if (tx.status === "completed") return new Response("SUCCESS"); // idempotent

        // order_status is a real field on the decrypted (signKey-verified)
        // callback data per OTT Pay's integration docs (example values
        // "authorised"/"captured" — same strings OTT_SUCCESS_STATES already
        // matches), not something wallet callbacks omit. A callback that's
        // missing or has an unrecognized status is anomalous — treat it as
        // still-pending rather than defaulting to paid.
        const status = String(info.order_status ?? "").toLowerCase();
        if (!status) {
          console.warn("[ottpay] callback missing order_status, leaving pending", reference);
          return new Response("SUCCESS");
        }
        const paid = OTT_SUCCESS_STATES.has(status);
        const cents = Number(info.amount ?? 0);
        if (paid && !cents) {
          console.error("[ottpay] paid callback missing amount, leaving pending", reference);
          return new Response("SUCCESS");
        }
        if (paid && Math.abs(cents / 100 - Number(tx.amount_cad)) > 0.01) {
          console.error("[ottpay] amount mismatch", reference, cents, tx.amount_cad);
          return new Response("SUCCESS");
        }

        const patch: Record<string, any> = { status: paid ? "completed" : "failed" };
        if (info.order_id && !/pid=/.test(tx.note ?? "")) patch.note = `${tx.note ?? ""} · pid=${info.order_id}`;
        await supabaseAdmin
          .from("wallet_transactions")
          .update(patch as any)
          .eq("id", tx.id);

        return new Response("SUCCESS");
      },
    },
  },
});
