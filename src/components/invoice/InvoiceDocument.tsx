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
  const fx = Number(inv.fx_rate) > 0 ? Number(inv.fx_rate) : 0.19;
  const toCad = (cny: number) => +(cny * fx).toFixed(2);
  const totalCad = toCad(Number(inv.total_cny));
  const logo = template.logo_url || company.logo_url;

  // Where meta is available, re-derive every footer row from the same
  // per-item CAD numbers the tables above use, so they always agree —
  // inv.freight_cny/customs_cny/etc. are still CNY ledger columns, and
  // inv.customs_cny is duty_cad's full mfn+GST+anti-dumping total anyway
  // (关税 and GST were never separate ledger columns to begin with).
  const hasMeta = items.some((it: any) => it.meta);
  const freightFromMeta = items.reduce((s: number, it: any) => s + Number(it.meta?.freight?.amount_cad ?? 0), 0);
  const dutyFromMeta = items.reduce(
    (s: number, it: any) =>
      s +
      (it.meta?.duty_items ?? []).reduce((s2: number, di: any) => s2 + Number(di.customs_cad) + Number(di.gst_cad), 0),
    0,
  );
  const otherFromMeta = items
    .filter((it: any) => !it.meta?.freight)
    .reduce((s: number, it: any) => s + Number(it.meta?.amount_cad ?? toCad(Number(it.amount_cny ?? 0))), 0);

  const freightTotal = hasMeta ? freightFromMeta : toCad(Number(inv.freight_cny));
  const dutyTotal = hasMeta ? dutyFromMeta : toCad(Number(inv.customs_cny));
  const insuranceTotal = toCad(Number(inv.insurance_cny));
  const otherTotal = hasMeta ? otherFromMeta : toCad(Number(inv.other_cny ?? 0));

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

        <InvoiceLineTables items={items} fx={fx} batchNo={inv.batch_no} />

        <div className="ml-auto w-72 space-y-1 text-sm">
          <Row k="运费合计" v={`CA$${freightTotal.toFixed(2)}`} />
          <Row k="关税及GST合计" v={`CA$${dutyTotal.toFixed(2)}`} />
          <Row k="保险合计" v={`CA$${insuranceTotal.toFixed(2)}`} />
          {otherTotal !== 0 && <Row k="其他费用合计" v={`CA$${otherTotal.toFixed(2)}`} />}
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

// Four itemized tables: 运费 (one line for the whole batch — consolidated
// freight is billed by batch, not per waybill, so the waybills going into
// it are just listed as that row's own content, not one row each), 关税
// and GST (one line per underlying item, from
// invoice_items[].meta.customs_items/gst_items — see duty.server.ts
// buildInvoiceLineMeta), and 其他费用 (anything left over: clearance/
// surcharge fees, storage-fee invoices, discounts, manual rows).
// Everything's CAD; older invoices generated before `meta` existed fall
// back to converting their *_cny columns through `fx` so they still render.
function InvoiceLineTables({ items, fx, batchNo }: { items: any[]; fx: number; batchNo?: string | null }) {
  const toCad = (cny: number) => +(cny * fx).toFixed(2);
  const freightRows = items.filter((it) => it.meta?.freight);
  const freightWaybillNos = freightRows.map((it: any) => it.meta.waybill_no ?? it.description).join("、");
  const freightWeightTotal = freightRows.reduce(
    (s: number, it: any) => s + Number(it.meta.freight.chargeable_weight_kg ?? 0),
    0,
  );
  const freightAmountTotal = freightRows.reduce(
    (s: number, it: any) => s + Number(it.meta.freight.amount_cad ?? toCad(Number(it.freight_cny))),
    0,
  );
  // Batches are one route/shipping method, so the per-kg rate is the same
  // across every waybill in it — just read it off the first row.
  const freightRate = Number(freightRows[0]?.meta?.freight?.rate_cad_per_kg ?? 0);
  const dutyRows = items.flatMap((it: any) =>
    (it.meta?.duty_items ?? []).map((di: any) => ({ ...di, waybill_no: it.meta?.waybill_no })),
  );
  const otherRows = items.filter((it) => !it.meta?.freight);
  const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString() : null);

  // 批次号/说明/计费周期/体积/费率 — whichever of these a fee type actually
  // has — all merged into one "明细说明" column instead of a column each.
  const otherNote = (it: any) => {
    const m = it.meta ?? {};
    const parts: string[] = [];
    if (m.batch_no) parts.push(`批次 ${m.batch_no}`);
    if (m.note) parts.push(m.note);
    if (m.period_from) {
      const from = fmtDate(m.period_from);
      const to = fmtDate(m.period_to);
      const period = from && to ? `${from} ~ ${to}` : from || to || null;
      if (period) parts.push(m.billable_days != null ? `${period}（${m.billable_days} 天）` : period);
    }
    if (m.cbm_charged != null) parts.push(`${Number(m.cbm_charged).toFixed(2)} cbm`);
    if (m.rate_cad_per_cbm_day != null) parts.push(`CA$${Number(m.rate_cad_per_cbm_day).toFixed(2)}/cbm/天`);
    if (m.waybill_no && !m.batch_no) parts.push(`运单 ${m.waybill_no}`);
    return parts.length ? parts.join(" · ") : it.description;
  };

  return (
    <div className="mb-4 space-y-5">
      {freightRows.length > 0 && (
        <Section title="运费">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-2">批次号</th>
                <th className="py-2">运单号</th>
                <th className="py-2 text-right">计费重量</th>
                <th className="py-2 text-right">运费单价</th>
                <th className="py-2 text-right">小计</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="py-2 font-mono">{batchNo ?? "—"}</td>
                <td className="py-2 text-slate-500">{freightWaybillNos}</td>
                <td className="py-2 text-right">{freightWeightTotal.toFixed(2)} kg</td>
                <td className="py-2 text-right">CA${freightRate.toFixed(2)}/kg</td>
                <td className="py-2 text-right font-semibold">CA${freightAmountTotal.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}

      {dutyRows.length > 0 && (
        <Section title="关税及GST">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-2">物品名称</th>
                <th className="py-2 text-right">货值</th>
                <th className="py-2 text-right">关税率</th>
                <th className="py-2 text-right">关税</th>
                <th className="py-2 text-right">GST 税率</th>
                <th className="py-2 text-right">GST</th>
                <th className="py-2 text-right">小计</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dutyRows.map((di: any, i: number) => (
                <tr key={i}>
                  <td className="py-2">{di.name}</td>
                  <td className="py-2 text-right">CA${Number(di.value_cad).toFixed(2)}</td>
                  <td className="py-2 text-right">{Number(di.customs_rate_pct).toFixed(2)}%</td>
                  <td className="py-2 text-right">CA${Number(di.customs_cad).toFixed(2)}</td>
                  <td className="py-2 text-right">{Number(di.gst_rate_pct).toFixed(2)}%</td>
                  <td className="py-2 text-right">CA${Number(di.gst_cad).toFixed(2)}</td>
                  <td className="py-2 text-right font-semibold">
                    CA${(Number(di.customs_cad) + Number(di.gst_cad)).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {otherRows.length > 0 && (
        <Section title="其他费用">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="py-2">费用类型</th>
                <th className="py-2">明细说明</th>
                <th className="py-2 text-right">小计</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {otherRows.map((it: any) => (
                <tr key={it.id}>
                  <td className="py-2">{it.meta?.fee_type ?? it.description}</td>
                  <td className="py-2 text-slate-500">{otherNote(it)}</td>
                  <td className="py-2 text-right font-semibold">
                    CA${Number(it.meta?.amount_cad ?? toCad(Number(it.amount_cny ?? 0))).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
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
