import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { listMyInvoices, payInvoice, getInvoice } from "@/lib/invoices.functions";
import { useCompanyInfo, usePrintTemplate } from "@/lib/company";
import { downloadElementAsPdf } from "@/lib/pdf";
import { InvoiceDocument } from "@/components/invoice/InvoiceDocument";
import { FileText, Loader2, Printer, Download, Wallet, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/invoices")({
  head: () => ({ meta: [{ title: "我的账单 — SinoCargo" }] }),
  component: MyInvoicesPage,
});

const STATUS_LABEL: Record<string, string> = { unpaid: "待付", paid: "已付", overdue: "逾期", void: "作废" };
const STATUS_COLORS: Record<string, string> = {
  unpaid: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
  overdue: "bg-rose-100 text-rose-700",
  void: "bg-slate-200 text-slate-600",
};

function MyInvoicesPage() {
  const fetchList = useServerFn(listMyInvoices);
  const fetchOne = useServerFn(getInvoice);
  const pay = useServerFn(payInvoice);
  const qc = useQueryClient();
  const company = useCompanyInfo();
  const template = usePrintTemplate();
  const docRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const q = useQuery({ queryKey: ["my-invoices", page], queryFn: () => fetchList({ data: { page, pageSize: 20 } }) });
  const detailQ = useQuery({
    queryKey: ["my-invoice", openId],
    queryFn: () => fetchOne({ data: { id: openId! } }),
    enabled: !!openId,
  });

  const onDownload = async () => {
    if (!docRef.current || !detailQ.data) return;
    setDownloading(true);
    try {
      await downloadElementAsPdf(docRef.current, `${detailQ.data.invoice.invoice_no}.pdf`);
    } catch (e: any) {
      alert("生成 PDF 失败: " + (e.message ?? e));
    } finally {
      setDownloading(false);
    }
  };

  const onPay = async (id: string) => {
    if (!confirm("使用钱包余额支付？")) return;
    const r: any = await pay({ data: { id } });
    if (!r.ok) {
      alert(
        r.reason === "insufficient" ? `余额不足，需 CA$${r.need_cad}，当前 CA$${r.balance_cad}` : "失败: " + r.reason,
      );
      return;
    }
    qc.invalidateQueries({ queryKey: ["my-invoices"] });
    qc.invalidateQueries({ queryKey: ["my-invoice", id] });
  };

  if (openId) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <button
          onClick={() => setOpenId(null)}
          className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 print:hidden"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </button>
        {detailQ.isLoading && <Loader2 className="mx-auto h-6 w-6 animate-spin" />}
        {detailQ.data && (
          <>
            <div className="mb-4 flex justify-end gap-2 print:hidden">
              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                <Printer className="h-4 w-4" />
                打印
              </button>
              <button
                onClick={onDownload}
                disabled={downloading}
                className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}下载 PDF
              </button>
              {detailQ.data.invoice.status === "unpaid" && (
                <button
                  onClick={() => onPay(detailQ.data.invoice.id)}
                  className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  <Wallet className="h-4 w-4" />
                  钱包支付
                </button>
              )}
            </div>
            <InvoiceDocument
              ref={docRef}
              inv={detailQ.data.invoice}
              items={detailQ.data.items}
              customer={detailQ.data.customer}
              company={company}
              template={template}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-5 font-display text-2xl font-bold inline-flex items-center gap-2">
        <FileText className="h-5 w-5 text-blue-500" />
        我的账单
      </h1>
      <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-2.5">账单号</th>
              <th className="px-4 py-2.5">类型</th>
              <th className="px-4 py-2.5">金额</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">到期</th>
              <th className="px-4 py-2.5 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {q.isLoading && (
              <tr>
                <td colSpan={6} className="py-12 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />
                </td>
              </tr>
            )}
            {q.data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-400">
                  暂无账单
                </td>
              </tr>
            )}
            {q.data?.items.map((r: any) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-mono text-xs">{r.invoice_no}</td>
                <td className="px-4 py-3 text-xs">{r.type}</td>
                <td className="px-4 py-3 font-semibold">¥{Number(r.total_cny).toFixed(2)}</td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-500">{r.due_date ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => setOpenId(r.id)} className="text-xs text-blue-600 hover:underline">
                    查看
                  </button>
                  {r.status === "unpaid" && (
                    <button onClick={() => onPay(r.id)} className="ml-2 text-xs text-emerald-600 hover:underline">
                      支付
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
