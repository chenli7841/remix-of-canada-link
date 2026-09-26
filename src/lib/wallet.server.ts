// Server-only helpers for wallet flows (Email Transfer proof notification email).
// Uses the same Gmail SMTP setup as the contact form: the sender address comes
// from app_settings.contact_email_notify, the App Password from env.
// The email body itself is admin-configurable via app_settings.emt_email_notify
// (bilingual: zh + en templates).

export type EmtEmailInput = {
  toEmail: string;
  customerName: string;
  customerCode: string | null;
  amountCad: number;
  reference: string;
  proofUrl: string | null;
  proofPath: string | null;
  note: string | null;
};

export const EMT_DEFAULT_SUBJECT =
  "[EPLUS] Email Transfer 充值申请 / Top-up request · CA${{amount}} · {{reference}}";

export const EMT_DEFAULT_BODY_ZH = [
  "{{name}} 您好，",
  "",
  "感谢您的支持，我们已收到您的 Email Transfer 付款提交申请，我们将在 24 小时内完成充值动作，如果后续有问题请联系客服。",
  "",
  "提交时间：{{time}}",
  "提交金额：CA${{amount}}",
  "客户号：{{customer_code}}",
  "参考编号：{{reference}}",
  "备注：{{note}}",
  "凭证图片：见附件",
].join("\n");

export const EMT_DEFAULT_BODY_EN = [
  "Dear {{name}},",
  "",
  "Thank you for your support. We have received your Email Transfer payment submission and will complete the top-up within 24 hours. Please contact customer service if you have any questions.",
  "",
  "Submitted at: {{time}}",
  "Amount: CA${{amount}}",
  "Customer No.: {{customer_code}}",
  "Reference: {{reference}}",
  "Note: {{note}}",
  "Proof image: see attachment",
  "",
  "EPLUS International Services Inc.",
].join("\n");

export async function sendEmtNotifyEmail(supabaseAdmin: any, input: EmtEmailInput) {
  const { data: rows } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", ["contact_email_notify", "emt_payment", "emt_email_notify"]);

  const map = new Map<string, any>((rows ?? []).map((r: any) => [r.key, r.value ?? {}]));
  const mail = (map.get("contact_email_notify") ?? {}) as {
    from_email?: string;
    to_email?: string;
    cc_emails?: string[];
  };
  const emt = (map.get("emt_payment") ?? {}) as { email?: string; cc_emails?: string[] };
  const tpl = (map.get("emt_email_notify") ?? {}) as {
    subject_template?: string;
    body_template_zh?: string;
    body_template_en?: string;
    cc_emails?: string[];
  };

  const from = mail.from_email;
  const appPassword = process.env.GMAIL_APP_PASSWORD;
  if (!from || !appPassword) {
    console.error("[wallet/emt] email not configured — skipping notification");
    return;
  }

  const emtEmail = emt.email || "epluscanada@gmail.com";
  const cc = Array.from(
    new Set(
      [...(tpl.cc_emails ?? []), ...(emt.cc_emails ?? []), ...(mail.cc_emails ?? []), mail.to_email || from].filter(
        Boolean,
      ),
    ),
  ) as string[];

  const time = new Date().toLocaleString("zh-CN", { timeZone: "America/Toronto" });
  const vars: Record<string, string> = {
    name: input.customerName,
    amount: input.amountCad.toFixed(2),
    customer_code: input.customerCode || "—",
    reference: input.reference,
    time,
    note: input.note || "—",
    emt_email: emtEmail,
    proof_url: input.proofUrl || "—",
  };
  const render = (t: string) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");

  const subject = render(tpl.subject_template?.trim() || EMT_DEFAULT_SUBJECT);
  const text = [
    render(tpl.body_template_zh?.trim() || EMT_DEFAULT_BODY_ZH),
    "",
    "— — — — — — — — — —",
    "",
    render(tpl.body_template_en?.trim() || EMT_DEFAULT_BODY_EN),
  ].join("\n");

  // Attach the uploaded proof image itself (falls back to the signed link in the body).
  const attachments: any[] = [];
  if (input.proofPath) {
    try {
      const { data: file } = await supabaseAdmin.storage.from("payment-proofs").download(input.proofPath);
      if (file) {
        const buf = Buffer.from(await file.arrayBuffer());
        attachments.push({
          filename: input.proofPath.split("/").pop() || "proof.jpg",
          content: buf,
          contentType: (file as any).type || undefined,
        });
      }
    } catch (e: any) {
      console.error("[wallet/emt] failed to attach proof:", e?.message ?? e);
    }
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    service: "gmail",
    auth: { user: from, pass: appPassword },
  });

  await transporter.sendMail({
    from,
    to: input.toEmail,
    cc,
    subject,
    text: input.proofUrl ? `${text}\n\n凭证链接 / Proof link (7d): ${input.proofUrl}` : text,
    attachments,
  });
}

// 后台「现在充值」入账成功后回复客户：沿用提交申请时那封邮件的主题（加 Re:），
// Gmail 按主题把它归到同一会话里，客户看到的就是对原申请邮件的回复。
export async function sendEmtCreditedEmail(
  supabaseAdmin: any,
  input: { toEmail: string; customerName: string; customerCode: string | null; amountCad: number; reference: string },
) {
  const { data: rows } = await supabaseAdmin
    .from("app_settings")
    .select("key, value")
    .in("key", ["contact_email_notify", "emt_email_notify"]);
  const map = new Map<string, any>((rows ?? []).map((r: any) => [r.key, r.value ?? {}]));
  const mail = (map.get("contact_email_notify") ?? {}) as { from_email?: string };
  const tpl = (map.get("emt_email_notify") ?? {}) as { subject_template?: string };

  const from = mail.from_email;
  const appPassword = process.env.GMAIL_APP_PASSWORD;
  if (!from || !appPassword) throw new Error("邮件未配置（发件邮箱或 GMAIL_APP_PASSWORD 缺失）");

  const vars: Record<string, string> = {
    name: input.customerName,
    amount: input.amountCad.toFixed(2),
    customer_code: input.customerCode || "—",
    reference: input.reference,
  };
  const render = (t: string) => t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");
  const subject = `Re: ${render(tpl.subject_template?.trim() || EMT_DEFAULT_SUBJECT)}`;
  const text = [
    `${input.customerName} 您好，`,
    "",
    "这个充值订单已充值，请查收。",
    "",
    `充值金额：CA$${vars.amount}`,
    `客户号：${vars.customer_code}`,
    `参考编号：${vars.reference}`,
    "",
    "— — — — — — — — — —",
    "",
    `Dear ${input.customerName},`,
    "",
    "This top-up has been credited to your wallet. Please check your balance.",
    "",
    `Amount: CA$${vars.amount}`,
    `Customer No.: ${vars.customer_code}`,
    `Reference: ${vars.reference}`,
    "",
    "EPLUS International Services Inc.",
  ].join("\n");

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    service: "gmail",
    auth: { user: from, pass: appPassword },
  });
  await transporter.sendMail({ from, to: input.toEmail, subject, text });
}
