import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listWalletLedger, type LedgerKind } from "@/lib/wallet-ledger.functions";
import {
  listRechargeApplications,
  confirmEmtTopup,
  voidTopup,
  queryOttTopup,
  getRechargeProofUrl,
} from "@/lib/wallet-recharge.functions";
import { Wallet, ArrowDownCircle, ArrowUpCircle, Loader2, ClipboardList } from "lucide-react";

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
  const [view, setView] = useState<"ledger" | "apps">("ledger");
  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
          <Wallet className="h-5 w-5 text-blue-400" />
          钱包流水
        </h1>
        <p className="mt-1 text-sm text-slate-400">充值 / 扣款流水明细，以及充值申请记录（EMT / OTT 待处理确认）</p>
      </div>
      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setView("ledger")}
          className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold ${view === "ledger" ? "bg-blue-600 text-white" : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
        >
          <Wallet className="h-4 w-4" />
          流水明细
        </button>
        <button
          onClick={() => setView("apps")}
          className={`inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-sm font-semibold ${view === "apps" ? "bg-blue-600 text-white" : "border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"}`}
        >
          <ClipboardList className="h-4 w-4" />
          充值申请记录
        </button>
      </div>
      {view === "apps" ? <RechargeApplications /> : <LedgerView />}
    </div>
  );
}

function LedgerView() {
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
    <>
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
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[r.status] ?? "border-slate-500/30 bg-slate-500/10 text-slate-300"}`}>
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
    </>
  );
}

// ============================ 充值申请记录 ============================
const APP_STATUS_LABEL: Record<string, string> = {
  pending: "正在充值",
  completed: "已充值",
  failed: "已无效",
  cancelled: "已无效",
};
const APP_STATUS_COLOR: Record<string, string> = {
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  failed: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  cancelled: "border-rose-500/30 bg-rose-500/10 text-rose-300",
};
const APP_CHANNEL_LABEL: Record<string, string> = {
  emt: "EMT",
  wechat: "微信支付",
  alipay: "支付宝",
  card: "信用卡",
};

function RechargeApplications() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listRechargeApplications);
  const doConfirmEmt = useServerFn(confirmEmtTopup);
  const doVoid = useServerFn(voidTopup);
  const doQueryOtt = useServerFn(queryOttTopup);
  const getProof = useServerFn(getRechargeProofUrl);

  const [customerCode, setCustomerCode] = useState("");
  const [refNo, setRefNo] = useState("");
  const [paymentId, setPaymentId] = useState("");
  const [channel, setChannel] = useState("all");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 30;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err" | "warn"; text: string } | null>(null);

  const q = useQuery({
    queryKey: ["recharge-apps", customerCode, refNo, paymentId, channel, status, dateFrom, dateTo, page],
    queryFn: () =>
      fetchList({
        data: {
          customerCode: customerCode || null,
          refNo: refNo || null,
          paymentId: paymentId || null,
          channel: channel === "all" ? null : channel,
          status: status === "all" ? null : status,
          dateFrom: dateFrom || null,
          dateTo: dateTo || null,
          page,
          pageSize,
        },
      }),
  });
  const rows = (q.data as any)?.rows ?? [];
  const total = (q.data as any)?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const refresh = () => qc.invalidateQueries({ queryKey: ["recharge-apps"] });

  const onConfirmEmt = async (r: any) => {
    if (
      !window.confirm(
        `确认客户 ${r.customer_code ?? r.customer_name ?? ""} 的 EMT 充值 CA$${r.amount_cad.toFixed(2)} 已到账？\n确认后立即入账客户钱包余额，且不可自动撤销。`,
      )
    )
      return;
    setBusyId(r.id);
    setMsg(null);
    try {
      await doConfirmEmt({ data: { txId: r.id } });
      setMsg({ kind: "ok", text: `已确认到账，客户钱包 +CA$${r.amount_cad.toFixed(2)}` });
      await refresh();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "确认失败" });
    } finally {
      setBusyId(null);
    }
  };

  const onVoid = async (r: any) => {
    const reason = window.prompt("标记无效的原因？（必填，会记入操作日志）");
    if (!reason?.trim()) return;
    setBusyId(r.id);
    setMsg(null);
    try {
      await doVoid({ data: { txId: r.id, reason: reason.trim(), voidStatus: "cancelled" } });
      setMsg({ kind: "ok", text: "已标记为无效（未改动钱包余额）" });
      await refresh();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "操作失败" });
    } finally {
      setBusyId(null);
    }
  };

  const onQueryOtt = async (r: any) => {
    setBusyId(r.id);
    setMsg(null);
    try {
      const res: any = await doQueryOtt({ data: { txId: r.id } });
      if (res.ok && res.status === "completed") {
        setMsg({
          kind: "ok",
          text: res.settled_now
            ? `OTT 核验成功，已入账 CA$${r.amount_cad.toFixed(2)}`
            : "OTT 核验成功，该笔已由回调入账（未重复加余额）",
        });
      } else if (res.status === "failed") {
        setMsg({ kind: "warn", text: `OTT 状态：${res.provider_status ?? "失败"}，已标记无效` });
      } else if (res.status === "refund_warning") {
        setMsg({ kind: "warn", text: res.warning });
      } else if (res.status === "mismatch") {
        setMsg({ kind: "err", text: res.warning });
      } else if (res.error) {
        setMsg({ kind: "err", text: res.error });
      } else {
        setMsg({ kind: "warn", text: `OTT 仍在处理中（${res.provider_status ?? "pending"}），保持“正在充值”` });
      }
      await refresh();
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "查询失败" });
    } finally {
      setBusyId(null);
    }
  };

  const onViewProof = async (r: any) => {
    setBusyId(r.id);
    try {
      const res: any = await getProof({ data: { txId: r.id } });
      if (res.url) window.open(res.url, "_blank", "noopener");
      else setMsg({ kind: "warn", text: "该记录没有付款凭证" });
    } catch (e: any) {
      setMsg({ kind: "err", text: e?.message ?? "获取凭证失败" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
        <FilterInput label="客户号" value={customerCode} onChange={setCustomerCode} onPage={setPage} />
        <FilterInput label="参考号" value={refNo} onChange={setRefNo} onPage={setPage} />
        <FilterInput label="Payment ID" value={paymentId} onChange={setPaymentId} onPage={setPage} />
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">渠道</div>
          <select
            value={channel}
            onChange={(e) => {
              setChannel(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 [&>option]:bg-[#0E1626]"
          >
            <option value="all">全部渠道</option>
            <option value="emt">EMT</option>
            <option value="wechat">微信支付</option>
            <option value="alipay">支付宝</option>
            <option value="card">信用卡</option>
            <option value="other">其他</option>
          </select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">状态</div>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 [&>option]:bg-[#0E1626]"
          >
            <option value="all">全部状态</option>
            <option value="pending">正在充值</option>
            <option value="completed">已充值</option>
            <option value="failed">已无效 (failed)</option>
            <option value="cancelled">已无效 (cancelled)</option>
          </select>
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">日期</div>
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5"
            />
            <span className="text-slate-500">至</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5"
            />
          </div>
        </div>
      </div>

      {msg && (
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-xs ${
            msg.kind === "ok"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
              : msg.kind === "warn"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-rose-500/30 bg-rose-500/10 text-rose-200"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full min-w-[1100px] text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2.5">创建时间</th>
              <th className="px-3 py-2.5">客户号</th>
              <th className="px-3 py-2.5">客户姓名</th>
              <th className="px-3 py-2.5">金额 CAD</th>
              <th className="px-3 py-2.5">渠道</th>
              <th className="px-3 py-2.5">状态</th>
              <th className="px-3 py-2.5">参考号</th>
              <th className="px-3 py-2.5">OTT Payment ID</th>
              <th className="px-3 py-2.5">客户备注</th>
              <th className="px-3 py-2.5">凭证</th>
              <th className="px-3 py-2.5">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && (
              <tr>
                <td colSpan={11} className="px-3 py-12 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
                </td>
              </tr>
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-12 text-center text-slate-500">
                  暂无记录
                </td>
              </tr>
            )}
            {rows.map((r: any) => {
              const busy = busyId === r.id;
              const pending = r.status === "pending";
              return (
                <tr key={r.id} className="align-top hover:bg-white/[0.03]">
                  <td className="px-3 py-2.5 text-xs text-slate-400">
                    {new Date(r.created_at).toLocaleString("zh-CN", { hour12: false })}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs">{r.customer_code ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs">{r.customer_name ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-sm font-semibold text-emerald-300">
                    CA${r.amount_cad.toFixed(2)}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-slate-300">
                    {APP_CHANNEL_LABEL[r.channel] ?? r.channel ?? "其他"}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        APP_STATUS_COLOR[r.status] ?? "border-slate-500/30 bg-slate-500/10 text-slate-300"
                      }`}
                    >
                      {APP_STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    {r.provider_status && (
                      <div className="mt-0.5 text-[10px] text-slate-500">OTT: {r.provider_status}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-slate-500">{r.ref_no ?? "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-slate-500">
                    {r.provider_payment_id ?? "—"}
                  </td>
                  <td className="px-3 py-2.5 max-w-[180px] truncate text-xs text-slate-400" title={r.customer_note}>
                    {r.customer_note || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {r.channel === "emt" && r.proof_path ? (
                      <button
                        disabled={busy}
                        onClick={() => onViewProof(r)}
                        className="rounded border border-white/10 px-2 py-0.5 text-[11px] text-blue-300 hover:bg-white/5 disabled:opacity-40"
                      >
                        查看凭证
                      </button>
                    ) : (
                      <span className="text-slate-600">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col gap-1">
                      {pending && r.channel === "emt" && (
                        <button
                          disabled={busy}
                          onClick={() => onConfirmEmt(r)}
                          className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                        >
                          {busy ? "处理中…" : "确认到账"}
                        </button>
                      )}
                      {pending && r.is_ott && (
                        <button
                          disabled={busy}
                          onClick={() => onQueryOtt(r)}
                          className="rounded bg-blue-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-blue-500 disabled:opacity-40"
                        >
                          {busy ? "查询中…" : "向 OTT 查询"}
                        </button>
                      )}
                      {(pending || r.status === "failed") && (
                        <button
                          disabled={busy}
                          onClick={() => onVoid(r)}
                          className="rounded border border-rose-500/40 px-2 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/10 disabled:opacity-40"
                        >
                          标记无效
                        </button>
                      )}
                      {!pending && r.status !== "failed" && (
                        <span className="text-[10px] text-slate-500">
                          {r.verified_at ? new Date(r.verified_at).toLocaleDateString("zh-CN") : "—"}
                          {r.receipt_reason ? ` · ${r.receipt_reason}` : ""}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <div className="text-slate-400">
          共 {total} 条 · 第 {page} / {totalPages} 页
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
    </>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  onPage,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onPage: (p: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onPage(1);
        }}
        placeholder={label}
        className="w-36 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-slate-100 placeholder:text-slate-600"
      />
    </div>
  );
}
