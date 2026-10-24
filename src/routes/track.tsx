import {lookupOrderTracking,OrderTrackingResultView,type OrderTrackingResult} from "@/components/order-tracking";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useApp } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { TrackingTimeline, type TrackingEvent } from "@/components/tracking-timeline";
import { Search, Loader2 } from "lucide-react";

export const Route = createFileRoute("/track")({
  head: () => ({
    meta: [
      { title: "物流追踪 / Track — SinoCargo" },
      {
        name: "description",
        content: "Enter your SinoCargo tracking number to see real-time shipment status from China to Canada.",
      },
      { property: "og:title", content: "Track your shipment — SinoCargo" },
      { property: "og:description", content: "Real-time China-to-Canada shipment tracking." },
    ],
  }),
  component: TrackPage,
});

interface ShipmentLookup {
  tracking_no: string;
  shipping_method: string;
  carrier: string | null;
  status: string;
  current_location: string | null;
  eta: string | null;
  created_at: string;
  events: TrackingEvent[];
}

function TrackPage() {
  const { t, lang } = useApp();
  const [no, setNo] = useState("");
  const [result, setResult] = useState<OrderTrackingResult | "notfound" | null>(null);
  const [error,setError]=useState("");
  const [busy, setBusy] = useState(false);
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = no.trim();
    if (!q) return;
    setBusy(true);
    setError(""); setResult(null);
    try { setResult(await lookupOrderTracking(q) ?? "notfound"); }
    catch(e:any){setError(e.message?.includes("关联多个订单") ? tr("该单号关联多个订单，请使用完整订单号查询", "Multiple orders match. Please enter the full order number.") : tr("查询失败，请重试","Lookup failed. Please retry."));}
    finally {setBusy(false);}
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:py-20">
      <header className="text-center">
        <h1 className="font-display text-4xl font-bold sm:text-5xl">{t("track.title")}</h1>
        <p className="mt-3 text-ink-soft">{t("track.sub")}</p>
      </header>

      <form onSubmit={submit} className="mx-auto mt-10 flex max-w-2xl gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
          <input
            value={no}
            onChange={(e) => setNo(e.target.value)}
            placeholder={t("track.placeholder")}
            className="h-12 w-full rounded-full border border-border bg-surface pl-11 pr-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 text-sm font-semibold text-background transition hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("track.btn")}
        </button>
      </form>

      {result === "notfound" && (
        <div className="mx-auto mt-8 max-w-2xl rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-center text-sm text-destructive">
          {t("track.notfound")}
        </div>
      )}

      {error && <p role="alert" className="mt-6 text-center text-sm text-red-500">{error}</p>}
      {result && result !== "notfound" && <section className="mt-8 rounded-2xl border border-border bg-surface">
        <h2 className="break-all border-b border-border p-5 text-xl font-bold">{tr("订单号","Order")}：{result.order_no}</h2>
        <OrderTrackingResultView key={result.order_no} result={result} lang={lang}/>
      </section>}
    </div>
  );
}
