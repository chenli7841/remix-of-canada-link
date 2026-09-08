import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useApp } from "@/lib/i18n";
import { supabase } from "@/integrations/supabase/client";
import { TrackingTimeline, type TrackingEvent } from "@/components/tracking-timeline";
import { Plane, Ship, Search, Loader2 } from "lucide-react";

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
  const [result, setResult] = useState<ShipmentLookup | "notfound" | null>(null);
  const [busy, setBusy] = useState(false);
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = no.trim();
    if (!q) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("track_by_any_no", { _input: q });
    setBusy(false);
    if (error) return setResult("notfound");
    if (!data) return setResult("notfound");
    setResult(data as unknown as ShipmentLookup);
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

      {result && result !== "notfound" && (
        <div className="mt-10 overflow-hidden rounded-3xl border border-border bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-hero p-6 text-white">
            <div>
              <div className="text-xs uppercase tracking-wider text-white/60">Tracking #</div>
              <div className="font-display text-2xl font-bold">{result.tracking_no}</div>
              {result.current_location && (
                <div className="mt-1 text-sm text-white/80">
                  {tr("当前位置", "Current")}: {result.current_location}
                </div>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm backdrop-blur">
                {result.shipping_method === "sea" ? <Ship className="h-4 w-4" /> : <Plane className="h-4 w-4" />}
                {t(result.shipping_method === "sea" ? "shipping.sea" : "shipping.air")}
                {result.eta && (
                  <>
                    <span className="mx-2 text-white/40">·</span>ETA {result.eta}
                  </>
                )}
              </div>
              {result.carrier && <div className="text-xs text-white/60">{result.carrier}</div>}
            </div>
          </div>

          <TrackingTimeline events={result.events} lang={lang} />
        </div>
      )}
    </div>
  );
}
