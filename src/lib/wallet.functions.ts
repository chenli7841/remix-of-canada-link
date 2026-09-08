import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getFxCadPerCny } from "@/lib/orders.functions";

// Self-service wallet top-up. No real payment gateway is wired in yet, so this
// completes the transaction immediately (service role bypasses the customer
// RLS policy, which only allows self-inserting 'pending' rows) and credits
// wallets.balance_cad via the apply_wallet_tx trigger. Swap this to
// status: "pending" once a real gateway confirms payment asynchronously.
export const rechargeWallet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { amountCad: number; channel: "card" | "wechat" | "alipay" }) => d)
  .handler(async ({ data, context }) => {
    if (!(data.amountCad >= 2)) throw new Error("最低充值 CA$2");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const fx = await getFxCadPerCny(supabaseAdmin); // CAD per CNY
    const amountCad = Number(data.amountCad.toFixed(2));
    const amountCny = +(amountCad / fx).toFixed(2);

    const { error } = await supabaseAdmin.from("wallet_transactions").insert({
      user_id: context.userId,
      type: "recharge",
      amount_cad: amountCad,
      amount_cny: amountCny,
      fx_rate_cny_to_cad: fx,
      status: "completed",
      channel: data.channel,
      note: `用户充值 CA$${amountCad}`,
    } as any);
    if (error) throw new Error(error.message);

    return { ok: true, amount_cad: amountCad, amount_cny: amountCny };
  });

// EMT (Interac e-Transfer) top-up: records a pending transaction and emails the
// customer a fixed-format confirmation, CC'ing the configured staff addresses.
// Staff credit the balance manually after verifying the transfer.
export const submitEmtTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { amountCad: number; proofPath?: string | null; note?: string | null }) => d)
  .handler(async ({ data, context }) => {
    if (!(data.amountCad >= 2)) throw new Error("最低充值 CA$2");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { sendEmtNotifyEmail } = await import("@/lib/wallet.server");
    const fx = await getFxCadPerCny(supabaseAdmin);
    const amountCad = Number(data.amountCad.toFixed(2));
    const reference = `EMT${Date.now().toString(36).toUpperCase()}`;

    const { error } = await supabaseAdmin.from("wallet_transactions").insert({
      user_id: context.userId,
      type: "recharge",
      amount_cad: amountCad,
      amount_cny: +(amountCad / fx).toFixed(2),
      fx_rate_cny_to_cad: fx,
      status: "pending",
      channel: "emt",
      ref_no: reference,
      note: `Email Transfer 充值 CA$${amountCad}${data.proofPath ? ` · 凭证=${data.proofPath}` : ""}${data.note ? ` · ${data.note}` : ""}`,
    } as any);
    if (error) throw new Error(error.message);

    let proofUrl: string | null = null;
    if (data.proofPath) {
      const { data: signed } = await supabaseAdmin.storage
        .from("payment-proofs")
        .createSignedUrl(data.proofPath, 60 * 60 * 24 * 7);
      proofUrl = signed?.signedUrl ?? null;
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email, full_name, customer_code")
      .eq("id", context.userId)
      .maybeSingle();

    const toEmail = (profile as any)?.email as string | undefined;
    if (toEmail) {
      try {
        await sendEmtNotifyEmail(supabaseAdmin, {
          toEmail,
          customerName: ((profile as any)?.full_name as string) || toEmail,
          customerCode: ((profile as any)?.customer_code as string) ?? null,
          amountCad,
          reference,
          proofUrl,
          proofPath: data.proofPath ?? null,
          note: data.note ?? null,
        });
      } catch (e: any) {
        console.error("[wallet/emt] failed to send email:", e?.message ?? e);
      }
    }

    return { ok: true, reference };
  });

