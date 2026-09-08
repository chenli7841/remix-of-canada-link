import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listInvoices,
  updateInvoiceStatus,
  deleteInvoice,
  financeSummary,
  mergeInvoices,
} from "@/lib/invoices.functions";
import { resetAndSeedWaybills } from "@/lib/seed.functions";
import { getMyRoles } from "@/lib/admin.functions";
import { FileText, Loader2, Trash2, CheckCircle2, Ban, Database, GitMerge, Download } from "lucide-react";

export const Route = createFileRoute("/admin/invoices/")({
  validateSearch: (s: Record<string, unknown>) =>
    ({ userId: typeof s.userId === "string" ? s.userId : undefined }) as { userId?: string },

  component: InvoicesPage,
});

const STATUS_COLORS: Record<string, string> = {
  unpaid: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  overdue: "border-rose-500/30 bg-rose-500/10 text-rose-300",
  void: "border-slate-500/30 bg-slate-500/10 text-slate-400",
};
const STATUS_LABEL: Record<string, string> = { unpaid: "待付", paid: "已付", overdue: "逾期", void: "作废" };
const invoiceTotalCad = (invoice: any) => Number(invoice.total_cny ?? 0) * Number(invoice.fx_rate ?? 0.19);
const formatCad = (value: number) =>
  `CA$${value.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function InvoicesPage() {
  const fetchList = useServerFn(listInvoices);
  const fetchSum = useServerFn(financeSummary);
  const update = useServerFn(updateInvoiceStatus);
  const del = useServerFn(deleteInvoice);
  const merge = useServerFn(mergeInvoices);
  const seed = useServerFn(resetAndSeedWaybills);
  const fetchRoles = useServerFn(getMyRoles);
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");
  const [q, setQ] = useState("");
  const [seedBusy, setSeedBusy] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);

  const { userId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const meQ = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles(), staleTime: 60_000 });
  const isOwner = (meQ.data?.roles ?? []).includes("owner");
  const listQ = useQuery({
    queryKey: ["admin-invoices", page, status, q, userId],
    queryFn: () =>
      fetchList({
        data: { page, pageSize: 20, status: status || undefined, q: q || undefined, userId: userId || undefined },
      }),
  });
  const sumQ = useQuery({ queryKey: ["finance-summary"], queryFn: () => fetchSum({ data: {} }) });

  const onMarkPaid = async (id: string) => {
    if (!confirm("确认标记为已付款？")) return;
    await update({ data: { id, status: "paid" } });
    qc.invalidateQueries({ queryKey: ["admin-invoices"] });
    qc.invalidateQueries({ queryKey: ["finance-summary"] });
  };
  const onVoid = async (id: string) => {
    if (!confirm("确认作废？")) return;
    await update({ data: { id, status: "void" } });
    qc.invalidateQueries({ queryKey: ["admin-invoices"] });
  };
  const onDelete = async (id: string) => {
    if (!confirm("确认删除？")) return;
    await del({ data: { id } });
    qc.invalidateQueries({ queryKey: ["admin-invoices"] });
  };
  const onSeed = async () => {
    if (!confirm("⚠️ 将删除现有集运订单、运单、账单，并重新生成 50 个集运订单（含物品和运单）。继续？")) return;
    setSeedBusy(true);
    setSeedMsg(null);
    try {
      const r = await seed({ data: { count: 50 } });
      setSeedMsg(
        `✓ 已生成 ${r.forwardingOrders} 个集运订单 / ${r.forwardingItems} 个物品 / ${r.waybills} 条运单 / ${r.batches} 个批次（其中 ${r.multiWaybillOrders} 个为多运单）`,
      );
    } catch (e: any) {
      setSeedMsg("✗ " + e.message);
    } finally {
      setSeedBusy(false);
    }
  };

  const onExportCsv = async () => {
    setExporting(true);
    try {
      const rows: any[] = [];
      for (let p = 1; p <= 10; p++) {
        const r = await fetchList({
          data: { page: p, pageSize: 100, status: status || undefined, q: q || undefined, userId: userId || undefined },
        });
        rows.push(...r.items);
        if (rows.length >= r.total || r.items.length === 0) break;
      }
      const header = ["账单号", "客户", "客户号", "类型", "金额CAD", "状态", "到期日", "创建时间"];
      const csvRows = rows.map((r: any) => [
        r.invoice_no,
        r.customer?.full_name ?? r.customer?.email ?? "",
        r.customer?.customer_code ?? "",
        r.type,
        invoiceTotalCad(r).toFixed(2),
        STATUS_LABEL[r.status] ?? r.status,
        r.due_date ?? "",
        new Date(r.created_at).toLocaleString("zh-CN"),
      ]);
      const csv = [header, ...csvRows]
        .map((row) => row.map((v: any) => `"${String(v).replace(/"/g, '""')}"`).join(","))
        .join("\r\n");
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert("导出失败: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const items = listQ.data?.items ?? [];
  const total = listQ.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 20));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-400" />
            账单管理
          </h1>
          <p className="mt-1 text-sm text-slate-400">共 {total} 张账单</p>
        </div>
        {isOwner && (
          <div className="flex flex-col items-end gap-1">
            <button
              onClick={onSeed}
              disabled={seedBusy}
              className="inline-flex items-center gap-1.5 rounded-md bg-rose-500/20 px-3 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-500/30 disabled:opacity-50"
            >
              {seedBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
              重置并生成测试运单
            </button>
            {seedMsg && <div className="text-xs text-slate-400">{seedMsg}</div>}
          </div>
        )}
      </div>

      {/* Finance summary */}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="近30天开票额" value={formatCad(sumQ.data?.total_cad ?? 0)} />
        <Stat label="已收款" value={formatCad(sumQ.data?.paid_cad ?? 0)} color="text-emerald-300" />
        <Stat label="待收款" value={formatCad(sumQ.data?.unpaid_cad ?? 0)} color="text-amber-300" />
        <Stat label="逾期金额" value={formatCad(sumQ.data?.overdue_cad ?? 0)} color="text-rose-300" />
      </div>

      {userId && (
        <div className="mb-3 flex items-center justify-between rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs text-blue-200">
          <span>
            已按用户筛选账单 · <span className="font-mono">{userId.slice(0, 8)}</span>
          </span>
          <button
            onClick={() => navigate({ search: {} })}
            className="rounded border border-white/10 px-2 py-0.5 text-[11px] hover:bg-white/5"
          >
            清除筛选
          </button>
        </div>
      )}

      {/* Filter */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 [&>option]:bg-[#0E1626]"
        >
          <option value="">全部状态</option>
          <option value="unpaid">待付</option>
          <option value="paid">已付</option>
          <option value="overdue">逾期</option>
          <option value="void">作废</option>
        </select>
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="搜索账单号"
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5"
        />
        <button
          onClick={onExportCsv}
          disabled={exporting}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 hover:bg-white/5 disabled:opacity-50"
        >
          {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}导出
          CSV（按当前筛选）
        </button>
        {selected.size >= 2 && (
          <button
            onClick={async () => {
              if (!confirm(`将选中的 ${selected.size} 张未付账单合并为一张？`)) return;
              try {
                const r: any = await merge({ data: { ids: Array.from(selected) } });
                alert(`已合并：${r.invoice.invoice_no}`);
                setSelected(new Set());
                qc.invalidateQueries({ queryKey: ["admin-invoices"] });
              } catch (e: any) {
                alert("失败: " + e.message);
              }
            }}
            className="inline-flex items-center gap-1 rounded-md bg-blue-500/20 px-3 py-1.5 text-blue-200 hover:bg-blue-500/30"
          >
            <GitMerge className="h-3.5 w-3.5" />
            合并 {selected.size} 张
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={items.length > 0 && items.every((i: any) => selected.has(i.id))}
                  onChange={(e) => {
                    const s = new Set(selected);
                    if (e.target.checked) items.forEach((i: any) => i.status === "unpaid" && s.add(i.id));
                    else items.forEach((i: any) => s.delete(i.id));
                    setSelected(s);
                  }}
                />
              </th>
              <th className="px-4 py-2.5">账单号</th>
              <th className="px-4 py-2.5">客户</th>
              <th className="px-4 py-2.5">类型</th>
              <th className="px-4 py-2.5">金额 (CAD)</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">到期</th>
              <th className="px-4 py-2.5">创建</th>
              <th className="px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {listQ.isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
                </td>
              </tr>
            )}
            {items.length === 0 && !listQ.isLoading && (
              <tr>
                <td colSpan={9} className="px-4 py-12 text-center text-slate-500">
                  暂无账单
                </td>
              </tr>
            )}
            {items.map((r: any) => (
              <tr key={r.id} className="hover:bg-white/[0.03]">
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    disabled={r.status !== "unpaid"}
                    checked={selected.has(r.id)}
                    onChange={() => {
                      const s = new Set(selected);
                      s.has(r.id) ? s.delete(r.id) : s.add(r.id);
                      setSelected(s);
                    }}
                  />
                </td>
                <td className="px-4 py-3 font-mono text-xs">
                  <Link
                    to="/admin/invoices/$invoiceId"
                    params={{ invoiceId: r.id }}
                    className="text-blue-300 hover:underline"
                  >
                    {r.invoice_no}
                  </Link>
                </td>
                <td className="px-4 py-3 text-xs">
                  {r.customer ? (
                    <div>
                      <div>{r.customer.full_name ?? r.customer.email}</div>
                      <div className="font-mono text-[10px] text-slate-500">{r.customer.customer_code}</div>
                    </div>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-xs">
                  {r.type}
                  {r.batch_no ? <div className="font-mono text-[10px] text-slate-500">{r.batch_no}</div> : null}
                </td>
                <td className="px-4 py-3 text-sm font-semibold">{formatCad(invoiceTotalCad(r))}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[r.status]}`}
                  >
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{r.due_date ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-right">
                  <div className="inline-flex gap-1">
                    {r.status === "unpaid" && (
                      <button
                        onClick={() => onMarkPaid(r.id)}
                        title="标记已付"
                        className="rounded-md border border-emerald-500/30 p-1.5 text-emerald-300 hover:bg-emerald-500/10"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {r.status !== "void" && r.status !== "paid" && (
                      <button
                        onClick={() => onVoid(r.id)}
                        title="作废"
                        className="rounded-md border border-slate-500/30 p-1.5 text-slate-300 hover:bg-slate-500/10"
                      >
                        <Ban className="h-3.5 w-3.5" />
                      </button>
                    )}
                    <button
                      onClick={() => onDelete(r.id)}
                      title="删除"
                      className="rounded-md border border-rose-500/30 p-1.5 text-rose-300 hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm">
        <div className="text-slate-400">
          第 {page} / {totalPages} 页
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

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 font-display text-xl font-bold ${color ?? "text-slate-100"}`}>{value}</div>
    </div>
  );
}
