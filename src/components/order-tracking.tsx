import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { TrackingTimeline, type TrackingEvent } from "./tracking-timeline";
export type OrderTrackingResult = {
  order_no: string;
  status: string;
  events: TrackingEvent[];
  waybills: { id: string; waybill_no: string; status: string; events: TrackingEvent[] }[];
};
export async function lookupOrderTracking(no: string): Promise<OrderTrackingResult | null> {
  const { data, error } = await (supabase as any).rpc("track_order_by_any_no", {
    _input: no.trim(),
  });
  if (error) throw new Error(error.message);
  return data;
}
const statusLabels: Record<string, [string, string]> = {
  procurement: ["代采购", "Procurement"],
  pending: ["已发货等待入库", "Awaiting warehouse receipt"],
  received: ["已到达集运仓", "Received at warehouse"],
  storage: ["仓储中", "In storage"],
  packed: ["已打包", "Packed"],
  shipped: ["已发出", "Shipped"],
  arrived: ["清关中", "Customs clearance"],
  in_transit: ["正在派送", "Out for delivery"],
  ready_pickup: ["待取货", "Ready for pickup"],
  delivered: ["已完成", "Delivered"],
  cancelled: ["已取消", "Cancelled"],
};
export function OrderTrackingDisclosure({
  no,
  lang,
  defaultOpen = false,
}: {
  no: string;
  lang: "zh" | "en";
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer break-all p-3 text-sm">{no}</summary>
      {open && <OrderTracking no={no} lang={lang} />}
    </details>
  );
}
export function OrderTrackingResultView({
  result,
  lang,
  primaryOnly = false,
  admin = false,
}: {
  result: OrderTrackingResult;
  lang: "zh" | "en";
  primaryOnly?: boolean;
  admin?: boolean;
}) {
  if (primaryOnly || !result.waybills.length)
    return <TrackingTimeline events={result.events} lang={lang} admin={admin} />;
  return (
    <div className="space-y-3 p-3 sm:p-5">
      {result.waybills.map((w, i) => (
        <details
          key={result.order_no + ":" + w.id}
          open={i === 0}
          className={admin ? "rounded-xl border border-slate-700 bg-slate-900/50" : "rounded-xl border border-border"}
        >
          <summary className={`cursor-pointer break-all rounded-xl p-4 text-sm font-semibold ${admin ? "text-sky-300 hover:bg-slate-800/60 focus-visible:outline-sky-400" : ""}`}>
            <span>{w.waybill_no}</span>
            <span className={`ml-3 inline-block text-xs font-normal ${admin ? "rounded-full border border-sky-400/25 bg-sky-400/10 px-2 py-0.5 text-sky-200" : "text-ink-soft"}`}>
              {statusLabels[w.status]?.[lang === "zh" ? 0 : 1] ?? w.status}
            </span>
          </summary>
          <TrackingTimeline events={w.events} lang={lang} admin={admin} />
        </details>
      ))}
    </div>
  );
}
export function OrderTracking({
  no,
  lang,
  primaryOnly = true,
  admin = false,
  waybillId,
}: {
  no: string;
  lang: "zh" | "en";
  primaryOnly?: boolean;
  admin?: boolean;
  waybillId?: string;
}) {
  const q = useQuery({
    queryKey: ["unified-order-tracking", no],
    queryFn: () => lookupOrderTracking(no),
    enabled: !!no,
    refetchInterval: 30000,
  });
  if (q.isPending)
    return <p className="p-4 text-sm">{lang === "zh" ? "正在读取轨迹…" : "Loading tracking…"}</p>;
  if (q.isError)
    return (
      <div className="p-4 text-sm text-red-500">
        {lang === "zh" ? "轨迹读取失败，请重试" : "Tracking unavailable. Please retry."}
        <button className="ml-3 underline" onClick={() => q.refetch()}>
          {lang === "zh" ? "重试" : "Retry"}
        </button>
      </div>
    );
  if (!q.data)
    return (
      <p className="p-4 text-sm">
        {lang === "zh" ? "未找到关联订单" : "Associated order not found"}
      </p>
    );
  if (waybillId)
    return (
      <TrackingTimeline
        events={q.data.waybills.find((w) => w.id === waybillId)?.events ?? []} admin={admin}
        lang={lang}
      />
    );
  return <OrderTrackingResultView result={q.data} lang={lang} primaryOnly={primaryOnly} admin={admin} />;
}
