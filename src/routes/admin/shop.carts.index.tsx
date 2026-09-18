import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listShopCarts } from "@/lib/shop.functions";
import { Page, fmtDate, fmtCNY } from "@/lib/admin-shared";
import { Pagination } from "@/components/admin/Pagination";
import { Loader2, ArrowRight, Pencil } from "lucide-react";

export const Route = createFileRoute("/admin/shop/carts/")({ component: ShopCartsPage });

const STATUSES = ["active", "ordered", "abandoned"] as const;

function ShopCartsPage() {
  const fetchList = useServerFn(listShopCarts);
  const [status, setStatus] = useState<string>("active");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const q = useQuery({
    queryKey: ["shop-carts", { status, page }],
    queryFn: () => fetchList({ data: { status, page, pageSize } }),
  });

  return (
    <Page
      title="客户购物车"
      subtitle={q.data ? `共 ${q.data.total} 个（预下单，可后台改价）` : "加载中…"}
      action={
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm [&>option]:bg-[#0E1626]"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s === "active" ? "进行中" : s === "ordered" ? "已下单" : "已放弃"}
            </option>
          ))}
        </select>
      }
    >
      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5">客户</th>
              <th className="px-4 py-2.5">行数</th>
              <th className="px-4 py-2.5">商品小计</th>
              <th className="px-4 py-2.5">运/税/险</th>
              <th className="px-4 py-2.5">成交合计</th>
              <th className="px-4 py-2.5">线路</th>
              <th className="px-4 py-2.5">更新时间</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && (
              <tr>
                <td colSpan={8} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
                </td>
              </tr>
            )}
            {q.data?.items.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-slate-500">
                  暂无数据
                </td>
              </tr>
            )}
            {q.data?.items.map((c: any) => (
              <tr key={c.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2.5 text-xs">
                  <div className="font-medium">{c.user?.full_name ?? c.user?.email ?? "—"}</div>
                  <div className="text-slate-500">{c.user?.customer_code ?? "—"}</div>
                </td>
                <td className="px-4 py-2.5 text-xs">{c.line_count}</td>
                <td className="px-4 py-2.5 text-xs">{fmtCNY(c.subtotal_cny)}</td>
                <td className="px-4 py-2.5 text-xs text-slate-400">
                  {fmtCNY(c.freight_cny)} / {fmtCNY(c.customs_cny)} / {fmtCNY(c.insurance_cny)}
                </td>
                <td className="px-4 py-2.5 text-xs font-semibold">
                  {fmtCNY(c.effective_total_cny)}
                  {c.has_override && (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">
                      <Pencil className="h-2.5 w-2.5" /> 已改价
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-400">
                  {c.route_code ?? (c.needs_route ? "未选线路" : "—")}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-400">{fmtDate(c.updated_at)}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    to="/admin/shop/carts/$cartId"
                    params={{ cartId: c.id }}
                    className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                  >
                    详情 <ArrowRight className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {q.data && <Pagination page={page} pageSize={pageSize} total={q.data.total} onChange={setPage} />}
    </Page>
  );
}
