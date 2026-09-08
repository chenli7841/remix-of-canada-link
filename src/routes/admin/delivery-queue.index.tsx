import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listDeliveryByCustomer,
  bulkUpdateCustomerDelivery,
  deductCustomerWallet,
} from "@/lib/delivery-queue.functions";
import { Page, fmtDate, fmtCNY } from "@/lib/admin-shared";
import { Loader2, ArrowRight, Truck, Wallet, Check, X } from "lucide-react";

export const Route = createFileRoute("/admin/delivery-queue/")({ component: DeliveryQueuePage });

const STATUS_LABEL: Record<string, string> = { pending: "待派送", dispatched: "已派送", cancelled: "已取消" };

function DeliveryQueuePage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listDeliveryByCustomer);
  const bulkUpdate = useServerFn(bulkUpdateCustomerDelivery);
  const deduct = useServerFn(deductCustomerWallet);

  const [status, setStatus] = useState<string>("pending");
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["delivery-queue-groups", status],
    queryFn: () => fetchList({ data: { status } }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["delivery-queue-groups"] });

  const groups = (q.data?.groups ?? []).filter((g: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (g.customer_code ?? "").toLowerCase().includes(s) ||
      (g.full_name ?? "").toLowerCase().includes(s) ||
      (g.phone ?? "").toLowerCase().includes(s)
    );
  });

  const totals = groups.reduce(
    (acc: any, g: any) => ({
      count: acc.count + g.count,
      weight: acc.weight + Number(g.weight_kg || 0),
      fee: acc.fee + Number(g.fee_cny || 0),
    }),
    { count: 0, weight: 0, fee: 0 },
  );

  const onDispatchAll = async (g: any) => {
    if (!g.customer_user_id && !g.customer_code) return;
    if (!window.confirm(`将客户 ${g.customer_code ?? ""} 的 ${g.count} 项标记为已派送？`)) return;
    await bulkUpdate({
      data: {
        customerUserId: g.customer_user_id,
        customerCode: g.customer_user_id ? null : g.customer_code,
        status: "dispatched",
      },
    });
    await refresh();
  };

  const onCancelAll = async (g: any) => {
    if (!window.confirm(`取消客户 ${g.customer_code ?? ""} 全部 ${g.count} 项待派送？`)) return;
    await bulkUpdate({
      data: {
        customerUserId: g.customer_user_id,
        customerCode: g.customer_user_id ? null : g.customer_code,
        status: "cancelled",
      },
    });
    await refresh();
  };

  const onDeduct = async (g: any) => {
    if (!g.customer_user_id) {
      alert("该客户未注册账号，无法扣款");
      return;
    }
    const suggested = g.fee_cad > 0 ? g.fee_cad.toFixed(2) : "";
    const input = window.prompt(
      `扣款金额 (CAD)，客户余额 ${g.wallet_balance_cad != null ? "CA$" + g.wallet_balance_cad.toFixed(2) : "—"}`,
      suggested,
    );
    if (!input) return;
    const amt = Number(input);
    if (!(amt > 0)) {
      alert("金额无效");
      return;
    }
    const note = window.prompt("备注（可空）", "派送费用扣款") ?? undefined;
    await deduct({ data: { customerUserId: g.customer_user_id, amountCad: amt, note } });
    await refresh();
    alert("扣款成功");
  };

  return (
    <Page
      title="待派送列表"
      subtitle={`${groups.length} 个客户 · 共 ${totals.count} 项 · 总重 ${totals.weight.toFixed(2)} kg · 总费用 ${fmtCNY(totals.fee)}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-slate-400">状态：</span>
        {["pending", "dispatched", "cancelled"].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`rounded-md border px-2.5 py-1 text-xs ${status === s ? "border-brand bg-brand/20 text-brand" : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
          >
            {STATUS_LABEL[s]}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索客户号 / 姓名 / 电话"
          className="ml-3 w-64 rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs placeholder:text-slate-500 focus:border-brand focus:outline-none"
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5">客户号</th>
              <th className="px-4 py-2.5 text-center">待派送单数</th>
              <th className="px-4 py-2.5">地址</th>
              <th className="px-4 py-2.5">电话</th>
              <th className="px-4 py-2.5 text-right">重量 (kg)</th>
              <th className="px-4 py-2.5 text-right">费用</th>
              <th className="px-4 py-2.5">加入时间</th>
              <th className="px-4 py-2.5 text-right">操作</th>
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
            {!q.isLoading && groups.length === 0 && (
              <tr>
                <td colSpan={8} className="py-10 text-center text-slate-500">
                  暂无
                </td>
              </tr>
            )}
            {groups.map((g: any) => (
              <tr key={g.key} className="hover:bg-white/[0.03] align-top">
                <td className="px-4 py-3 text-xs">
                  <div className="font-mono text-slate-100">{g.customer_code ?? "—"}</div>
                  {g.full_name && <div className="text-[11px] text-slate-500">{g.full_name}</div>}
                  {g.wallet_balance_cad != null && (
                    <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-500">
                      <Wallet className="h-3 w-3" /> 余额 CA${Number(g.wallet_balance_cad).toFixed(2)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-center text-sm font-semibold text-brand">{g.count}</td>
                <td className="px-4 py-3 text-xs text-slate-300 max-w-xs">
                  {g.address || <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-3 text-xs">{g.phone ?? <span className="text-slate-500">—</span>}</td>
                <td className="px-4 py-3 text-right text-xs">{Number(g.weight_kg).toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-xs">{fmtCNY(g.fee_cny)}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{fmtDate(g.earliest_at)}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex flex-wrap justify-end gap-1">
                    {status === "pending" && (
                      <>
                        <button
                          onClick={() => onDispatchAll(g)}
                          title="全部标记派送"
                          className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-300 hover:bg-emerald-500/20"
                        >
                          <Check className="inline h-3 w-3" /> 派送
                        </button>
                        <button
                          onClick={() => onCancelAll(g)}
                          title="全部取消"
                          className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10"
                        >
                          <X className="inline h-3 w-3" /> 取消
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => onDeduct(g)}
                      title="扣款"
                      className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300 hover:bg-amber-500/20"
                    >
                      <Wallet className="inline h-3 w-3" /> 扣款
                    </button>
                    <Link
                      to="/admin/delivery-queue/$customerKey"
                      params={{ customerKey: g.customer_user_id || `code:${g.customer_code ?? "unknown"}` }}
                      className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-2 py-1 text-[11px] text-brand hover:bg-brand/20"
                    >
                      <Truck className="h-3 w-3" /> 详情 <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Page>
  );
}
