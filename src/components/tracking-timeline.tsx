import { CheckCircle2, Circle, Globe, UserCog, PencilLine } from "lucide-react";

export type TrackingSource = "third_party" | "admin_action" | "admin_manual";

export interface TrackingEvent {
  status_zh: string;
  status_en: string;
  location_zh: string | null;
  location_en: string | null;
  event_time: string;
  source?: TrackingSource;
  source_ref?: string | null;
}

const SOURCE_META: Record<TrackingSource, { icon: typeof Globe; zh: string; en: string; cls: string }> = {
  third_party: { icon: Globe, zh: "承运商", en: "Carrier", cls: "bg-brand/10 text-brand" },
  admin_action: { icon: UserCog, zh: "系统操作", en: "System", cls: "bg-accent text-foreground" },
  admin_manual: { icon: PencilLine, zh: "客服备注", en: "Note", cls: "bg-cta/10 text-cta" },
};

export function TrackingTimeline({ events, lang }: { events: TrackingEvent[]; lang: "zh" | "en" }) {
  if (events.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-ink-soft">
        {lang === "zh" ? "运单已创建，等待入库扫描…" : "Shipment created. Waiting for warehouse scan…"}
      </div>
    );
  }
  // sort ascending by time (oldest first); latest highlighted at the bottom
  const sorted = [...events].sort((a, b) => +new Date(a.event_time) - +new Date(b.event_time));
  const lastIdx = sorted.length - 1;
  return (
    <ol className="relative space-y-0 p-6">
      {sorted.map((ev, i) => {
        const active = i === lastIdx;
        const loc = lang === "zh" ? ev.location_zh : ev.location_en;
        const status = lang === "zh" ? ev.status_zh : ev.status_en;
        const src = SOURCE_META[(ev.source ?? "admin_manual") as TrackingSource];
        const SrcIcon = src.icon;
        return (
          <li key={i} className="relative flex gap-4 pb-6 last:pb-0">
            {i < lastIdx && (
              <span className="absolute left-[11px] top-7 h-full w-px bg-border" aria-hidden />
            )}
            <span className="relative z-10 mt-1">
              {active ? <CheckCircle2 className="h-6 w-6 text-success" /> : <Circle className="h-6 w-6 text-border" />}
            </span>
            <div className="flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <div className={`text-sm font-semibold ${active ? "text-foreground" : "text-ink-soft"}`}>{status}</div>
                {loc && <div className="text-xs text-ink-soft">· {loc}</div>}
                <span className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${src.cls}`}>
                  <SrcIcon className="h-3 w-3" />
                  {lang === "zh" ? src.zh : src.en}
                  {ev.source_ref && <span className="opacity-60">· {ev.source_ref}</span>}
                </span>
              </div>
              <div className="mt-1 font-mono text-xs text-ink-soft">
                {new Date(ev.event_time).toLocaleString(lang === "zh" ? "zh-CN" : "en-CA")}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
