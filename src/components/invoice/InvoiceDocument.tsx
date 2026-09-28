import { invoiceDisplay } from "@/lib/invoice-display";
import { forwardRef, type ReactNode } from "react";
import type { CompanyInfo } from "@/lib/company";

type PrintTemplate = {
  logo_url?: string | null;
  header?: string | null;
  footer?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  unpaid: "待付款",
  paid: "已付款",
  overdue: "已逾期",
  void: "已作废",
};
const STATUS_COLOR: Record<string, string> = {
  unpaid: "bg-amber-100 text-amber-700",
  paid: "bg-emerald-100 text-emerald-700",
  overdue: "bg-rose-100 text-rose-700",
  void: "bg-slate-200 text-slate-600",
};

interface Props {
  inv: any;
  items: any[];
  customer: any;
  company: CompanyInfo;
  template: PrintTemplate;
  paidCad?: number;
  remainCad?: number;
}

// The whole invoice settles in CAD (see settleBatchForCustomer /
// pay_storage_fees) — the ledger itself still keys off *_cny columns
// (that's the accounting currency the rest of the app reconciles against),
// but everything shown here is converted through inv.fx_rate, or read
// straight from the CAD-native `meta` fields duty.server.ts already
// computes (declared value, duty, freight rate — all genuinely CAD to
// begin with, no conversion needed).
export const InvoiceDocument = forwardRef<HTMLDivElement, Props>(function InvoiceDocument(
  { inv, items, customer, company, template, paidCad, remainCad },
  ref,
) {
  const display = invoiceDisplay(inv, items);
  const totalCad = display.total;
  const logo = template.logo_url || company.logo_url;

  return (
    <>
      {/* `window.print()` (the 打印 button in invoices.tsx) uses this;
          downloadElementAsPdf paginates to real A4 pages independently
          (pdf.ts), it doesn't rely on @page at all. */}
      <style>{"@page { size: A4; margin: 14mm; }"}</style>
      <div
        ref={ref}
        // Fixed to A4 width (210mm) on screen and on print, so what
        // staff/customers see is always what prints — not "however wide
        // the browser window happens to be".
        className="mx-auto w-[210mm] max-w-full rounded-2xl border border-border bg-white p-8 text-slate-900 shadow-2xl print:w-auto print:rounded-none print:border-0 print:shadow-none"
      >
        <div className="mb-6 flex items-start justify-between">
          <div className="flex items-center gap-3">
            {logo && <img src={logo} alt={company.name} className="h-12 w-12 shrink-0 rounded object-contain" />}
            <div>
              <div className="font-display text-2xl font-bold">{template.header || `${company.name} · 账单`}</div>
              <div className="mt-1 text-sm text-slate-500">INVOICE</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-lg font-bold">{inv.invoice_no}</div>
            <div className="mt-1 text-xs text-slate-500">开具: {new Date(inv.created_at).toLocaleDateString()}</div>
            {inv.due_date && <div className="text-xs text-slate-500">到期: {inv.due_date}</div>}
            <div
              className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLOR[inv.status] ?? ""}`}
            >
              {STATUS_LABEL[inv.status] ?? inv.status}
            </div>
          </div>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">收款方</div>
            <div className="font-semibold">{company.name}</div>
            {company.address && <div className="text-xs text-slate-600">{company.address}</div>}
            {company.phone && <div className="text-xs text-slate-500">{company.phone}</div>}
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">付款方</div>
            {/* invoice_title/phone/email/address (set under 我的账户 → 个人资料 →
              发票信息) take priority over the account's own name/phone/email —
              lets a business customer put their company details on the bill. */}
            <div className="font-semibold">
              {customer?.invoice_title ?? customer?.full_name ?? customer?.email ?? "—"}
            </div>
            <div className="font-mono text-xs text-slate-500">客户号 {customer?.customer_code}</div>
            {(customer?.invoice_phone ?? customer?.phone) && (
              <div className="text-xs text-slate-500">{customer.invoice_phone ?? customer.phone}</div>
            )}
            {(customer?.invoice_email ?? customer?.email) && (
              <div className="text-xs text-slate-500">{customer.invoice_email ?? customer.email}</div>
            )}
            {customer?.invoice_address && <div className="text-xs text-slate-500">{customer.invoice_address}</div>}
          </div>
        </div>

        <InvoiceLineTables display={display} batchNo={inv.batch_no} />
        {display.mismatch && <div className="mb-3 text-sm text-red-600">账单明细与合计不一致，请后台核对原始账单。</div>}

        <div className="ml-auto w-72 space-y-1 text-sm">
          <Row k="运费合计" v={`CA$${display.freightTotal.toFixed(2)}`} />
          <Row k="其他费用合计" v={`CA$${display.otherTotal.toFixed(2)}`} />
          <div className="my-2 border-t border-slate-200" />
          <Row k="应付总额 (CAD)" v={`CA$${totalCad.toFixed(2)}`} big />
          {paidCad != null && paidCad > 0 && <Row k="已收 (CAD)" v={`CA$${paidCad.toFixed(2)}`} />}
          {paidCad != null && remainCad != null && paidCad > 0 && paidCad < totalCad && (
            <Row k="待收 (CAD)" v={`CA$${remainCad.toFixed(2)}`} />
          )}
        </div>

        {inv.note && <div className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500">备注: {inv.note}</div>}
        {template.footer && (
          <div className="mt-6 border-t border-slate-200 pt-4 text-center text-[11px] text-slate-400">
            {template.footer}
          </div>
        )}
      </div>
    </>
  );
});

// Each route keeps its saved customer/batch weight, rate and freight subtotal.
function InvoiceLineTables({ display, batchNo }: { display: ReturnType<typeof invoiceDisplay>; batchNo?: string | null }) {
  return <div className="mb-4 space-y-5">
    {display.freight.length > 0 && <Section title="运费">
      {display.batchWeight != null && <div className="mb-2 text-xs text-slate-500">本客户批次计费重量合计：{display.batchWeight.toFixed(3)} kg</div>}
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 text-left text-[11px] text-slate-500"><tr>
          <th className="py-2">批次号</th><th>线路</th><th className="text-right">计费重量</th><th className="text-right">运费单价</th><th className="text-right">小计</th>
        </tr></thead>
        <tbody>{display.freight.map(row=><tr key={row.id} className="border-b border-slate-100">
          <td className="py-2 font-mono">{batchNo ?? "—"}</td><td>{row.route}</td>
          <td className="text-right">{row.weight == null ? "未保存" : row.weight.toFixed(3)+" kg"}</td>
          <td className="text-right">{row.rate == null ? "未保存" : "CA$"+row.rate.toFixed(2)+"/kg"}</td>
          <td className="text-right font-semibold">{"CA$"+row.amount.toFixed(2)}</td>
        </tr>)}</tbody>
      </table>
    </Section>}
    {display.other.length > 0 && <Section title="其他费用">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 text-left text-[11px] text-slate-500"><tr><th className="py-2">费用类型</th><th>明细说明</th><th className="text-right">小计</th></tr></thead>
        <tbody>{display.other.map(row=><tr key={row.id} className="border-b border-slate-100">
          <td className="py-2">{row.label}</td><td className="text-slate-500">{row.description}</td><td className="text-right font-semibold">{"CA$"+row.amount.toFixed(2)}</td>
        </tr>)}</tbody>
      </table>
    </Section>}
  </div>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{title}</div>
      {children}
    </div>
  );
}

function Row({ k, v, big }: { k: string; v: string; big?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${big ? "text-base font-bold" : ""}`}>
      <span className="text-slate-500">{k}</span>
      <span>{v}</span>
    </div>
  );
}
