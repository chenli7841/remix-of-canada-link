import { Link } from "@tanstack/react-router";

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "已发货等待入库", paid: "已支付", procurement: "代采购",
  received: "已到达集运仓", storage: "仓储中", packed: "已打包",
  shipped: "运输中", arrived: "清关中", in_transit: "正在派送",
  ready_pickup: "待取货", processing: "处理中",
  delivered: "已完成", cancelled: "已取消",
};
export const ORDER_STATUS_COLOR: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  paid: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  procurement: "bg-pink-500/15 text-pink-300 border-pink-500/30",
  received: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  storage: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  packed: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  shipped: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  arrived: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  in_transit: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  ready_pickup: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  processing: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  delivered: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  cancelled: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};
export const WAYBILL_STATUS_LABEL: Record<string, string> = {
  procurement: "代采购", pending: "已发货等待入库",
  received: "已到达集运仓", storage: "仓储中", packed: "已打包",
  shipped: "已发出", arrived: "清关中", in_transit: "正在派送",
  ready_pickup: "待取货", delivered: "已完成", cancelled: "已取消",
};
export const WAYBILL_STATUS_COLOR: Record<string, string> = {
  procurement: "bg-pink-500/15 text-pink-300 border-pink-500/30",
  pending: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  received: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  storage: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
  packed: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  shipped: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  arrived: "bg-teal-500/15 text-teal-300 border-teal-500/30",
  in_transit: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  ready_pickup: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  delivered: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  cancelled: "bg-rose-500/15 text-rose-300 border-rose-500/30",
};
export const METHOD_LABEL: Record<string, string> = {
  air: "空运", sea: "海运", express: "快递", truck: "陆运", storage: "仓储",
};
export const BATCH_STATUS_LABEL: Record<string, string> = {
  draft: "草稿", locked: "已锁定", shipped: "已发出", arrived: "已到件", closed: "已关闭",
};
export const BATCH_STATUS_COLOR: Record<string, string> = {
  draft: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  locked: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  shipped: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  arrived: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  closed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
};

export function StatusBadge({ map, color, value }: { map: Record<string, string>; color: Record<string, string>; value: string | null | undefined }) {
  if (!value) return <span className="text-slate-500">—</span>;
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${color[value] ?? "bg-slate-500/15 text-slate-300 border-slate-500/30"}`}>
      {map[value] ?? value}
    </span>
  );
}

export function Page({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

export function Card({ title, children, action }: { title?: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
      {title && (
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-slate-200">{title}</div>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function fmtDate(s?: string | null) { return s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—"; }
export function fmtCNY(v?: number | string | null) {
  if (v == null) return "—";
  return `¥${Number(v).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtCAD(v?: number | string | null) {
  if (v == null) return "—";
  return `C$${Number(v).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function BackLink({ to, children }: { to: string; children: React.ReactNode }) {
  return <Link to={to as any} className="text-xs text-slate-400 hover:text-slate-200">← {children}</Link>;
}
