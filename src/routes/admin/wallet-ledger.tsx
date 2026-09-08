import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listWalletLedger, type LedgerKind } from "@/lib/wallet-ledger.functions";
import { Wallet, ArrowDownCircle, ArrowUpCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/wallet-ledger")({ component: WalletLedgerPage });

const STATUS_LABEL: Record<string, string> = {
  completed: "已完成",
  pending: "待处理",
  failed: "失败",
};
const STATUS_COLOR: Record<string, string> = {
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  failed: "border-rose-500/30 bg-rose-500/10 text-rose-300",
};
const CHANNEL_LABEL: Record<string, string> = {
  emt: "EMT",
  wechat: "微信",
  alipay: "支付宝",
  card: "信用卡",
  wallet: "钱包余额",
  cash: "现金",
  admin: "后台调整",
};
const cad = (n: any) => `CA$${Number(n ?? 0).toFixed(2)}`;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function WalletLedgerPage() {
  const fetchLedger = useServerFn(listWalletLedger);

  const [kind, setKind] = useState<LedgerKind>("recharge");
  const [channelGroup, setChannelGroup] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [page, setPage] = useState(1);
  const pageSize = 30;

  const q = useQuery({
    queryKey: ["admin-wallet-ledger", kind, channelGroup, status, dateFrom, dateTo, page],
    queryFn: () =>
      fetchLedger({
        data: {
          kind,
          channelGroup: channelGroup === "all" ? null : channelGroup,
          status: status === "all" ? null : status,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          page,
          pageSize,
        },
      }),
  });

  const rows = (q.data as any)?.rows ?? [];
  const pageCount = (q.data as any)?.page_count ?? 0;
  const totalPages = Math.max(1, Math.ceil(pageCount / pageSize));
  const summary = (q.data as any)?.summary ?? { total_count: 0, total_amount_cad: 0, by_channel: [] };

  const switchKind = (k: LedgerKind) => {
    setKind(k);
    setChannelGroup("all");
    setPage(1);
  };
  const applyPreset = (preset: "today" | "7d" | "month" | "all") => {
    const now = new Date();
    if (preset === "all") {
      setDateFrom("");
      setDateTo("");
    } else if (preset === "today") {
      const d = isoDate(now);
      setDateFrom(d);
      setDateTo(d);
    } else if (preset === "7d") {
      setDateFrom(isoDate(new Date(Date.now() - 6 * 86400000)));
      setDateTo(isoDate(now));
    } else {
      setDateFrom(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setDateTo(isoDate(now));
    }
    setPage(1);
  };

  const chips = [
    { key: "all", label: "全部", count: summary.total_count, amount_cad: summary.total_amount_cad },
    ...summary.by_channel,
  ];

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
          <Wallet className="h-5 w-5 text-blue-400" />
          钱包流水
        </h1>
        <p className="mt-1 text-sm text-slate-400">充值 / 扣款分开查看，可按日期与渠道筛选</p>
      </div>

      {/* Kind tabs */}
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => switchKind("recharge")}
          className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold ${kind === "recharge" ? "bg-emerald-600 text-white" : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
        >
          <ArrowDownCircle className="h-4 w-4" />
          充值流水
        </button>
        <button
          onClick={() => switchKind("spend")}
          className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold ${kind === "spend" ? "bg-rose-600 text-white" : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
        >
          <ArrowUpCircle className="h-4 w-4" />
          扣款流水
        </button>
      </div>

      {/* Channel chips (also serve as the channel filter + per-channel totals) */}
      <div className="mb-4 flex flex-wrap gap-2">
        {chips.map((c: any) => (
          <button
            key={c.key}
            onClick={() => {
              setChannelGroup(c.key);
              setPage(1);
            }}
            className={`rounded-xl border px-3 py-2 text-left text-xs ${channelGroup === c.key ? "border-brand bg-brand/10" : "border-white/10 bg-white/[0.02] hover:border-white/20"}`}
          >
            <div className="font-semibold text-slate-200">
              {c.label ?? "全部"} <span className="text-slate-500">({c.count})</span>
            </div>
            <div className="mt-0.5 font-mono text-sm font-bold text-emerald-300">{cad(c.amount_cad)}</div>
          </button>
        ))}
      </div>

      {/* Date + status filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5"
        />
        <span className="text-slate-500">至</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5"
        />
        <div className="flex gap-1">
          {(
            [
              ["today", "今天"],
              ["7d", "近7天"],
              ["month", "本月"],
              ["all", "全部"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => applyPreset(k)}
              className="rounded-md border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 [&>option]:bg-[#0E1626]"
        >
          <option value="all">全部状态</option>
          <option value="completed">已完成</option>
          <option value="pending">待处理</option>
          <option value="failed">失败</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5">时间</th>
              <th className="px-4 py-2.5">客户</th>
              <th className="px-4 py-2.5">金额 (CAD)</th>
              <th className="px-4 py-2.5">渠道</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">参考号</th>
              <th className="px-4 py-2.5">备注</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
                </td>
              </tr>
            )}
            {rows.length === 0 && !q.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                  暂无记录
                </td>
              </tr>
            )}
            {rows.map((r: any) => (
              <tr key={r.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3 text-xs text-slate-400">{new Date(r.created_at).toLocaleString("zh-CN")}</td>
                <td className="px-4 py-3 text-xs">
                  {r.customer ? (
                    <div>
                      <div>{r.customer.full_name ?? "—"}</div>
                      <div className="font-mono text-[10px] text-slate-500">{r.customer.customer_code ?? "—"}</div>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td
                  className={`px-4 py-3 text-sm font-semibold font-mono ${kind === "recharge" ? "text-emerald-300" : "text-rose-300"}`}
                >
                  {kind === "recharge" ? "+" : "-"}
                  {cad(Math.abs(Number(r.amount_cad ?? 0)))}
                </td>
                <td className="px-4 py-3 text-xs text-slate-300">{CHANNEL_LABEL[r.channel] ?? r.channel ?? "—"}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[r.status] ?? "border-slate-500/30 bg-slate-500/10 text-slate-300"}`}
                  >
                    {STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </td>
                <td className="px-4 py-3 font-mono text-[10px] text-slate-500">{r.ref_no ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <div className="text-slate-400">
          共 {pageCount} 条 · 第 {page} / {totalPages} 页
        </div>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-md border border-white/10 px-3 py-1.5 disabled:opacity-30 hover:bg-white/5"
          >
            上一页
          </button>
          <button
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-md border border-white/10 px-3 py-1.5 disabled:opacity-30 hover:bg-white/5"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
