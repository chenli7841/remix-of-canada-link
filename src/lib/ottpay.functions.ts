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
  .inputValidator((d: { amountCad: number; channel: "wechat" | "alipay"; device: "mobile" | "desktop" }) => d)
  .handler(async ({ data, context }): Promise<OttStartResult> => {
    if (!(data.amountCad >= 2)) throw new Error("最低充值 CA$2");
    const { ottPost, toCents, ottConfig } = await import("@/lib/ottpay.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getFxCadPerCny } = await import("@/lib/orders.functions");

    const amountCad = Number(data.amountCad.toFixed(2));
    const fx = await getFxCadPerCny(supabaseAdmin);
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
      note: `OTT Pay 充值 CA$${amountCad}${paymentId ? ` · pid=${paymentId}` : ""}`,
    } as any);
    if (error) throw new Error(error.message);

    if (mode === "qr") {
      const QRCode = await import("qrcode");
      const qrDataUrl = await QRCode.toDataURL(payInfo, { width: 320, margin: 1 });
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
  .inputValidator((d: { amountCad: number }) => d)
  .handler(async ({ data, context }): Promise<{ url: string; reference: string }> => {
    if (!(data.amountCad >= 2)) throw new Error("最低充值 CA$2");
    const { hostedConfig, hostedPost, txnTime } = await import("@/lib/ottpay-hosted.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getFxCadPerCny } = await import("@/lib/orders.functions");

    const amountCad = Number(data.amountCad.toFixed(2));
    const fx = await getFxCadPerCny(supabaseAdmin);
    const cfg = hostedConfig();
    const reference = `TOPUP${Date.now()}${Math.floor(Math.random() * 1000)}`;

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

    const { error } = await supabaseAdmin.from("wallet_transactions").insert({
      user_id: context.userId,
      type: "recharge",
      amount_cad: amountCad,
      amount_cny: +(amountCad / fx).toFixed(2),
      fx_rate_cny_to_cad: fx,
      status: "pending",
      channel: "card",
      ref_no: reference,
      note: `OTT Pay 信用卡充值 CA$${amountCad} · hosted=1`,
    } as any);
    if (error) throw new Error(error.message);

    return { url, reference };
  });

/** Poll OTT Pay for a pending top-up and settle the wallet transaction. */
export const syncOttTopup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reference: string }) => d)
  .handler(async ({ data, context }) => {
    const { ottPost } = await import("@/lib/ottpay.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: tx } = await supabaseAdmin
      .from("wallet_transactions")
      .select("*")
      .eq("ref_no", data.reference)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!tx) throw new Error("找不到该充值记录");
    if (tx.status !== "pending") return { status: tx.status };

    // Converge hosted (credit card) uses the frontapi STATUS_QUERY endpoint
    if (/hosted=1/.test(tx.note ?? "")) {
      const { hostedConfig, hostedPost, txnTime, HOSTED_PAID_STATES, HOSTED_FAILED_STATES } =
        await import("@/lib/ottpay-hosted.server");
      const cfg = hostedConfig();
      const q = await hostedPost("STATUS_QUERY", "1.0", {
        orderId: data.reference,
        merchant_id: cfg.merchantId,
        bizType: "converge_hosted",
        txnTime: txnTime(),
        channelType: "ELAVONECOM",
      });
      const st = String(q.order_status ?? q.orderStatus ?? "").toLowerCase();
      let hostedNext: string | null = null;
      if (HOSTED_PAID_STATES.has(st)) hostedNext = "completed";
      else if (HOSTED_FAILED_STATES.has(st)) hostedNext = "failed";
      if (hostedNext) await supabaseAdmin.from("wallet_transactions").update({ status: hostedNext }).eq("id", tx.id);
      return { status: hostedNext ?? "pending" };
    }

    const pid = /pid=([\w-]+)/.exec(tx.note ?? "")?.[1];
    if (!pid) return { status: "pending" };

    const r = await ottPost<any>("/api/v1/payment/status-query", { paymentId: pid });
    const s = String(r.paymentStatus ?? "").toLowerCase();
    let next: string | null = null;
    if (["success", "captured", "authorised", "authorized"].includes(s)) next = "completed";
    else if (["failure", "orderclosed"].includes(s)) next = "failed";

    if (next) await supabaseAdmin.from("wallet_transactions").update({ status: next }).eq("id", tx.id);
    return { status: next ?? "pending" };
  });
