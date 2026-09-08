import { useState } from "react";
import { MessageCircle, X, Mail, Phone } from "lucide-react";
import { useCompanyInfo } from "@/lib/company";
import { useApp } from "@/lib/i18n";

export function FloatingContact() {
  const c = useCompanyInfo();
  const { lang } = useApp();
  const [open, setOpen] = useState(false);
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);

  const hasWeChat = !!(c.wechat || c.wechat_qr_url);
  const hasWhats = !!(c.whatsapp || c.whatsapp_qr_url);
  const hasEmail = !!c.email;
  const hasPhone = !!c.phone;
  if (!hasWeChat && !hasWhats && !hasEmail && !hasPhone) return null;

  const waHref = c.whatsapp
    ? `https://wa.me/${c.whatsapp.replace(/[^0-9]/g, "")}`
    : null;

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-3 sm:bottom-6 sm:right-6">
      {open && (
        <div className="w-72 rounded-2xl border border-border bg-surface p-4 shadow-elevated animate-in fade-in slide-in-from-bottom-2">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-display text-sm font-bold">
              {tr("联系我们", "Contact us")}
            </div>
            <button
              onClick={() => setOpen(false)}
              className="rounded-full p-1 text-ink-soft hover:bg-accent"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3">
            {hasWeChat && (
              <ContactRow
                label={tr("微信客服", "WeChat")}
                sub={c.wechat}
                qr={c.wechat_qr_url}
                color="#07C160"
                icon={<WeChatIcon />}
              />
            )}
            {hasWhats && (
              <ContactRow
                label="WhatsApp"
                sub={c.whatsapp}
                qr={c.whatsapp_qr_url}
                href={waHref}
                color="#25D366"
                icon={<WhatsAppIcon />}
              />
            )}
            {hasEmail && (
              <a
                href={`mailto:${c.email}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-2.5 transition hover:border-brand/40"
              >
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand/10 text-brand">
                  <Mail className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">{tr("邮箱", "Email")}</div>
                  <div className="truncate text-[11px] text-ink-soft">{c.email}</div>
                </div>
              </a>
            )}
            {hasPhone && (
              <a
                href={`tel:${c.phone}`}
                className="flex items-center gap-3 rounded-xl border border-border bg-background p-2.5 transition hover:border-brand/40"
              >
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand/10 text-brand">
                  <Phone className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold">{tr("电话", "Phone")}</div>
                  <div className="truncate text-[11px] text-ink-soft">{c.phone}</div>
                </div>
              </a>
            )}
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={tr("联系我们", "Contact us")}
        className="grid h-14 w-14 place-items-center rounded-full bg-cta-gradient text-cta-foreground shadow-elevated transition hover:brightness-110"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
      </button>
    </div>
  );
}

function ContactRow({
  label,
  sub,
  qr,
  href,
  color,
  icon,
}: {
  label: string;
  sub?: string;
  qr?: string;
  href?: string | null;
  color: string;
  icon: React.ReactNode;
}) {
  const [showQr, setShowQr] = useState(false);
  const Body = (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background p-2.5 transition hover:border-brand/40">
      <span className="grid h-9 w-9 place-items-center rounded-lg" style={{ background: `${color}22`, color }}>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">{label}</div>
        {sub && <div className="truncate text-[11px] text-ink-soft">{sub}</div>}
      </div>
      {qr && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowQr((v) => !v);
          }}
          className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-ink-soft hover:bg-accent"
        >
          {showQr ? "×" : "QR"}
        </button>
      )}
    </div>
  );
  return (
    <div>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer noopener">
          {Body}
        </a>
      ) : (
        Body
      )}
      {qr && showQr && (
        <div className="mt-2 grid place-items-center rounded-xl border border-border bg-white p-2">
          <img src={qr} alt={`${label} QR`} className="h-40 w-40 object-contain" />
        </div>
      )}
    </div>
  );
}

function WeChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M8.5 4C4.36 4 1 6.91 1 10.5c0 2.08 1.13 3.92 2.88 5.12L3 18l2.5-1.32c.79.21 1.63.32 2.5.32.2 0 .4-.01.6-.02-.06-.32-.1-.65-.1-.98 0-3.31 3.13-6 7-6 .27 0 .53.01.79.04C15.92 6.97 12.55 4 8.5 4zM6 8.5a1 1 0 110 2 1 1 0 010-2zm5 0a1 1 0 110 2 1 1 0 010-2zM16 10c-3.31 0-6 2.24-6 5s2.69 5 6 5c.74 0 1.45-.11 2.1-.32L20 21l-.5-1.8C21.07 18.27 22 16.74 22 15c0-2.76-2.69-5-6-5zm-2 4a.75.75 0 110 1.5.75.75 0 010-1.5zm4 0a.75.75 0 110 1.5.75.75 0 010-1.5z" />
    </svg>
  );
}
function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-1 1.1-.2.2-.4.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.8-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.3 0-.5s-.7-1.6-.9-2.2c-.2-.6-.5-.5-.7-.5H8c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1.1 2.8 1.2 3c.2.2 2.1 3.3 5.2 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.2-1.4c1.4.8 3 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" />
    </svg>
  );
}
