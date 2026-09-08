import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listOrders, type OrderStatus } from "@/lib/orders.functions";
import { ORDER_STATUS_LABEL, ORDER_STATUS_COLOR, METHOD_LABEL, StatusBadge, Page, fmtDate, fmtCNY } from "@/lib/admin-shared";
import { Search, Loader2, ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { DeleteRowButton, useCanDelete } from "@/components/admin/DeleteRowButton";
import { deleteOrderRecord } from "@/lib/admin-delete.functions";

export const Route = createFileRoute("/admin/orders/")({ component: OrdersPage });

const ORDER_STATUSES: (OrderStatus | "all")[] = ["all","procurement","pending","paid","received","storage","packed","shipped","arrived","in_transit","ready_pickup","processing","delivered","cancelled"];

function OrdersPage() {
  const fetchList = useServerFn(listOrders);
  const delOrder = useServerFn(deleteOrderRecord);
  const canDelete = useCanDelete();
  const qc = useQueryClient();
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [pay, setPay] = useState<"all" | "paid" | "unpaid">("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const q = useQuery({
    queryKey: ["admin-orders", { status, pay, search, page }],
    queryFn: () => fetchList({ data: { status, payment_status: pay, search, page, pageSize } }),
  });
  const totalPages = q.data ? Math.max(1, Math.ceil(q.data.total / pageSize)) : 1;

  return (
    <Page title="电商订单" subtitle={q.data ? `共 ${q.data.total} 个订单` : "加载中…"}>
      <form
        className="mb-4 flex flex-wrap items-center gap-2"
        onSubmit={(e) => { e.preventDefault(); setSearch(searchInput.trim()); setPage(1); }}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="订单号/客户号/批次/国内国际单号"
            className="w-72 rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-sm placeholder:text-slate-500 focus:border-brand focus:outline-none" />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value as any); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand focus:outline-none [&>option]:bg-[#0E1626]">
          {ORDER_STATUSES.map((s) => <option key={s} value={s}>{s === "all" ? "全部状态" : ORDER_STATUS_LABEL[s]}</option>)}
        </select>
        <select value={pay} onChange={(e) => { setPay(e.target.value as any); setPage(1); }}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand focus:outline-none [&>option]:bg-[#0E1626]">
          <option value="all">全部支付</option>
          <option value="paid">已支付</option>
          <option value="unpaid">未支付</option>
        </select>
        <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90">搜索</button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5">订单号</th>

              <th className="px-4 py-2.5">客户</th>
              <th className="px-4 py-2.5">方式 / 线路</th>
              <th className="px-4 py-2.5">金额</th>
              <th className="px-4 py-2.5">支付</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">国内单号</th>
              <th className="px-4 py-2.5">批次</th>
              <th className="px-4 py-2.5">创建时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && <tr><td colSpan={10} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500"/></td></tr>}
            {q.isError && <tr><td colSpan={10} className="py-10 text-center text-rose-400">{(q.error as Error).message}</td></tr>}
            {q.data?.orders.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-slate-500">暂无数据</td></tr>}
            {q.data?.orders.map((o: any) => (
              <tr key={o.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2.5 font-mono text-base">{o.order_no}</td>
                <td className="px-4 py-2.5 text-xs">{o.customer_code ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs">
                  <div>{METHOD_LABEL[o.shipping_method] ?? o.shipping_method}</div>
                  <div className="text-slate-500">{o.route_code ?? "—"}</div>
                </td>
                <td className="px-4 py-2.5 text-xs">{fmtCNY(o.total_cny)}</td>
                <td className="px-4 py-2.5 text-xs">
                  <span className={o.payment_status === "paid" ? "text-emerald-300" : "text-amber-300"}>
                    {o.payment_status === "paid" ? "已付" : "未付"}
                  </span>
                </td>
                <td className="px-4 py-2.5"><StatusBadge map={ORDER_STATUS_LABEL} color={ORDER_STATUS_COLOR} value={o.status}/></td>
                <td className="px-4 py-2.5 font-mono text-base text-brand">{o.domestic_tracking_no ?? "—"}</td>
                <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{o.batch_no ?? "—"}</td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{fmtDate(o.created_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link to="/admin/orders/$orderId" params={{ orderId: o.id }}
                    className="inline-flex items-center gap-1 text-xs text-brand hover:underline">详情 <ArrowRight className="h-3 w-3"/></Link>
                  {canDelete && <DeleteRowButton label="订单" name={o.order_no} extra="其下属运单、订单商品将一并删除。" onDelete={async () => { await delOrder({ data: { id: o.id } }); await qc.invalidateQueries({ queryKey: ["admin-orders"] }); }}/>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {q.data && q.data.total > pageSize && (
        <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
          <div>第 {page} / {totalPages} 页</div>
          <div className="flex gap-1">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 hover:bg-white/5 disabled:opacity-40">
              <ChevronLeft className="h-3 w-3"/>上一页</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 hover:bg-white/5 disabled:opacity-40">
              下一页 <ChevronRight className="h-3 w-3"/></button>
          </div>
        </div>
      )}
    </Page>
  );
}
