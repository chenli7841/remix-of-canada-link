import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listUsers, type AppRole } from "@/lib/admin.functions";
import { ROLE_LABEL, ROLE_COLOR, ASSIGNABLE_ROLES } from "@/lib/admin-roles";
import { VIP_LEVELS, VIP_LABEL, VIP_COLOR, type VipLevel } from "@/lib/vip-levels";
import { Search, Loader2, ArrowRight, Receipt, Ban } from "lucide-react";
import { Pagination } from "@/components/admin/Pagination";

export const Route = createFileRoute("/admin/users/")({
  component: UsersPage,
});

function UsersPage() {
  const fetchUsers = useServerFn(listUsers);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [role, setRole] = useState<AppRole | "all">("all");
  const [vipLevel, setVipLevel] = useState<VipLevel | "all">("all");
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const q = useQuery({
    queryKey: ["admin-users", { search, role, vipLevel, unpaidOnly, page }],
    queryFn: () => fetchUsers({ data: { search, role, vipLevel, unpaidOnly, page, pageSize } }),
  });


  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">用户管理</h1>
          <p className="mt-1 text-sm text-slate-400">{q.data ? `共 ${q.data.total} 个用户` : "加载中…"}</p>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="搜索邮箱/姓名/客户号/电话"
              className="w-72 rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-sm placeholder:text-slate-500 focus:border-brand focus:outline-none"
            />
          </div>
          <select
            value={role}
            onChange={(e) => {
              setRole(e.target.value as any);
              setPage(1);
            }}
            className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand focus:outline-none [&>option]:bg-[#0E1626] [&>option]:text-slate-100"
          >
            <option value="all">全部角色</option>
            {(
              [
                "owner",
                "manager",
                "warehouse_cn",
                "warehouse_ca",
                "driver",
                "pickup_point",
                "sales",
                "support",
                "customer",
              ] as AppRole[]
            ).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r].zh}
              </option>
            ))}
          </select>
          <select
            value={vipLevel}
            onChange={(e) => {
              setVipLevel(e.target.value as any);
              setPage(1);
            }}
            className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100 focus:border-brand focus:outline-none [&>option]:bg-[#0E1626] [&>option]:text-slate-100"
          >
            <option value="all">全部等级</option>
            {VIP_LEVELS.map((lv) => (
              <option key={lv} value={lv}>
                {VIP_LABEL[lv]}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-slate-100">
            <input
              type="checkbox"
              checked={unpaidOnly}
              onChange={(e) => {
                setUnpaidOnly(e.target.checked);
                setPage(1);
              }}
            />
            只看有未付款
          </label>

          <button className="rounded-md bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand/90">
            搜索
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5">客户号 / 邮箱</th>
              <th className="px-4 py-2.5">姓名 / 电话</th>
              <th className="px-4 py-2.5">等级</th>
              <th className="px-4 py-2.5">钱包余额</th>
              <th className="px-4 py-2.5">未付款</th>
              <th className="px-4 py-2.5">积分</th>
              <th className="px-4 py-2.5">角色</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
                </td>
              </tr>
            )}
            {q.isError && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-rose-400">
                  {(q.error as Error).message}
                </td>
              </tr>
            )}
            {q.data?.users.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                  无匹配用户
                </td>
              </tr>
            )}
            {q.data?.users.map((u) => (
              <tr key={u.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-slate-300">{u.customer_code ?? "—"}</div>
                  <div className="text-xs text-slate-400">{u.email ?? "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-100 inline-flex items-center gap-1.5">
                    {u.full_name ?? "—"}
                    {u.is_blacklisted && (
                      <span
                        title={u.blacklist_reason ?? "已拉黑"}
                        className="inline-flex items-center gap-0.5 rounded-full border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300"
                      >
                        <Ban className="h-2.5 w-2.5" />
                        黑名单
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">{u.phone ?? "—"}</div>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${VIP_COLOR[u.vip_level]}`}
                  >
                    {VIP_LABEL[u.vip_level]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs">
                  <div className="text-emerald-300">CA${u.wallet.balance_cad.toFixed(2)}</div>
                </td>
                <td className="px-4 py-3 text-xs">
                  {u.unpaid.count > 0 ? (
                    <>
                      <div className="font-semibold text-rose-300">{u.unpaid.count} 笔</div>
                      <div className="text-rose-200/80">CA${u.unpaid.amount_cad.toFixed(2)}</div>
                    </>
                  ) : (
                    <span className="text-slate-500">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs font-mono text-violet-300">{u.points}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length === 0 && <span className="text-xs text-slate-500">—</span>}
                    {u.roles
                      .filter((r) => ASSIGNABLE_ROLES.includes(r) || r === "customer")
                      .map((r) => (
                        <span
                          key={r}
                          className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${ROLE_COLOR[r]}`}
                        >
                          {ROLE_LABEL[r].zh}
                        </span>
                      ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex items-center gap-2">
                    <Link
                      to="/admin/invoices"
                      search={{ userId: u.id }}
                      className="inline-flex items-center gap-1 text-xs text-blue-300 hover:underline"
                      title="查看该用户全部账单"
                    >
                      <Receipt className="h-3 w-3" />
                      账单
                    </Link>
                    <Link
                      to="/admin/users/$userId"
                      params={{ userId: u.id }}
                      className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                    >
                      详情 <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {q.data && <Pagination page={page} pageSize={pageSize} total={q.data.total} onChange={setPage} />}
    </div>
  );
}
