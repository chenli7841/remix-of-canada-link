import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listHistory } from "@/lib/history.functions";
import {
  Page, Card, fmtDate, fmtCNY, fmtCAD, StatusBadge,
  ORDER_STATUS_LABEL, ORDER_STATUS_COLOR,
  WAYBILL_STATUS_LABEL, WAYBILL_STATUS_COLOR,
} from "@/lib/admin-shared";
import { Loader2, Search } from "lucide-react";

export const Route = createFileRoute("/admin/history")({ component: HistoryPage });

type Kind = "forwarding" | "shop" | "waybill";
const TABS: { key: Kind; label: string }[] = [
  { key: "forwarding", label: "集运订单" },
  { key: "shop", label: "电商订单" },
  { key: "waybill", label: "运单" },
];

function HistoryPage() {
  const fetchList = useServerFn(listHistory);
  const [kind, setKind] = useState<Kind>("forwarding");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["history", kind, search],
    queryFn: () => fetchList({ data: { kind, q: search } }),
  });

  const items: any[] = query.data?.items ?? [];

  return (
    <Page title="历史记录" subtitle="已完成的集运订单、电商订单与运单">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setKind(t.key)}
            className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
              kind === t.key
                ? "border-cta/40 bg-cta/20 text-white"
                : "border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/5"
            }`}
          >
            {t.label}
          </button>
        ))}
        <form
          onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}
          className="ml-auto flex items-center gap-2"
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索单号/客户号/运单号"
              className="w-64 rounded-md border border-white/10 bg-white/[0.02] py-1.5 pl-7 pr-2 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-cta/40"
            />
          </div>
          <button className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5">
            搜索
          </button>
        </form>
      </div>

      <Card>
        {query.isLoading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-slate-500">暂无已完成记录</div>
        ) : kind === "forwarding" ? (
          <HistoryTable
            headers={["单号", "客户号", "状态", "重量", "费用", "国内快递", "批次", "完成时间", ""]}
            rows={items.map((r) => ({
              cells: [
                r.request_no ?? r.id.slice(0, 8),
                r.customer_code ?? "—",
                <StatusBadge map={ORDER_STATUS_LABEL} color={ORDER_STATUS_COLOR} value={r.status} />,
                r.weight_kg != null ? `${Number(r.weight_kg).toFixed(2)} kg` : "—",
                fmtCNY(r.fee_cny),
                r.tracking_no ?? "—",
                r.batch_no ?? "—",
                fmtDate(r.updated_at),
                <Link to={"/admin/forwardings/$forwardingId" as any} params={{ forwardingId: r.id } as any} className="text-cta hover:underline">详情</Link>,
              ],
            }))}
          />
        ) : kind === "shop" ? (
          <HistoryTable
            headers={["订单号", "客户号", "状态", "总额", "物流单号", "支付时间", "发货时间", "完成时间", ""]}
            rows={items.map((r) => ({
              cells: [
                r.order_no ?? r.id.slice(0, 8),
                r.customer_code ?? "—",
                <StatusBadge map={ORDER_STATUS_LABEL} color={ORDER_STATUS_COLOR} value={r.status} />,
                fmtCNY(r.total_cny),
                r.tracking_no ?? "—",
                fmtDate(r.paid_at),
                fmtDate(r.shipped_at),
                fmtDate(r.completed_at ?? r.updated_at),
                <Link to={"/admin/shop/orders/$orderId" as any} params={{ orderId: r.id } as any} className="text-cta hover:underline">详情</Link>,
              ],
            }))}
          />
        ) : (
          <HistoryTable
            headers={["运单号", "状态", "重量", "运费", "国际单号", "批次", "完成时间", ""]}
            rows={items.map((r) => ({
              cells: [
                r.waybill_no ?? r.id.slice(0, 8),
                <StatusBadge map={WAYBILL_STATUS_LABEL} color={WAYBILL_STATUS_COLOR} value={r.status} />,
                r.weight_kg != null ? `${Number(r.weight_kg).toFixed(2)} kg` : "—",
                fmtCAD(r.freight_cad),
                r.intl_tracking_no ?? "—",
                r.batch_no ?? "—",
                fmtDate(r.updated_at),
                <Link to={"/admin/waybills/$waybillId" as any} params={{ waybillId: r.id } as any} className="text-cta hover:underline">详情</Link>,
              ],
            }))}
          />
        )}
        <div className="mt-3 text-[11px] text-slate-500">共 {items.length} 条 · 最多显示 200 条</div>
      </Card>
    </Page>
  );
}

function HistoryTable({ headers, rows }: { headers: string[]; rows: { cells: React.ReactNode[] }[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left text-[11px] uppercase tracking-wider text-slate-500">
          <tr>{headers.map((h, i) => <th key={i} className="whitespace-nowrap px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="text-slate-200">
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-white/5 hover:bg-white/[0.02]">
              {r.cells.map((c, j) => <td key={j} className="whitespace-nowrap px-3 py-2">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
