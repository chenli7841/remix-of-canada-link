import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useApp } from "@/lib/i18n";
import { useCompanyInfo } from "@/lib/company";
import { submitContactMessage } from "@/lib/contact.functions";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2,
  Plane,
  ShieldCheck,
  Clock,
  DollarSign,
  PackageCheck,
  Star,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

const sb = supabase as any;

interface PromoLandingCfg {
  enabled: boolean;
  amount_cad: number;
  currency: string;
  headline_zh: string;
  headline_en: string;
  subtext_zh: string;
  subtext_en: string;
}
const PROMO_DEFAULT: PromoLandingCfg = {
  enabled: true,
  amount_cad: 10,
  currency: "CA$",
  headline_zh: "新客首单立减",
  headline_en: "New customer first-order discount",
  subtext_zh: "客服会在 24 小时内通过微信 / WhatsApp 联系您，并发送优惠码。",
  subtext_en: "We'll reach out within 24h via WeChat / WhatsApp with your code.",
};

export const Route = createFileRoute("/promo")({
  head: () => ({
    meta: [
      { title: "首单立减 CA$10 · 中国到加拿大集运 + 采购 | SinoCargo" },
      {
        name: "description",
        content:
          "自营商城 + 国际集运一站搞定。源头好物、双币结算、全程可追踪，平均 7–12 天送达加拿大。留资即领首单立减 CA$10。",
      },
      { property: "og:title", content: "首单立减 CA$10 · 中国到加拿大集运 + 采购" },
      {
        property: "og:description",
        content: "源头好物 + 国际集运，7–12 天送达加拿大。留资即领首单立减 CA$10。",
      },
      { property: "og:type", content: "website" },
      {
        property: "og:url",
        content: "https://china-to-canada-shopper.lovable.app/promo",
      },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "canonical",
        href: "https://china-to-canada-shopper.lovable.app/promo",
      },
    ],
  }),
  component: PromoPage,
});

function PromoPage() {
  const { lang } = useApp();
  const c = useCompanyInfo();
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const submit = useServerFn(submitContactMessage);

  const promoQ = useQuery({
    queryKey: ["app-settings", "promo_landing"],
    queryFn: async () => {
      const { data } = await sb
        .from("app_settings")
        .select("value")
        .eq("key", "promo_landing")
        .maybeSingle();
      return { ...PROMO_DEFAULT, ...((data?.value ?? {}) as PromoLandingCfg) };
    },
    staleTime: 5 * 60 * 1000,
  });
  const promo = promoQ.data ?? PROMO_DEFAULT;
  const offerLabel = promo.enabled
    ? `${tr(promo.headline_zh, promo.headline_en)} ${promo.currency}${promo.amount_cad}`
    : "";

  const [utm, setUtm] = useState<Record<string, string>>({});
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    const o: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
      const v = sp.get(k);
      if (v) o[k] = v;
    }
    setUtm(o);
  }, []);

  const [form, setForm] = useState({ name: "", contact: "", email: "", need: "" });
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const src = useMemo(() => utm.utm_source || "promo", [utm]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.contact.trim()) {
      toast.error(tr("请填写姓名和联系方式", "Please fill in name and contact"));
      return;
    }
    setLoading(true);
    try {
      const message = [
        `[Landing /promo] source=${src}`,
        `姓名：${form.name}`,
        `联系方式（微信/WhatsApp/电话）：${form.contact}`,
        `采购需求：${form.need || "(未填)"}`,
        Object.keys(utm).length ? `UTM：${JSON.stringify(utm)}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      await submit({
        data: {
          name: form.name.trim(),
          email: form.email.trim() || `${form.contact.replace(/[^\w]/g, "")}@lead.local`,
          phone: form.contact.trim(),
          message,
        },
      });

      // Fire tracking events (guarded)
      try {
        (window as any).fbq?.("track", "Lead");
        (window as any).ttq?.track?.("SubmitForm");
        (window as any).gtag?.("event", "generate_lead", { source: src });
      } catch {}

      setDone(true);
      toast.success(tr("已收到！客服会尽快联系您", "Received! We'll reach out shortly"));
    } catch (err: any) {
      toast.error(err?.message ?? tr("提交失败，请稍后再试", "Submit failed, please retry"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-background">
      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-to-br from-brand/10 via-background to-cta/10">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 md:grid-cols-2 md:py-20">
          <div className="flex flex-col justify-center">
            {promo.enabled && (
              <span className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-cta/40 bg-cta/10 px-3 py-1 text-xs font-semibold text-cta">
                <Star className="h-3.5 w-3.5" />
                {tr("限时活动 · ", "Launch offer · ")}
                {offerLabel}
              </span>
            )}
            <h1 className="font-display text-4xl font-extrabold leading-tight text-foreground md:text-5xl">
              {tr("中国到加拿大", "China → Canada")}
              <br />
              <span className="text-brand-gradient">
                {tr("采购 + 集运 一站搞定", "Sourcing + Shipping, all-in-one")}
              </span>
            </h1>
            <p className="mt-5 max-w-lg text-base text-ink-soft md:text-lg">
              {tr(
                "自营商城精选源头好物，双币结算、全程可追踪，平均 7–12 天送达加拿大。留下联系方式，客服 1v1 帮你搞定采购与运输。",
                "Curated goods at source prices. Dual-currency checkout, end-to-end tracking, 7–12 days to Canada. Drop your contact — we'll help you 1-on-1.",
              )}
            </p>

            <div className="mt-8 grid grid-cols-3 gap-4 border-t border-border pt-6 text-center">
              <Stat n="7–12" label={tr("天送达", "days")} />
              <Stat n="10,000+" label={tr("成功订单", "orders")} />
              <Stat n="4.9★" label={tr("客户评价", "rating")} />
            </div>
          </div>

          {/* FORM CARD */}
          <div className="rounded-3xl border border-border bg-surface p-6 shadow-elevated md:p-8">
            {done ? (
              <div className="flex h-full flex-col items-center justify-center py-10 text-center">
                <div className="grid h-16 w-16 place-items-center rounded-full bg-brand/10 text-brand">
                  <PackageCheck className="h-8 w-8" />
                </div>
                <h3 className="mt-4 font-display text-xl font-bold">
                  {tr("提交成功！", "Thanks!")}
                </h3>
                <p className="mt-2 max-w-xs text-sm text-ink-soft">
                  {tr(promo.subtext_zh, promo.subtext_en)}
                </p>
                <Link
                  to="/products"
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-cta-gradient px-5 py-2.5 text-sm font-semibold text-cta-foreground shadow-elevated hover:brightness-110"
                >
                  {tr("先逛逛商城", "Browse the store")}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            ) : (
              <>
                <h2 className="font-display text-xl font-bold">
                  {promo.enabled
                    ? tr(`免费领取首单 ${promo.currency}${promo.amount_cad} 优惠`, `Claim your ${promo.currency}${promo.amount_cad} first-order coupon`)
                    : tr("免费咨询报价", "Get a free quote")}
                </h2>
                <p className="mt-1 text-xs text-ink-soft">
                  {tr("30 秒填写，无需注册。", "30 seconds. No signup needed.")}
                </p>
                <form onSubmit={onSubmit} className="mt-5 space-y-3">
                  <Field
                    label={tr("姓名 / 昵称", "Name")}
                    required
                    value={form.name}
                    onChange={(v) => setForm({ ...form, name: v })}
                    placeholder={tr("张先生", "e.g. Jamie")}
                    maxLength={80}
                  />
                  <Field
                    label={tr("微信 / WhatsApp / 电话", "WeChat / WhatsApp / Phone")}
                    required
                    value={form.contact}
                    onChange={(v) => setForm({ ...form, contact: v })}
                    placeholder={tr("最方便联系您的方式", "How we should reach you")}
                    maxLength={80}
                  />
                  <Field
                    label={tr("邮箱（选填）", "Email (optional)")}
                    type="email"
                    value={form.email}
                    onChange={(v) => setForm({ ...form, email: v })}
                    placeholder="you@example.com"
                    maxLength={120}
                  />
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-ink-soft">
                      {tr("采购需求（选填）", "What you want to source (optional)")}
                    </label>
                    <textarea
                      value={form.need}
                      onChange={(e) => setForm({ ...form, need: e.target.value })}
                      rows={2}
                      maxLength={500}
                      placeholder={tr(
                        "例如：小家电、母婴用品、批发 xx 商品…",
                        "e.g. small appliances, baby goods, bulk xx…",
                      )}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-brand"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={loading}
                    className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-cta-gradient px-4 py-3 text-sm font-bold text-cta-foreground shadow-elevated transition hover:brightness-110 disabled:opacity-60"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        {promo.enabled
                          ? tr(`立即领取 ${promo.currency}${promo.amount_cad}`, `Get my ${promo.currency}${promo.amount_cad} coupon`)
                          : tr("立即咨询", "Contact us now")}
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                  <p className="text-center text-[11px] text-ink-soft">
                    {tr(
                      "提交即表示同意我们通过您留下的方式与您联系。",
                      "By submitting you agree we may contact you.",
                    )}
                  </p>
                </form>
              </>
            )}
          </div>
        </div>
      </section>

      {/* PAIN → SOLUTION */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center font-display text-3xl font-bold md:text-4xl">
          {tr("加拿大华人海淘的 4 个头疼事，我们全包了", "4 pains of shopping from China — we handle all")}
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          <PainCard
            icon={<DollarSign className="h-5 w-5" />}
            title={tr("价格贵", "Overpriced")}
            body={tr("源头厂商直采，比零售低 40–70%。", "Direct-from-source pricing, 40–70% below retail.")}
          />
          <PainCard
            icon={<Plane className="h-5 w-5" />}
            title={tr("运费坑", "Hidden fees")}
            body={tr("按 kg 透明计费，走加拿大清关，含税到手。", "Per-kg transparent rate, duties included, delivered.")}
          />
          <PainCard
            icon={<Clock className="h-5 w-5" />}
            title={tr("时效慢", "Slow")}
            body={tr("空运 7–12 天，海运 30–45 天，全程可追踪。", "Air 7–12 days, sea 30–45 days, full tracking.")}
          />
          <PainCard
            icon={<ShieldCheck className="h-5 w-5" />}
            title={tr("怕被坑", "Trust issue")}
            body={tr("中加双仓 + 中文客服 + 丢件全赔。", "Warehouses in both countries + bilingual support + full compensation.")}
          />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="bg-accent/30">
        <div className="mx-auto max-w-6xl px-4 py-16">
          <h2 className="text-center font-display text-3xl font-bold md:text-4xl">
            {tr("3 步搞定跨境采购", "3 steps to cross-border shopping")}
          </h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              {
                n: "1",
                t: tr("留资 or 逛商城", "Contact us or browse"),
                b: tr("填表 or 直接下单，客服 1v1 帮你选品。", "Submit the form, or shop directly. 1-on-1 support."),
              },
              {
                n: "2",
                t: tr("我们采购 + 集运", "We source & ship"),
                b: tr("广州仓统一质检、打包、发运到加拿大。", "QC & pack in our GZ warehouse, ship to Canada."),
              },
              {
                n: "3",
                t: tr("送到你家门口", "Delivered"),
                b: tr("加拿大本地派送，含税到手，全程通知。", "Local delivery in Canada with real-time notifications."),
              },
            ].map((s) => (
              <div
                key={s.n}
                className="relative rounded-2xl border border-border bg-background p-6 shadow-soft"
              >
                <div className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-brand text-background font-display font-bold">
                  {s.n}
                </div>
                <div className="font-display text-lg font-bold">{s.t}</div>
                <p className="mt-1 text-sm text-ink-soft">{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-center font-display text-3xl font-bold md:text-4xl">
          {tr("加拿大华人都在用", "Loved by Chinese Canadians")}
        </h2>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {[
            {
              n: tr("Linda · 多伦多", "Linda · Toronto"),
              q: tr("给宝宝买的辅食机，比 Amazon 便宜一半，10 天就到。", "Baby food processor: half the Amazon price, arrived in 10 days."),
            },
            {
              n: tr("Kevin · 温哥华", "Kevin · Vancouver"),
              q: tr("开餐厅进货用他家，量大有专属客服。", "I stock my restaurant here — dedicated rep for bulk."),
            },
            {
              n: tr("Amy · 蒙特利尔", "Amy · Montreal"),
              q: tr("双币结算太方便了，物流一直在更新，很安心。", "Dual-currency checkout is a lifesaver, tracking updates constantly."),
            },
          ].map((r) => (
            <div key={r.n} className="rounded-2xl border border-border bg-surface p-6">
              <div className="mb-2 flex text-cta">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <p className="text-sm text-foreground">"{r.q}"</p>
              <div className="mt-3 text-xs font-semibold text-ink-soft">— {r.n}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-brand-gradient">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center text-background">
          <h2 className="font-display text-3xl font-extrabold md:text-4xl">
            {tr("现在就开始省钱", "Start saving today")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-sm opacity-90 md:text-base">
            {promo.enabled
              ? tr(
                  `留下联系方式，24 小时内客服联系您并发送 ${promo.currency}${promo.amount_cad} 首单优惠码。`,
                  `Leave your contact — we'll reach out within 24h with your ${promo.currency}${promo.amount_cad} coupon.`,
                )
              : tr(
                  "留下联系方式，24 小时内客服 1v1 帮您搞定采购与运输。",
                  "Leave your contact — 1-on-1 support within 24h.",
                )}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <a
              href="#top"
              onClick={(e) => {
                e.preventDefault();
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
              className="inline-flex items-center gap-2 rounded-full bg-background px-6 py-3 text-sm font-bold text-foreground shadow-elevated hover:brightness-95"
            >
              {tr("立即领取优惠", "Claim my coupon")}
              <ArrowRight className="h-4 w-4" />
            </a>
            <Link
              to="/products"
              className="inline-flex items-center gap-2 rounded-full border border-background/40 px-6 py-3 text-sm font-bold text-background hover:bg-background/10"
            >
              {tr("先逛商城", "Browse store")}
            </Link>
          </div>
          {(c.wechat || c.whatsapp) && (
            <p className="mt-6 text-xs opacity-80">
              {tr("或直接添加", "Or add us:")}
              {c.wechat && ` 微信 ${c.wechat}`}
              {c.wechat && c.whatsapp && " · "}
              {c.whatsapp && `WhatsApp ${c.whatsapp}`}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div className="font-display text-2xl font-extrabold text-brand-gradient md:text-3xl">{n}</div>
      <div className="mt-1 text-xs text-ink-soft">{label}</div>
    </div>
  );
}

function PainCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5 transition hover:-translate-y-1 hover:shadow-elevated">
      <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand">
        {icon}
      </div>
      <div className="font-display text-base font-bold">{title}</div>
      <p className="mt-1 text-sm text-ink-soft">{body}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
  maxLength?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-ink-soft">
        {label} {required && <span className="text-cta">*</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        maxLength={maxLength}
        className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-brand"
      />
    </div>
  );
}
