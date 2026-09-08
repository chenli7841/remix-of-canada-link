import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { recordAdminLog } from "@/lib/admin-log";

async function assertStaff(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_staff", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

function pubClient() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

// Sends the "new contact message" notification via Gmail SMTP using the admin-configured
// from/to/cc addresses (app_settings.contact_email_notify — non-secret, world-readable).
// The Gmail App Password itself is deliberately NOT stored in the database; it must be set
// as the server-only env var GMAIL_APP_PASSWORD (see .env.local).
async function sendNotifyEmail(
  supabase: any,
  msg: { name: string; email: string; phone: string | null; message: string },
) {
  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "contact_email_notify")
    .maybeSingle();
  const cfg = (setting?.value ?? {}) as {
    enabled?: boolean;
    from_email?: string;
    to_email?: string;
    cc_emails?: string[];
  };
  if (!cfg.enabled || !cfg.from_email) return;

  const appPassword = process.env.GMAIL_APP_PASSWORD;
  if (!appPassword) {
    console.error("[contact] GMAIL_APP_PASSWORD is not set — skipping notification email");
    return;
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    service: "gmail",
    auth: { user: cfg.from_email, pass: appPassword },
  });

  await transporter.sendMail({
    from: cfg.from_email,
    to: cfg.to_email || cfg.from_email,
    cc: (cfg.cc_emails ?? []).filter(Boolean),
    replyTo: msg.email,
    subject: `[SinoCargo 官网留言] ${msg.name}`,
    text: [
      `姓名：${msg.name}`,
      `邮箱：${msg.email}`,
      `电话：${msg.phone || "（未填写）"}`,
      "",
      "留言内容：",
      msg.message,
    ].join("\n"),
  });
}

export const submitContactMessage = createServerFn({ method: "POST" })
  .inputValidator((d: { name: string; email: string; phone?: string; message: string }) => d)
  .handler(async ({ data }) => {
    const name = data.name?.trim();
    const email = data.email?.trim();
    const message = data.message?.trim();
    const phone = data.phone?.trim() || null;
    if (!name || !email || !message) throw new Error("请填写姓名、邮箱和留言内容");

    const supabase = pubClient();
    const { error } = await supabase.from("contact_messages").insert({ name, email, phone, message });
    if (error) throw new Error(error.message);

    try {
      await sendNotifyEmail(supabase, { name, email, phone, message });
    } catch (e: any) {
      // Never fail the submission just because the notification email couldn't be sent.
      console.error("[contact] failed to send notification email:", e?.message ?? e);
    }

    return { ok: true };
  });

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  message: string;
  status: string;
  created_at: string;
};

export const listContactMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { status?: "all" | "new" | "read" | "archived"; search?: string; page?: number; pageSize?: number }) => d,
  )
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(100, Math.max(10, data.pageSize ?? 25));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = supabaseAdmin
      .from("contact_messages")
      .select("id, name, email, phone, message, status, created_at", { count: "exact" })
      .order("created_at", { ascending: false });
    if (data.status && data.status !== "all") q = q.eq("status", data.status);
    if (data.search?.trim()) {
      const s = data.search.trim();
      q = q.or(`name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%,message.ilike.%${s}%`);
    }
    const from = (page - 1) * pageSize;
    const { data: rows, error, count } = await q.range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    return { rows: (rows ?? []) as ContactMessage[], total: count ?? 0, page, pageSize };
  });

export const updateContactMessageStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "new" | "read" | "archived" }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("contact_messages").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "contact_message",
      entity_id: data.id,
      action: "update_status",
      after: { status: data.status },
      operator_id: context.userId,
    });
    return { ok: true };
  });

export const deleteContactMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    await assertStaff(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin.from("contact_messages").select("*").eq("id", data.id).maybeSingle();
    const { error } = await supabaseAdmin.from("contact_messages").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await recordAdminLog(supabaseAdmin, {
      entity_type: "contact_message",
      entity_id: data.id,
      action: "delete",
      before,
      operator_id: context.userId,
    });
    return { ok: true };
  });
