import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getDashboard } from "@/lib/dashboard.functions";
import {
  Boxes, Truck, Package, AlertTriangle, FileText, DollarSign, Users, Loader2, ScanLine, ArrowRight, Wallet,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";

export const Route = createFileRoute("/admin/")({ component: AdminIndex });

const METHOD_LABEL: Record<string, string> = { air: "空运", sea: "海运", express: "快递", truck: "陆运", storage: "仓储", unknown: "未指定" };
const PIE_COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#06B6D4"];

function AdminIndex() {
  const fetchDash = useServerFn(getDashboard);
  const q = useQuery({ queryKey: ["admin-dashboard"], queryFn: () => fetchDash(), refetchInterval: 60_000 });
  const d = q.data;

  if (q.isLoading) return <div className="grid h-[60vh] place-items-center"><Loader2 className="h-6 w-6 animate-spin text-slate-500"/></div>;
  if (q.isError) return <div className="p-6 text-rose-400">{(q.error as Error).message}</div>;
  if (!d) return null;

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">运营概览</h1>
          <p className="mt-1 text-sm text-slate-400">实时数据 · 每 60 秒自动刷新</p>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI icon={Boxes} label="今日订单" value={d.kpi.ordersToday} accent="from-blue-500 to-cyan-500" />
        <KPI icon={Truck} label="今日运单" value={d.kpi.waybillsToday} accent="from-emerald-500 to-teal-500" />
        <KPI icon={Package} label="在途运单" value={d.kpi.inTransit} accent="from-violet-500 to-fuchsia-500" />
        <KPI icon={ScanLine} label="待入库" value={d.kpi.pendingIntake} accent="from-amber-500 to-orange-500" />
        <KPI icon={FileText} label="待收 CNY" value={`¥${d.kpi.unpaidCNY.toLocaleString()}`} accent="from-rose-500 to-pink-500" />
        <KPI icon={DollarSign} label="本月营收 CAD" value={`$${d.kpi.monthRevenueCAD.toLocaleString()}`} accent="from-emerald-500 to-lime-500" />
        <KPI icon={AlertTriangle} label="滞留单号" value={d.kpi.detained} accent="from-rose-500 to-amber-500" />
        <KPI icon={Users} label="总用户数" value={d.kpi.users} accent="from-sky-500 to-indigo-500" />
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4 lg:col-span-2">
          <div className="mb-3 text-sm font-semibold">最近 7 天 · 运单趋势</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={d.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b"/>
                <XAxis dataKey="date" stroke="#64748b" fontSize={11}/>
                <YAxis stroke="#64748b" fontSize={11}/>
                <Tooltip contentStyle={{ background: "#0E1626", border: "1px solid #1e293b", borderRadius: 8 }}/>
                <Line type="monotone" dataKey="waybills" stroke="#3B82F6" strokeWidth={2} dot={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="mb-3 text-sm font-semibold">30 天运输方式分布</div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={d.routeDistribution.map(r => ({ ...r, name: METHOD_LABEL[r.name] ?? r.name }))} dataKey="value" nameKey="name" outerRadius={70}>
                  {d.routeDistribution.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]}/>)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }}/>
                <Tooltip contentStyle={{ background: "#0E1626", border: "1px solid #1e293b", borderRadius: 8 }}/>
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Wallet ledger summary (owner/manager only) */}
      {d.walletLedger && (
        <div className="mt-6 rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="inline-flex items-center gap-1.5 text-sm font-semibold">
              <Wallet className="h-4 w-4 text-blue-400" />
              本月钱包流水
            </div>
            <Link to="/admin/wallet-ledger" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">
              查看完整流水 <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <WalletLedgerMini
              title="充值"
              accentClass="text-emerald-300"
              summary={d.walletLedger.month_recharge}
            />
            <WalletLedgerMini
              title="扣款"
              accentClass="text-rose-300"
              summary={d.walletLedger.month_spend}
            />
          </div>
        </div>
      )}

      {/* Recent logs */}
      <div className="mt-6 rounded-2xl border border-white/5 bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold">最近操作</div>
          <Link to="/admin/logs" className="inline-flex items-center gap-1 text-xs text-brand hover:underline">查看全部 <ArrowRight className="h-3 w-3"/></Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-1.5 pr-3">时间</th>
                <th className="py-1.5 pr-3">操作人</th>
                <th className="py-1.5 pr-3">类型</th>
                <th className="py-1.5 pr-3">动作</th>
                <th className="py-1.5">备注</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-slate-300">
              {d.recentLogs.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-slate-500">暂无</td></tr>}
              {d.recentLogs.map((l: any) => (
                <tr key={l.id}>
                  <td className="py-1.5 pr-3 text-slate-500">{new Date(l.created_at).toLocaleString("zh-CN")}</td>
                  <td className="py-1.5 pr-3">{l.operator_name ?? "—"}</td>
                  <td className="py-1.5 pr-3 font-mono text-[10px]">{l.entity_type}</td>
                  <td className="py-1.5 pr-3">{l.action}</td>
                  <td className="py-1.5 text-slate-400">{l.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function WalletLedgerMini({
  title,
  accentClass,
  summary,
}: {
  title: string;
  accentClass: string;
  summary: { total_count: number; total_amount_cad: number; by_channel: { key: string; label: string; count: number; amount_cad: number }[] };
}) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-400">{title}（{summary.total_count} 笔）</span>
        <span className={`font-display text-lg font-bold ${accentClass}`}>${summary.total_amount_cad.toLocaleString()}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {summary.by_channel.map((c) => (
          <span key={c.key} className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-slate-400">
            {c.label} {c.count} 笔 · ${c.amount_cad.toLocaleString()}
          </span>
        ))}
      </div>
    </div>
  );
}

function KPI({ icon: Icon, label, value, accent }: { icon: any; label: string; value: any; accent: string }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.03] p-4">
      <div className={`mb-3 inline-grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br ${accent} text-white`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 font-display text-xl font-bold">{value}</div>
    </div>
  );
}
