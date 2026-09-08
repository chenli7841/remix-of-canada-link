import { Check, ChevronRight, Circle, XCircle } from "lucide-react";

export type WorkflowStep = { key: string; label: string; hint?: string };

/** Canonical waybill / forwarding lifecycle. */
export const WAYBILL_FLOW: WorkflowStep[] = [
  { key: "procurement", label: "代采购", hint: "确认采购并录入国内单号" },
  { key: "pending", label: "已发货等待入库", hint: "等待到达国内仓" },
  { key: "received", label: "已到达集运仓", hint: "入库扫描、量尺" },
  { key: "storage", label: "仓储中", hint: "加入箱号 / 托盘" },
  { key: "packed", label: "已打包", hint: "加入托盘、批次" },
  { key: "shipped", label: "已发出", hint: "跨境运输，等待到港" },
  { key: "arrived", label: "清关中", hint: "清关完成后加入派送队列" },
  { key: "ready_pickup", label: "待派送 / 待取货", hint: "客户扣款并派送" },
  { key: "in_transit", label: "正在派送", hint: "上传派送轨迹" },
  { key: "delivered", label: "已完成", hint: "订单结束" },
];

/** Shop order lifecycle (before it becomes a waybill). */
export const SHOP_FLOW: WorkflowStep[] = [
  { key: "procurement", label: "代采购", hint: "采购商品，确认发货" },
  { key: "pending", label: "已发货等待入库", hint: "国内仓等待收货" },
  { key: "received", label: "已到达集运仓", hint: "入库、量尺" },
  { key: "storage", label: "仓储中", hint: "加入箱号 / 托盘" },
  { key: "packed", label: "已打包", hint: "加入批次" },
  { key: "shipped", label: "运输中", hint: "跨境运输" },
  { key: "arrived", label: "清关中", hint: "清关完成后加入派送队列" },
  { key: "ready_pickup", label: "待取货 / 待派送", hint: "客户扣款并派送" },
  { key: "in_transit", label: "正在派送", hint: "派送中" },
  { key: "delivered", label: "已完成", hint: "订单结束" },
];

/** Batch lifecycle (发运批次). */
export const BATCH_FLOW: WorkflowStep[] = [
  { key: "draft", label: "草稿", hint: "组包中，可增删运单/箱号/托盘" },
  { key: "locked", label: "已锁定", hint: "费用已冻结，准备发运" },
  { key: "shipped", label: "已发出", hint: "跨境运输中" },
  { key: "arrived", label: "已到港", hint: "清关 / 分拨" },
  { key: "closed", label: "已关闭", hint: "本批次完成，进入客户派送" },
];

export function WorkflowStepper({
  flow,
  current,
  title = "流程进度",
}: {
  flow: WorkflowStep[];
  current: string | null | undefined;
  title?: string;
}) {
  const cancelled = current === "cancelled";
  const idx = flow.findIndex((s) => s.key === current);
  const next = idx >= 0 && idx < flow.length - 1 ? flow[idx + 1] : null;
  const cur = idx >= 0 ? flow[idx] : null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-200">{title}</div>
        {cancelled ? (
          <div className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-300">
            <XCircle className="h-3 w-3" /> 已取消
          </div>
        ) : next ? (
          <div className="text-[11px] text-slate-400">
            下一步：
            <span className="ml-1 font-semibold text-brand">{next.label}</span>
            {next.hint && <span className="ml-1 text-slate-500">· {next.hint}</span>}
          </div>
        ) : cur ? (
          <div className="text-[11px] text-emerald-300">流程已完成</div>
        ) : null}
      </div>

      <ol className="flex flex-wrap items-center gap-y-2">
        {flow.map((s, i) => {
          const done = !cancelled && idx >= 0 && i < idx;
          const active = !cancelled && i === idx;
          const upcoming = cancelled || idx < 0 || i > idx;
          return (
            <li key={s.key} className="flex items-center">
              <div
                className={
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] " +
                  (active
                    ? "border-brand/60 bg-brand/15 text-brand"
                    : done
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-white/10 bg-white/[0.02] text-slate-500")
                }
                title={s.hint}
              >
                {done ? (
                  <Check className="h-3 w-3" />
                ) : active ? (
                  <span className="grid h-3 w-3 place-items-center rounded-full bg-brand text-[9px] font-bold text-white">
                    {i + 1}
                  </span>
                ) : (
                  <Circle className="h-3 w-3" />
                )}
                <span className={upcoming ? "opacity-70" : ""}>{s.label}</span>
              </div>
              {i < flow.length - 1 && (
                <ChevronRight className="mx-0.5 h-3 w-3 text-slate-600" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
