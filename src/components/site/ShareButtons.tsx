import { useState } from "react";
import { Facebook, Link2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/lib/i18n";

interface Props {
  url?: string;
  title?: string;
  image?: string;
}

export function ShareButtons({ url, title = "", image }: Props) {
  const { lang } = useApp();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const shareUrl = url ?? (typeof window !== "undefined" ? window.location.href : "");
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const enc = encodeURIComponent;
  const fbHref = `https://www.facebook.com/sharer/sharer.php?u=${enc(shareUrl)}`;
  const waHref = `https://wa.me/?text=${enc(`${title} ${shareUrl}`)}`;
  const xHref = `https://twitter.com/intent/tweet?url=${enc(shareUrl)}&text=${enc(title)}`;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${enc(shareUrl)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success(tr("链接已复制", "Link copied"));
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error(tr("复制失败", "Copy failed"));
    }
  };

  const openShare = (url: string) => {
    // Use noopener so it always opens as a real top-level new tab,
    // even from inside an iframe (avoids X-Frame-Options blocks).
    const win = window.open(url, "_blank", "noopener,noreferrer,width=680,height=560");
    if (!win) {
      // Popup blocked → fall back to top-frame navigation
      try {
        (window.top ?? window).location.href = url;
      } catch {
        window.location.href = url;
      }
    }
  };

  const btn = "inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-ink-soft transition hover:border-brand/50 hover:text-brand";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-soft">{tr("分享：", "Share:")}</span>

      {/* WeChat — QR */}
      <button onClick={() => setQrOpen(true)} aria-label="WeChat" title="WeChat" className={btn}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M8.5 4C4.36 4 1 6.91 1 10.5c0 2.08 1.13 3.92 2.88 5.12L3 18l2.5-1.32c.79.21 1.63.32 2.5.32.2 0 .4-.01.6-.02-.06-.32-.1-.65-.1-.98 0-3.31 3.13-6 7-6 .27 0 .53.01.79.04C15.92 6.97 12.55 4 8.5 4zM6 8.5a1 1 0 110 2 1 1 0 010-2zm5 0a1 1 0 110 2 1 1 0 010-2zM16 10c-3.31 0-6 2.24-6 5s2.69 5 6 5c.74 0 1.45-.11 2.1-.32L20 21l-.5-1.8C21.07 18.27 22 16.74 22 15c0-2.76-2.69-5-6-5z"/>
        </svg>
      </button>

      {/* Facebook */}
      <button onClick={() => openShare(fbHref)} aria-label="Facebook" title="Facebook" className={btn}>
        <Facebook className="h-4 w-4" />
      </button>

      {/* WhatsApp */}
      <button onClick={() => openShare(waHref)} aria-label="WhatsApp" title="WhatsApp" className={btn}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M17.5 14.4c-.3-.1-1.7-.8-2-.9-.3-.1-.5-.1-.7.1-.2.3-.8.9-1 1.1-.2.2-.4.2-.6.1-.3-.1-1.2-.5-2.3-1.4-.8-.8-1.4-1.7-1.6-2-.2-.3 0-.5.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.3 0-.5s-.7-1.6-.9-2.2c-.2-.6-.5-.5-.7-.5H8c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4s1.1 2.8 1.2 3c.2.2 2.1 3.3 5.2 4.6.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.2.2-1.4-.1-.1-.3-.2-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.8.5 3.5 1.3 5L2 22l5.2-1.4c1.4.8 3 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" />
        </svg>
      </button>

      {/* X / Twitter */}
      <button onClick={() => openShare(xHref)} aria-label="X" title="X" className={btn}>
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
          <path d="M18.244 2H21l-6.52 7.45L22 22h-6.828l-4.77-6.24L4.8 22H2.04l6.98-7.98L2 2h6.914l4.31 5.72L18.244 2zm-1.196 18h1.79L7.06 4H5.16l11.888 16z" />
        </svg>
      </button>

      {/* Copy link */}
      <button onClick={copy} aria-label={tr("复制链接", "Copy link")} title={tr("复制链接", "Copy link")} className={btn}>
        {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Link2 className="h-4 w-4" />}
      </button>

      {qrOpen && (
        <div
          onClick={() => setQrOpen(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-xs rounded-2xl border border-border bg-surface p-5 text-center shadow-elevated"
          >
            <button
              onClick={() => setQrOpen(false)}
              aria-label="Close"
              className="absolute right-3 top-3 rounded-full p-1 text-ink-soft hover:bg-accent"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="mb-2 font-display text-sm font-bold">
              {tr("微信扫一扫分享", "Scan with WeChat to share")}
            </div>
            <div className="mx-auto grid place-items-center rounded-xl bg-white p-3">
              <img src={qrSrc} alt="QR" className="h-52 w-52" />
            </div>
            {title && <div className="mt-3 line-clamp-2 text-xs text-ink-soft">{title}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
