import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyInfo } from "@/lib/company";
import { submitContactMessage } from "@/lib/contact.functions";
import { Mail, MapPin, Phone, Clock, Loader2, QrCode, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "联系我们 / Contact — SinoCargo" },
      {
        name: "description",
        content: "Contact SinoCargo — offices in Toronto and Guangzhou. Bilingual support, hours 9-21 EST / 21-09 CST.",
      },
      { property: "og:title", content: "Contact SinoCargo" },
      { property: "og:description", content: "Reach our bilingual team in Toronto and Guangzhou." },
    ],
  }),
  component: ContactPage,
});

const sb = supabase as any;

interface OfficeCfg {
  label_zh: string;
  label_en: string;
  address: string;
  phone: string;
  email: string;
  hours_zh: string;
  hours_en: string;
}
const OFFICE_FALLBACK: Record<"ca" | "cn", OfficeCfg> = {
  ca: {
    label_zh: "多伦多总部",
    label_en: "Toronto HQ",
    address: "200 King St W, Toronto, ON M5H 3T4",
    phone: "+1 (416) 000-0000",
    email: "",
    hours_zh: "周一至周六 9:00–21:00 EST",
    hours_en: "Mon–Sat 9:00–21:00 EST",
  },
  cn: {
    label_zh: "广州集运中心",
    label_en: "Guangzhou Warehouse",
    address: "广东省广州市白云区机场路 88 号",
    phone: "+86 20 0000-0000",
    email: "",
    hours_zh: "周一至周六 9:00–18:00 CST",
    hours_en: "Mon–Sat 9:00–18:00 CST",
  },
};

function QrCard({
  label,
  handle,
  qrUrl,
  onZoom,
}: {
  label: string;
  handle: string;
  qrUrl: string;
  onZoom: () => void;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5">
      {qrUrl ? (
        <button
          type="button"
          onClick={onZoom}
          className="group grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-background transition hover:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
          aria-label={label}
        >
          <img src={qrUrl} alt={label} className="h-full w-full object-contain transition group-hover:scale-105" />
        </button>
      ) : (
        <div className="grid h-24 w-24 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-background">
          <QrCode className="h-8 w-8 text-ink-soft/40" />
        </div>
      )}
      <div className="min-w-0">
        <div className="font-display text-sm font-bold">{label}</div>
        <div className="mt-1 truncate text-sm text-ink-soft">{handle || "—"}</div>
      </div>
    </div>
  );
}

function OfficeCard({ cfg, lang, region }: { cfg: OfficeCfg; lang: "zh" | "en"; region: "ca" | "cn" }) {
  const regionLabel = region === "ca" ? (lang === "zh" ? "加拿大" : "Canada") : lang === "zh" ? "中国" : "China";
  return (
    <div className="rounded-2xl border border-border bg-surface p-6">
      <div className="text-xs font-semibold uppercase tracking-wider text-brand">{regionLabel}</div>
      <h2 className="mt-2 font-display text-xl font-bold">{lang === "zh" ? cfg.label_zh : cfg.label_en}</h2>
      <ul className="mt-4 space-y-2 text-sm text-ink-soft">
        <li className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {cfg.address}
        </li>
        <li className="flex items-center gap-2">
          <Phone className="h-4 w-4" /> {cfg.phone}
        </li>
        {cfg.email && (
          <li className="flex items-center gap-2">
            <Mail className="h-4 w-4" /> {cfg.email}
          </li>
        )}
        <li className="flex items-center gap-2">
          <Clock className="h-4 w-4" /> {lang === "zh" ? cfg.hours_zh : cfg.hours_en}
        </li>
      </ul>
    </div>
  );
}

function mergeOffice(fallback: OfficeCfg, saved: Partial<OfficeCfg> | undefined): OfficeCfg {
  const out = { ...fallback };
  for (const k of Object.keys(fallback) as (keyof OfficeCfg)[]) {
    const v = saved?.[k];
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

function ContactPage() {
  const { t, lang } = useApp();
  const submitMessage = useServerFn(submitContactMessage);
  const company = useCompanyInfo();
  const [offices, setOffices] = useState(OFFICE_FALLBACK);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoomedQr, setZoomedQr] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    if (!zoomedQr) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomedQr(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomedQr]);

  useEffect(() => {
    sb.from("app_settings")
      .select("value")
      .eq("key", "contact_offices")
      .maybeSingle()
      .then(({ data }: any) => {
        if (!data?.value) return;
        setOffices({
          ca: mergeOffice(OFFICE_FALLBACK.ca, data.value.ca),
          cn: mergeOffice(OFFICE_FALLBACK.cn, data.value.cn),
        });
      });
  }, []);

  // A per-office email left blank in admin settings falls back to the
  // company-wide contact email rather than showing a blank row.
  const officeCa = { ...offices.ca, email: offices.ca.email || company.email };
  const officeCn = { ...offices.cn, email: offices.cn.email || company.email };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await submitMessage({ data: { name, email, phone, message } });
      toast.success(lang === "zh" ? "已收到！我们会尽快回复。" : "Received! We'll get back to you shortly.");
      setName("");
      setEmail("");
      setPhone("");
      setMessage("");
    } catch (err: any) {
      toast.error(err.message ?? (lang === "zh" ? "提交失败，请稍后重试" : "Submit failed, please try again"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:py-20">
      <h1 className="font-display text-4xl font-bold sm:text-5xl">{t("contact.title")}</h1>
      <p className="mt-3 max-w-2xl text-ink-soft">
        {lang === "zh"
          ? "邮件 1 小时内回复，工作日双语在线客服。"
          : "Email responses within 1 hour. Bilingual live chat on weekdays."}
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <OfficeCard cfg={officeCa} lang={lang} region="ca" />
        <OfficeCard cfg={officeCn} lang={lang} region="cn" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <QrCard
          label={lang === "zh" ? "微信" : "WeChat"}
          handle={company.wechat}
          qrUrl={company.wechat_qr_url}
          onZoom={() => setZoomedQr({ url: company.wechat_qr_url, label: lang === "zh" ? "微信" : "WeChat" })}
        />
        <QrCard
          label="WhatsApp"
          handle={company.whatsapp}
          qrUrl={company.whatsapp_qr_url}
          onZoom={() => setZoomedQr({ url: company.whatsapp_qr_url, label: "WhatsApp" })}
        />
      </div>

      {zoomedQr && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6" onClick={() => setZoomedQr(null)}>
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setZoomedQr(null)}
              className="absolute -right-3 -top-3 grid h-9 w-9 place-items-center rounded-full bg-surface text-ink shadow-elevated"
              aria-label={lang === "zh" ? "关闭" : "Close"}
            >
              <X className="h-5 w-5" />
            </button>
            <div className="rounded-2xl bg-white p-4 shadow-elevated">
              <img src={zoomedQr.url} alt={zoomedQr.label} className="max-h-[70vh] max-w-[80vw] object-contain" />
            </div>
            <div className="mt-3 text-center text-sm font-medium text-white">{zoomedQr.label}</div>
          </div>
        </div>
      )}

      <form className="mt-10 rounded-3xl border border-border bg-surface p-6 sm:p-8" onSubmit={submit}>
        <h2 className="font-display text-xl font-bold">{lang === "zh" ? "在线留言" : "Send a message"}</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <input
            required
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={lang === "zh" ? "您的姓名" : "Your name"}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <input
            required
            type="email"
            maxLength={120}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="h-11 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
          <input
            type="tel"
            maxLength={40}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={lang === "zh" ? "电话号码（可选）" : "Phone number (optional)"}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 sm:col-span-2"
          />
        </div>
        <textarea
          required
          maxLength={1000}
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={lang === "zh" ? "想咨询什么？" : "Tell us what you need…"}
          className="mt-4 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
        />
        <button
          type="submit"
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-cta-gradient px-6 py-3 text-sm font-semibold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {lang === "zh" ? "提交" : "Submit"}
        </button>
      </form>
    </div>
  );
}
