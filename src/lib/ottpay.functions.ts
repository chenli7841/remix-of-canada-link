import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type OttStartResult =
  | { mode: "redirect"; url: string; reference: string; paymentId: string | null }
  | {
      mode: "qr";
      payInfo: string;
      qrDataUrl: string;
      reference: string;
      paymentId: string | null;
      /** Warning to show above the QR (e.g. WeChat browser can't run Alipay) */
      notice?: string;
      /** Deep link / URL the user can open in the target app */
      openUrl?: string;
    };

/**
 * Create an OTT Pay top-up (WeChat / Alipay) and a matching pending wallet transaction.
 * `device: "mobile"` uses the H5 flows (redirect), desktop uses the scan-code flow (QR).
 */
export const startOttTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      amountCad: number;
      channel: "wechat" | "alipay";
      device: "mobile" | "desktop";
      idempotencyKey?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }): Promise<OttStartResult> => {
    if (typeof data.amountCad !== "number" || !Number.isFinite(data.amountCad) || data.amountCad < 2
      || !Number.isSafeInteger(Math.round(data.amountCad * 100))
      || Math.abs(data.amountCad * 100 - Math.round(data.amountCad * 100)) > 0.000001)
      throw new Error("充值金额最低 CA$2，最多两位小数");
    const { ottPost, toCents, ottConfig } = await import("@/lib/ottpay.server");
    const supabaseAdmin = ((await import("@/integrations/supabase/client.server")).supabaseAdmin) as any;
    const { getFxCadPerCny } = await import("@/lib/orders.functions");

    const amountCad = Number(data.amountCad.toFixed(2));
    const fx = await getFxCadPerCny(supabaseAdmin);

    // 幂等：同一 idempotency_key（或 2 分钟内同渠道同金额的 pending 单）→ 复用原支付订单，
    // 不再向 OTT 发起新订单。展示信息从建单时存下的 pay_session.pay_info 还原。
    const idem = data.idempotencyKey?.trim() || null;
    const dq = supabaseAdmin
      .from("wallet_transactions")
      .select("ref_no, status, provider_payment_id, pay_session")
      .eq("user_id", context.userId)
      .eq("type", "recharge")
      .eq("channel", data.channel)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1);
    const { data: dupe } = idem
      ? await dq.eq("idempotency_key", idem)
      : await dq.eq("amount_cad", amountCad).gte("created_at", new Date(Date.now() - 120_000).toISOString());
    const prev = (dupe as any[])?.[0];
    if (prev?.pay_session?.pay_info) {
      const pr = prev.pay_session;
      if (pr.mode === "qr") {
        const { paymentQrDataUrl } = await import("@/lib/payment-qr.server");
        return {
          mode: "qr",
          payInfo: pr.pay_info,
          qrDataUrl: paymentQrDataUrl(pr.pay_info),
          reference: prev.ref_no,
          paymentId: prev.provider_payment_id ?? null,
          notice: pr.notice ?? undefined,
          openUrl: pr.open_url ?? undefined,
        };
      }
      return { mode: "redirect", url: pr.pay_info, reference: prev.ref_no, paymentId: prev.provider_payment_id ?? null };
    }

    const reference = `TOPUP${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const cfg = ottConfig();
    const callbackURL = `${cfg.origin}/api/public/hooks/ottpay`;
    const returnURL = `${cfg.origin}/account?tab=wallet&ott=${reference}`;
    const amount = toCents(amountCad);

    let payInfo = "";
    let paymentId: string | null = null;
    let mode: "redirect" | "qr" = "redirect";
    let notice: string | undefined;
    let openUrl: string | undefined;

    // ---- 自动判断支付环境（服务端 UA 为准，客户端 device 作为兜底）----
    const { getRequestHeader } = await import("@tanstack/react-start/server");
    const ua = String(getRequestHeader("user-agent") ?? "");
    const inWeChat = /MicroMessenger/i.test(ua);
    const inAlipay = /AlipayClient/i.test(ua);
    const uaMobile = /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i.test(ua);
    const isMobile = ua ? uaMobile || inWeChat || inAlipay : data.device === "mobile";

    // 与所选渠道匹配的 App 内置浏览器：可直接调起授权支付
    const nativeWeChat = data.channel === "wechat" && inWeChat;
    const nativeAlipay = data.channel === "alipay" && inAlipay;
    // 渠道与当前 App 不匹配（如在微信里选支付宝）：只能出二维码让用户换端扫码
    const crossApp = (data.channel === "wechat" && inAlipay) || (data.channel === "alipay" && inWeChat);

    /** 从 wap 链接里提取内嵌的二维码地址（PC / 跨端场景用） */
    const extractQr = (link: string) => {
      const m = /[?&]qr[cC]ode=([^&]+)/.exec(link);
      return m && m[1] ? decodeURIComponent(m[1]) : null;
    };

    if (data.channel === "wechat") {
      if (nativeWeChat) {
        // 微信内置浏览器 → 公众号支付，直接调起微信授权
        const r = await ottPost<any>("/api/v1/pay/weixin/public-pay", {
          amount,
          callbackURL,
          returnURL,
          remark: reference,
        });
        payInfo = r.payInfo;
        paymentId = r.paymentId ?? null;
      } else if (isMobile && !crossApp) {
        // 普通手机浏览器 → H5 支付，跳转后自动唤起微信 App 授权
        const r = await ottPost<any>("/api/v1/pay/weixin/h5-pay", {
          amount,
          callbackURL,
          returnURL,
          remark: reference,
        });
        payInfo = r.payInfo;
        paymentId = r.paymentId ?? null;
      } else {
        // 电脑 / 跨 App → 扫码支付
        const r = await ottPost<any>("/api/v1/pay/weixin/active-pay", {
          amount,
          callbackURL,
          remark: reference,
        });
        payInfo = r.payInfo;
        paymentId = r.paymentId ?? null;
        mode = "qr";
        if (crossApp) {
          // 在支付宝里选微信：支付宝内无法调起微信，给二维码 + 跳转链接
          openUrl = String(payInfo ?? "");
          notice = "支付宝浏览器不支持微信付款，请跳转到微信 App 进行付款";
        }
      }
    } else {
      if (nativeAlipay || (isMobile && !crossApp)) {
        // 支付宝内置浏览器 / 手机浏览器 → WAP 支付，自动唤起支付宝 App 授权
        const r = await ottPost<any>("/api/v1/pay/alipay/wap-pay", {
          amount,
          callbackURL,
          returnURL,
          remark: reference,
        });
        payInfo = r.payInfo;
        paymentId = r.paymentId ?? null;
      } else if (crossApp) {
        // 在微信里选支付宝：微信内无法调起支付宝，给二维码 + 跳转链接
        const r = await ottPost<any>("/api/v1/pay/alipay/wap-pay", {
          amount,
          callbackURL,
          returnURL,
          remark: reference,
        });
        paymentId = r.paymentId ?? null;
        const raw = String(r.payInfo ?? "");
        const qr = extractQr(raw);
        payInfo = qr ?? raw;
        openUrl = qr ?? raw;
        notice = "微信浏览器不支持支付宝付款，请跳转到支付宝 App 进行付款";
        mode = "qr";
      } else {
        // 电脑端：优先官方 PC 收银台，失败回退二维码
        try {
          const r = await ottPost<any>("/api/v1/pay/alipay/web-pay", {
            amount,
            callbackURL,
            returnURL,
            remark: reference,
          });
          payInfo = r.payInfo;
          paymentId = r.paymentId ?? null;
        } catch {
          const r = await ottPost<any>("/api/v1/pay/alipay/wap-pay", {
            amount,
            callbackURL,
            returnURL,
            remark: reference,
          });
          paymentId = r.paymentId ?? null;
          const qr = extractQr(String(r.payInfo ?? ""));
          payInfo = qr ?? String(r.payInfo ?? "");
          if (qr) mode = "qr";
        }
      }
    }

    const { error } = await supabaseAdmin.from("wallet_transactions").insert({
      user_id: context.userId,
      type: "recharge",
      amount_cad: amountCad,
      amount_cny: +(amountCad / fx).toFixed(2),
      fx_rate_cny_to_cad: fx,
      status: "pending",
      channel: data.channel,
      ref_no: reference,
      idempotency_key: idem,
      provider_payment_id: paymentId,
      pay_session: { pay_info: payInfo, mode, notice: notice ?? null, open_url: openUrl ?? null },
      note: `OTT Pay 充值 CA$${amountCad}`,
    } as any);
    if (error) {
      if (idem && String((error as any).code) === "23505") {
        const { data: won } = await supabaseAdmin
          .from("wallet_transactions")
          .select("ref_no, status, provider_payment_id, pay_session")
          .eq("idempotency_key", idem)
          .maybeSingle();
        if ((won as any) && (won as any).status !== "pending") {
          throw new Error("该充值请求已处理，请刷新页面后重新发起");
        }
        const pr = (won as any)?.pay_session;
        if (pr?.pay_info) {
          if (pr.mode === "qr") {
            const { paymentQrDataUrl } = await import("@/lib/payment-qr.server");
            return {
              mode: "qr",
              payInfo: pr.pay_info,
              qrDataUrl: paymentQrDataUrl(pr.pay_info),
              reference: (won as any).ref_no,
              paymentId: (won as any).provider_payment_id ?? null,
              notice: pr.notice ?? undefined,
              openUrl: pr.open_url ?? undefined,
            };
          }
          return {
            mode: "redirect",
            url: pr.pay_info,
            reference: (won as any).ref_no,
            paymentId: (won as any).provider_payment_id ?? null,
          };
        }
      }
      throw new Error(error.message);
    }

    if (mode === "qr") {
      const { paymentQrDataUrl } = await import("@/lib/payment-qr.server");
      const qrDataUrl = paymentQrDataUrl(payInfo);
      return { mode, payInfo, qrDataUrl, reference, paymentId, notice, openUrl };
    }
    return { mode: "redirect", url: payInfo, reference, paymentId };
  });

/**
 * Credit card top-up via OTT Pay + Elavon Converge Hosted Payment.
 * Returns a hosted payment page URL; the cardholder enters card data on
 * Converge's page (nothing sensitive touches our servers).
 */
export const startOttHostedCardTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { amountCad: number; idempotencyKey?: string | null }) => d)
  .handler(async ({ data, context }): Promise<{ url: string; reference: string }> => {

    const amountCad = data.amountCad;
    if (typeof amountCad !== "number" || !Number.isFinite(amountCad) || amountCad < 2
      || !Number.isSafeInteger(Math.round(amountCad * 100))
      || Math.abs(amountCad * 100 - Math.round(amountCad * 100)) > 0.000001)
      throw new Error("充值金额最低 CA$2，最多两位小数");
    if (!data.idempotencyKey || !/^[A-Za-z0-9_-]{8,128}$/.test(data.idempotencyKey)) throw new Error("充值请求无效，请刷新页面");
    const { createHash } = await import("crypto");
    const idem = "card_" + createHash("sha256").update(context.userId + ":" + data.idempotencyKey).digest("hex");
    const { hostedConfig, hostedPost, txnTime } = await import("@/lib/ottpay-hosted.server");
    const supabaseAdmin = ((await import("@/integrations/supabase/client.server")).supabaseAdmin) as any;
    const { getFxCadPerCny } = await import("@/lib/orders.functions");
    const previous = async () => {
      const result = await supabaseAdmin.from("wallet_transactions").select("ref_no,status,amount_cad,pay_session")
        .eq("user_id", context.userId).eq("idempotency_key", idem).maybeSingle();
      if (result.error) throw new Error("充值记录读取失败，请稍后重试");
      return result.data;
    };
    const reuse = (row: any) => {
      if (Number(row.amount_cad) !== amountCad) throw new Error("请勿更改同一充值请求的金额");
      if (row.status !== "pending") throw new Error("该充值已处理，请查看钱包流水");
      if (!row.pay_session?.pay_info) throw new Error("原充值正在处理或等待核验，请勿重复付款。参考号：" + row.ref_no);
      return {url: row.pay_session.pay_info as string, reference: row.ref_no as string};
    };
    const prior = await previous();
    if (prior) return reuse(prior);
    const fx = await getFxCadPerCny(supabaseAdmin);
    const cfg = hostedConfig();
    const reference = "TOPUP" + Date.now() + Math.floor(Math.random() * 1000);
    // Reserve the unique request before calling the gateway. Unknown outcomes remain reconcilable.
    const reserved = await supabaseAdmin.from("wallet_transactions").insert({
      user_id: context.userId, type: "recharge", amount_cad: amountCad,
      amount_cny: +(amountCad / fx).toFixed(2), fx_rate_cny_to_cad: fx,
      status: "pending", channel: "card", ref_no: reference, idempotency_key: idem,
      pay_session: {mode: "redirect", hosted: true, state: "creating"},
      note: "OTT Pay 信用卡充值 CA$" + amountCad + " · hosted=1",
    });
    if (reserved.error) {
      if (reserved.error.code === "23505") { const winner = await previous(); if (winner) return reuse(winner); }
      throw new Error("无法保存充值请求，请稍后重试");
    }

    const r = await hostedPost("CC_PURCHASE", "2.0", {
      orderId: reference,
      merchant_id: cfg.merchantId,
      operator_id: cfg.operatorId,
      txnTime: txnTime(),
      txnAmt: String(Math.round(amountCad * 100)),
      frontUrl: `${cfg.origin}/account?tab=wallet&ott=${reference}`,
      backUrl: `${cfg.origin}/api/public/hooks/ottpay-card`,
      channelType: "ELAVONECOM",
      bizType: "converge_hosted",
      cc_channelType: "web",
    });

    const url = String(r.codeUrl ?? r.code_url ?? "");
    if (!url) throw new Error(`OTT Pay 未返回支付页面链接 (${r.rspMsg ?? r.rsp_msg ?? ""})`);

    if (!url.startsWith("https://")) throw new Error("支付链接无效，请联系工作人员核验原充值");
    const saved = await supabaseAdmin.from("wallet_transactions")
      .update({ pay_session: { pay_info: url, mode: "redirect", hosted: true } })
      .eq("user_id", context.userId).eq("ref_no", reference).select("id").single();
    if (saved.error || !saved.data) throw new Error("支付链接保存失败，请稍后重试原充值请求");

    return { url, reference };
  });

/** Poll OTT Pay for a pending top-up and settle the wallet transaction. */
export const syncOttTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reference: string }) => d)
  .handler(async ({ data, context }) => {
    const supabaseAdmin = ((await import("@/integrations/supabase/client.server")).supabaseAdmin) as any;

    const { data: tx } = await supabaseAdmin
      .from("wallet_transactions")
      .select("*")
      .eq("ref_no", data.reference)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!tx) throw new Error("找不到该充值记录");
    if (tx.status !== "pending") return { status: tx.status };

    if (tx.channel === "card" || /hosted=1/.test(tx.note ?? "")) {
      const { verifyOttRecharge } = await import("@/lib/ottpay-reconcile.server");
      const v = await verifyOttRecharge({...tx, ref_no: data.reference});
      if (v.decision === "error") throw new Error(v.error);
      const saved = await supabaseAdmin.rpc("_wallet_recharge_settle_system", {_payload: {
        op: v.decision === "settle" ? "ott_settle" : v.decision === "fail" ? "ott_mark_failed" : "ott_record",
        tx_id: tx.id, provider_status: v.providerStatus,
        provider_payment_id: v.decision === "mismatch" ? null : v.providerPaymentId,
        provider_response: v.providerResponse,
      }});
      if (saved.error || !saved.data?.status) throw new Error("充值状态保存失败，请稍后重试");
      if (v.decision === "mismatch" || v.decision === "refund") throw new Error(v.warning);
      return {status: saved.data.status};
    }

    // pid 优先取字段，回退到历史 note 里的 pid=（不再新写 note）
    const pid = (tx as any).provider_payment_id || /pid=([\w-]+)/.exec(tx.note ?? "")?.[1];
    if (!pid) return { status: "pending" };

    const { verifyOttRecharge } = await import("@/lib/ottpay-reconcile.server");
    const verified = await verifyOttRecharge(tx);
    let next: string | null = null;
    if (verified.decision === "settle") next = "completed";
    else if (verified.decision === "fail") next = "failed";
    else if (verified.decision === "error") throw new Error(verified.error);

    if (next) {
      const patch: any = { status: next, verified_at: new Date().toISOString() };
      if (!(tx as any).provider_payment_id) patch.provider_payment_id = pid;
      const { error } = await supabaseAdmin.from("wallet_transactions").update(patch).eq("id", tx.id).eq("status", "pending");
      if (error) throw new Error("充值状态保存失败，请稍后重试");
    }
    return { status: next ?? "pending" };
  });
