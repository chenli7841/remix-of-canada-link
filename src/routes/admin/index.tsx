import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { getOperationsDashboard } from "@/lib/operations-dashboard.functions";
export const Route = createFileRoute("/admin/")({ component: AdminIndex });
const money = (n: number) =>
  "CA$" + n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const panel = "rounded-2xl border border-white/10 bg-[#111c2c] p-4 sm:p-5";
const th = "whitespace-nowrap bg-[#182438] px-3 py-3 text-left text-xs font-normal text-slate-400";
const td = "px-3 py-4";
function AdminIndex() {
  const fetchDashboard = useServerFn(getOperationsDashboard);
  const q = useQuery({
    queryKey: ["admin-operations-dashboard"],
    queryFn: () => fetchDashboard(),
    refetchInterval: 60_000,
  });
  const [search, setSearch] = useState("");
  if (q.isLoading)
    return (
      <div className="grid h-64 place-items-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  if (q.isError)
    return (
      <div className="p-6 text-rose-400">
        {q.error.message}
        <button className="ml-3 underline" onClick={() => q.refetch()}>
          重试
        </button>
      </div>
    );
  const d = q.data;
  if (!d) return null;
  const customers = d.customers.filter((c) =>
    (c.customer_code + " " + c.full_name).toLowerCase().includes(search.trim().toLowerCase()),
  );
  const cards = [
    {
      label: "未读留言",
      value: d.unreadMessages,
      to: "/admin/messages",
      hint: "查看留言信息",
      color: "border-t-blue-400",
    },
    ...(d.canSeeWallet
      ? [
          {
            label: "待处理钱包流水",
            value: d.pendingWallet,
            to: "/admin/wallet-ledger",
            hint: "查看钱包流水",
            color: "border-t-amber-400",
          },
        ]
      : []),
    {
      label: "未全部付款批次",
      value: d.unpaidBatches,
      to: "/admin/batches",
      hint: "查看批次列表",
      color: "border-t-rose-400",
    },
    {
      label: "未全部确认到件批次",
      value: d.unconfirmedBatches,
      to: "/admin/batches",
      hint: "查看批次列表",
      color: "border-t-teal-400",
    },
  ];
  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold">运营概况</h1>
        <p className="mt-1 text-xs text-slate-400">待办、客户欠款与批次到件进度 · 每 60 秒刷新</p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (
          <Link
            key={c.label}
            to={c.to as any}
            className={`${panel} border-t-2 ${c.color} hover:bg-slate-800`}
          >
            <div className="text-xs text-slate-300 sm:text-sm">{c.label}</div>
            <div className="my-2 text-3xl font-bold sm:text-4xl">{c.value}</div>
            <div className="text-xs text-slate-400">{c.hint} →</div>
          </Link>
        ))}
      </div>
      {d.canSeeWallet && (
        <section className={panel}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold">客户待付款</h2>
              <p className="mt-1 text-xs text-slate-400">
                汇总未付账单的剩余金额，不含尚未出账的费用 · {customers.length} 位客户
              </p>
            </div>
            <input
              aria-label="搜索客户号或姓名"
              placeholder="搜索客户号 / 姓名"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-slate-950/40 px-3 py-2 text-sm sm:w-60"
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-sm">
              <thead>
                <tr>
                  {[
                    "客户号 / 姓名",
                    "未付批次数",
                    "待付款总额（CAD）",
                    "客户余额（CAD）",
                    "余额不足金额（CAD）",
                  ].map((t) => (
                    <th className={th} key={t}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr className="border-b border-white/10 last:border-0" key={c.user_id}>
                    <td className={td}>
                      <b className="text-base">{c.customer_code}</b>
                      <div className="text-xs text-slate-400">{c.full_name}</div>
                    </td>
                    <td className={td}>{c.batch_count} 个</td>
                    <td className={`${td} font-bold text-amber-300`}>{money(c.due_cad)}</td>
                    <td className={`${td} font-bold text-emerald-300`}>{money(c.balance_cad)}</td>
                    <td className={td}>
                      {c.due_cad > c.balance_cad ? (
                        <span className="text-rose-400">{money(c.due_cad - c.balance_cad)}</span>
                      ) : (
                        <span className="text-slate-400">余额充足</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!customers.length && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">
                      {search ? "没有匹配的客户" : "暂无待付款客户"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500 sm:hidden">左右滑动查看完整金额与余额</p>
        </section>
      )}
      <div>
        <h2 className="font-semibold">批次发出时长</h2>
        <p className="mt-1 text-xs text-slate-400">
          只显示已发出批次，已到件不显示。空运超过 12 天、海运超过 30 天标红。
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {(["air", "sea"] as const).map((method) => {
          const batches = d.transit.filter((b) => b.shipping_method === method);
          return (
            <section className={panel} key={method}>
              <div className="mb-4 flex justify-between">
                <h2 className="font-semibold">{method === "air" ? "空运" : "海运"}批次</h2>
                <span className="text-xs text-slate-400">{batches.length} 个批次</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full whitespace-nowrap text-sm">
                  <thead>
                    <tr>
                      {["批次", "发出日期", "距发出", "状态"].map((t) => (
                        <th key={t} className={th}>
                          {t}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr
                        key={b.id}
                        className={`border-b border-white/10 last:border-0 ${b.overdue ? "bg-rose-500/5" : ""}`}
                      >
                        <td className={td}>
                          <Link
                            to="/admin/batches/$batchId"
                            params={{ batchId: b.id }}
                            className="text-blue-400 hover:underline"
                          >
                            {b.display_name || b.batch_no}
                          </Link>
                          <div className="text-xs text-slate-500">{b.batch_no}</div>
                        </td>
                        <td className={td}>
                          {b.ship_date ?? "未设置"}
                          {b.estimated_date && (
                            <div className="text-[10px] text-amber-400">按计划发货日</div>
                          )}
                        </td>
                        <td className={`${td} ${b.overdue ? "text-rose-400" : ""}`}>
                          <b className="text-xl">{b.days ?? "—"}</b> 天
                          {b.overdue && <div className="text-xs">超过 {b.days! - b.limit} 天</div>}
                        </td>
                        <td className={`${td} text-xs text-blue-300`}>已发出</td>
                      </tr>
                    ))}
                    {!batches.length && (
                      <tr>
                        <td colSpan={4} className="p-6 text-center text-slate-400">
                          暂无已发出批次
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
