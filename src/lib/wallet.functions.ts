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
    const supabaseAdmin = ((await import("@/integrations/supabase/client.server")).supabaseAdmin) as any;
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
  .inputValidator(
    (d: { amountCad: number; proofPath?: string | null; note?: string | null; idempotencyKey?: string | null }) => d,
  )
  .handler(async ({ data, context }) => {
    if (!(data.amountCad >= 2)) throw new Error("最低充值 CA$2");
    const supabaseAdmin = ((await import("@/integrations/supabase/client.server")).supabaseAdmin) as any;
    const { sendEmtNotifyEmail } = await import("@/lib/wallet.server");
    const fx = await getFxCadPerCny(supabaseAdmin);
    const amountCad = Number(data.amountCad.toFixed(2));

    // 幂等：同一 idempotency_key，或 20 分钟内同金额的待处理 EMT 充值 → 复用原单，不再发邮件
    const idem = data.idempotencyKey?.trim() || null;
    const dedup = supabaseAdmin
      .from("wallet_transactions")
      .select("ref_no")
      .eq("user_id", context.userId)
      .eq("type", "recharge")
      .eq("channel", "emt")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1);
    const { data: existing } = idem
      ? await dedup.eq("idempotency_key", idem)
      : await dedup.eq("amount_cad", amountCad).gte("created_at", new Date(Date.now() - 20 * 60_000).toISOString());
    if (existing && (existing as any[])[0]?.ref_no) {
      return { ok: true, reference: (existing as any[])[0].ref_no as string, deduped: true };
    }

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
      idempotency_key: idem,
      note: `Email Transfer 充值 CA$${amountCad}${data.proofPath ? ` · 凭证=${data.proofPath}` : ""}${data.note ? ` · ${data.note}` : ""}`,
    } as any);
    if (error) {
      // 幂等键撞车：仍在 pending 就复用原单；已 completed/failed 说明这个 key 已用过一次，
      // 让前端换 key 重新发起，而不是把旧记录当新提交。
      if (idem && String((error as any).code) === "23505") {
        const { data: won } = await supabaseAdmin
          .from("wallet_transactions")
          .select("ref_no, status")
          .eq("idempotency_key", idem)
          .maybeSingle();
        if ((won as any)?.status === "pending" && (won as any)?.ref_no) {
          return { ok: true, reference: (won as any).ref_no as string, deduped: true };
        }
        throw new Error("该充值请求已处理，请刷新页面后重新发起");
      }
      throw new Error(error.message);
    }

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

