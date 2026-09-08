import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { TrackingTimeline } from "@/components/tracking-timeline";
import { METHOD_LABEL } from "@/lib/admin-shared";
import { Loader2, Box, Ruler, Weight, Hash, Plane, Ship, Truck, Archive, Layers, Calendar, MapPin, ChevronDown } from "lucide-react";

const sb = supabase as any;

interface Waybill {
  id: string;
  waybill_no: string;
  intl_tracking_no: string | null;
  box_no: string | null;
  pallet_no: string | null;
  length_cm: number | null;
  width_cm: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  status: string;
  batch_no: string | null;
  shipping_method: string | null;
  eta: string | null;
  items_summary?: { name: string; quantity: number }[] | null;
}

const STATUS_LABEL: Record<string, [string, string]> = {
  procurement:  ["代采购", "Procurement"],
  pending:      ["已发货等待入库", "Shipped · awaiting intake"],
  received:     ["已到达集运仓", "Received at warehouse"],
  storage:      ["仓储中", "In storage"],
  packed:       ["已打包", "Packed"],
  shipped:      ["运输中", "In transit"],
  arrived:      ["清关中", "Clearing customs"],
  in_transit:   ["正在派送", "Out for delivery"],
  ready_pickup: ["待取货", "Ready for pickup"],
  delivered:    ["已完成", "Completed"],
  cancelled:    ["已取消", "Cancelled"],
};

function methodIcon(method?: string | null) {
  switch (method) {
    case "sea": return <Ship className="h-3 w-3" />;
    case "truck": return <Truck className="h-3 w-3" />;
    case "storage": return <Archive className="h-3 w-3" />;
    case "express": return <Box className="h-3 w-3" />;
    default: return <Plane className="h-3 w-3" />;
  }
}
export function WaybillsList({
  ownerKind, ownerId, lang,
}: { ownerKind: "order" | "forwarding"; ownerId: string; lang: "zh" | "en" }) {
  const tr = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const [rows, setRows] = useState<Waybill[] | null>(null);

  useEffect(() => {
    (async () => {
      const col = ownerKind === "order" ? "order_id" : "forwarding_id";
      const { data } = await sb.from("waybills").select("*").eq(col, ownerId).order("created_at");
      setRows(data ?? []);
    })();
  }, [ownerKind, ownerId]);

  if (rows === null) {
    return <div className="grid place-items-center py-6"><Loader2 className="h-5 w-5 animate-spin text-ink-soft" /></div>;
  }
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-ink-soft">{tr("暂无运单", "No waybills yet")}</div>;
  }

  return (
    <ul className="space-y-3">
      {rows.map((w, i) => (
        <WaybillRow key={w.id} w={w} index={i} lang={lang} tr={tr} />
      ))}
    </ul>
  );
}

function WaybillRow({ w, index, lang, tr }: { w: Waybill; index: number; lang: "zh" | "en"; tr: (zh: string, en: string) => string }) {
  const [open, setOpen] = useState(false);
  const [track, setTrack] = useState<any | null | "err">(null);
  const dims = [w.length_cm, w.width_cm, w.height_cm].filter((v) => v != null);
  const label = STATUS_LABEL[w.status] ?? [w.status, w.status];

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && track === null && w.intl_tracking_no) {
      const { data, error } = await sb.rpc("lookup_shipment", { _tracking_no: w.intl_tracking_no });
      if (error || !data) setTrack("err"); else setTrack(data);
    } else if (next && !w.intl_tracking_no) {
      setTrack("err");
    }
  };

  return (
    <li className="rounded-xl border border-border bg-background/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
          <Box className="h-3 w-3" />#{index + 1}
        </span>
        <span className="font-mono text-xs">{w.waybill_no}</span>
        <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold">
          {lang === "zh" ? label[0] : label[1]}
        </span>
      </div>

      {Array.isArray(w.items_summary) && w.items_summary.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {w.items_summary.map((it, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full bg-accent/50 px-2 py-0.5 text-[11px]">
              <Box className="h-3 w-3 text-brand"/>{it.name} <span className="text-ink-soft">×{it.quantity}</span>
            </span>
          ))}
        </div>
      )}

      {/* Merged: batch / method / eta */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-4">
        <Cell icon={methodIcon(w.shipping_method)} label={tr("方式", "Method")}
              value={METHOD_LABEL[w.shipping_method ?? "air"] ?? w.shipping_method ?? "—"} />
        <Cell icon={<Layers className="h-3 w-3" />} label={tr("批次号", "Batch")}
              value={w.batch_no ? <span className="font-mono">{w.batch_no}</span> : "—"} />
        <Cell icon={<Calendar className="h-3 w-3" />} label={tr("预计到达", "ETA")}
              value={w.eta ? new Date(w.eta).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-CA") : tr("待定", "TBD")} />
        {w.intl_tracking_no && (
          <Cell icon={<Hash className="h-3 w-3" />} label={tr("国际单号", "Intl")}
                value={<span className="font-mono">{w.intl_tracking_no}</span>} />
        )}
        {w.pallet_no && <Cell icon={<Hash className="h-3 w-3" />} label={tr("托盘", "Pallet")} value={w.pallet_no} />}
        {dims.length === 3 && (
          <Cell icon={<Ruler className="h-3 w-3" />} label={tr("尺寸 (cm)", "L×W×H (cm)")}
                value={`${w.length_cm}×${w.width_cm}×${w.height_cm}`} />
        )}
        {w.weight_kg != null && (
          <Cell icon={<Weight className="h-3 w-3" />} label={tr("重量", "Weight")}
                value={`${Number(w.weight_kg).toFixed(2)} kg`} />
        )}
      </dl>

      {/* Tracking timeline dropdown */}
      <div className="mt-3">
        <button
          onClick={toggle}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1.5 text-[11px] font-medium hover:border-brand hover:text-brand"
        >
          <MapPin className="h-3 w-3" />
          {tr("物流轨迹", "Tracking")}
          <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="mt-2 overflow-hidden rounded-xl border border-border bg-background">
            {track === null && (
              <div className="grid place-items-center py-4"><Loader2 className="h-4 w-4 animate-spin text-ink-soft" /></div>
            )}
            {track === "err" && (
              <div className="py-4 text-center text-xs text-ink-soft">{tr("暂无轨迹数据", "No tracking data yet")}</div>
            )}
            {track && track !== "err" && (
              <TrackingTimeline events={(track as any).events ?? []} lang={lang} />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function Cell({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-ink-soft">{icon}{label}</dt>
      <dd className="mt-0.5 truncate font-semibold">{value}</dd>
    </div>
  );
}
