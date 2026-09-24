import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { BatchPartiesEditor } from "@/components/admin/BatchPartiesEditor";
import {
  getBatchDetail,
  getBatchFeeSummary,
  updateBatchStatus,
  assignWaybillsToBatch,
  listWaybills,
  updateBatch,
  batchUpdateWaybillsByBatch,
  deductWalletForBatch,
  deductWalletForBatchBulk,
  deductBatchOffline,
  confirmAllBatchPrices,
  refreshBatchAllSnapshots,
  type BatchStatus,
  type WaybillStatus,
} from "@/lib/orders.functions";
import {
  listCartons,
  listPallets,
  updateCarton,
  updatePallet,
  getContainerLabelData,
  splitPallet,
} from "@/lib/cartons.functions";
import { getMyRoles } from "@/lib/admin.functions";
import { listBatchInvoices } from "@/lib/invoices.functions";
import { invoiceReasonText } from "@/lib/invoice-reason-text";
import {
  BATCH_STATUS_LABEL,
  BATCH_STATUS_COLOR,
  WAYBILL_STATUS_LABEL,
  WAYBILL_STATUS_COLOR,
  METHOD_LABEL,
  StatusBadge,
  Card,
  fmtDate,
  BackLink,
} from "@/lib/admin-shared";
import { SurchargePanel } from "@/components/admin/SurchargePanel";
import { CustomerDrawer } from "@/components/admin/CustomerDrawer";
import { WaybillCompactList, CartonCompactList, PalletCompactList } from "@/components/admin/ContainerChildList";
import { renderLabel } from "@/lib/label-render";
import { LabelSizeToggle } from "@/components/admin/LabelSizeToggle";
import { Loader2, X, Wand2, Printer, ScanLine, ChevronRight, ChevronDown, AlertCircle, Wallet, Upload, Download, Sparkles, FileText, CheckCheck, RefreshCw } from "lucide-react";
import { ScanAddDialog } from "@/components/admin/ScanAddDialog";
import { DateInput } from "@/components/admin/DateInput";
import { WorkflowStepper, BATCH_FLOW } from "@/components/admin/WorkflowStepper";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  autoMatchBatchHsCodes,
  extractBatchHbl,
  getBatchCustomsReadiness,
  getBatchInvoiceExport,
} from "@/lib/batch-customs.functions";
import { downloadBatchInvoiceWorkbook } from "@/lib/batch-invoice-xls";

export const Route = createFileRoute("/admin/batches/$batchId")({ component: BatchDetail });

const STATUSES: BatchStatus[] = ["draft", "locked", "shipped", "arrived", "closed"];
const WAYBILL_STATUSES: WaybillStatus[] = [
  "pending",
  "received",
  "packed",
  "shipped",
  "in_transit",
  "ready_pickup",
  "delivered",
  "cancelled",
];

function BatchDetail() {
  const { batchId } = Route.useParams();
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getBatchDetail);
  const fetchFees = useServerFn(getBatchFeeSummary);
  const fetchRoles = useServerFn(getMyRoles);
  const fetchWaybills = useServerFn(listWaybills);
  const setBatchStatus = useServerFn(updateBatchStatus);
  const assign = useServerFn(assignWaybillsToBatch);
  const updBatch = useServerFn(updateBatch);
  const bulkOp = useServerFn(batchUpdateWaybillsByBatch);
  const fetchCartons = useServerFn(listCartons);
  const fetchPallets = useServerFn(listPallets);
  const updCarton = useServerFn(updateCarton);
  const updPallet = useServerFn(updatePallet);
  const fetchLabel = useServerFn(getContainerLabelData);
  const deduct = useServerFn(deductWalletForBatch);
  const deductOffline = useServerFn(deductBatchOffline);
  const bulkDeduct = useServerFn(deductWalletForBatchBulk);
  const confirmAllPrices = useServerFn(confirmAllBatchPrices);
  const refreshAllSnapshots = useServerFn(refreshBatchAllSnapshots);
  const [refreshingAllSnap, setRefreshingAllSnap] = useState(false);
  const doSplitPallet = useServerFn(splitPallet);
  const fetchCustomsReadiness = useServerFn(getBatchCustomsReadiness);
  const matchHsCodes = useServerFn(autoMatchBatchHsCodes);
  const parseHbl = useServerFn(extractBatchHbl);
  const fetchInvoiceExport = useServerFn(getBatchInvoiceExport);

  // 客户号账单 / 运单 / 箱号 / 托盘：默认收起，点击展开才渲染表格，减少长批次的初始滚动长度。
  // 箱号/托盘各自是独立请求，收起时干脆不发请求（enabled 门控）；运单/客户账单的数据
  // 跟批次费用汇总同一个请求（detailQ），汇总卡片本身要一直显示，没法一起门控——它的耗时
  // 要靠上面新增的数据库索引来解决，这里只负责收起时不渲染这两块的表格。
  const [custAcctOpen, setCustAcctOpen] = useState(false);
  const [wbSectionOpen, setWbSectionOpen] = useState(false);
  const [ctSectionOpen, setCtSectionOpen] = useState(false);
  const [plSectionOpen, setPlSectionOpen] = useState(false);

  const detailQ = useQuery({ queryKey: ["admin-batch", batchId], queryFn: () => fetchDetail({ data: { batchId } }) });
  // 费用汇总是慢请求，单独发，用自己的 loading 状态——不阻塞页面框架。
  // key 挂在 ["admin-batch", batchId] 之下，所有对 batch 的 invalidate 会一起刷新它。
  const feeQ = useQuery({
    queryKey: ["admin-batch", batchId, "fees"],
    queryFn: () => fetchFees({ data: { batchId } }),
  });
  const cartonsQ = useQuery({
    queryKey: ["batch-cartons", batchId],
    queryFn: () => fetchCartons({ data: { batch_id: batchId, pageSize: 100 } }),
    enabled: ctSectionOpen,
  });
  const palletsQ = useQuery({
    queryKey: ["batch-pallets", batchId],
    queryFn: () => fetchPallets({ data: { batch_id: batchId, pageSize: 100 } }),
    enabled: plSectionOpen,
  });
  const meQ = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles(), staleTime: 60_000 });
  const canEdit = (meQ.data?.roles ?? []).some((r) => r === "owner" || r === "manager");
  const customsQ = useQuery({
    queryKey: ["batch-customs-readiness", batchId],
    queryFn: () => fetchCustomsReadiness({ data: { batchId } }),
  });

  // 客户账单 / 运单 / 箱号 / 托盘 各自的搜索框（客户端过滤，数据已在内存里，不用再发请求）
  const [custAcctSearch, setCustAcctSearch] = useState("");
  const [wbSearch, setWbSearch] = useState("");
  const [ctSearch, setCtSearch] = useState("");
  const [plSearch, setPlSearch] = useState("");
  const [showAssign, setShowAssign] = useState(false);
  const [showAddCarton, setShowAddCarton] = useState(false);
  const [showAddPallet, setShowAddPallet] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [showScan, setShowScan] = useState(false);
  const [search, setSearch] = useState("");
  const availQ = useQuery({
    queryKey: ["admin-waybills-avail", search],
    queryFn: () => fetchWaybills({ data: { search, pageSize: 50, status: "all" } }),
    enabled: showAssign,
  });
  const allCartonsQ = useQuery({
    queryKey: ["all-cartons-pick"],
    queryFn: () => fetchCartons({ data: { pageSize: 100 } }),
    enabled: showAddCarton,
  });
  const allPalletsQ = useQuery({
    queryKey: ["all-pallets-pick"],
    queryFn: () => fetchPallets({ data: { pageSize: 100 } }),
    enabled: showAddPallet,
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [hblBusy, setHblBusy] = useState(false);
  const [hsBusy, setHsBusy] = useState(false);
  const [invoiceBusy, setInvoiceBusy] = useState(false);
  const [confirmAllBusy, setConfirmAllBusy] = useState(false);
  const [bulkDeductBusy, setBulkDeductBusy] = useState(false);
  const hblInputRef = useRef<HTMLInputElement>(null);
  const onPrintLabel = async () => {
    const d = await fetchLabel({ data: { kind: "batch", id: batchId } });
    renderLabel(d as any);
  };

  const onUploadHbl = async (file: File) => {
    if (!canEdit) return;
    if (file.size > 25 * 1024 * 1024) return toast.error("提单文件不能超过 25MB");
    if (file.type !== "application/pdf" && !file.type.startsWith("image/")) return toast.error("请上传 PDF 或图片提单");
    setHblBusy(true);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_");
      const filePath = `batches/${batchId}/${Date.now()}_${safe}`;
      const { error } = await (supabase as any).storage.from("batch-documents").upload(filePath, file, {
        contentType: file.type || undefined,
        upsert: false,
      });
      if (error) throw error;
      await parseHbl({ data: { batchId, filePath, fileName: file.name } });
      toast.success("提单已上传并解析，请检查自动填写结果");
      await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
    } catch (e: any) {
      toast.error(e?.message ?? "提单上传或解析失败");
    } finally {
      setHblBusy(false);
      if (hblInputRef.current) hblInputRef.current.value = "";
    }
  };

  const onAutoMatchHs = async () => {
    setHsBusy(true);
    try {
      const result = await matchHsCodes({ data: { batchId } });
      toast.success(`本地匹配 ${result.local_matched} 条，AI匹配 ${result.ai_matched} 条，剩余 ${result.missing_count} 条`);
      await qc.invalidateQueries({ queryKey: ["batch-customs-readiness", batchId] });
    } catch (e: any) {
      toast.error(e?.message ?? "HS Code 自动匹配失败");
    } finally {
      setHsBusy(false);
    }
  };

  const onDownloadInvoice = async () => {
    setInvoiceBusy(true);
    try {
      const exportData = await fetchInvoiceExport({ data: { batchId } });
      downloadBatchInvoiceWorkbook(exportData);
    } catch (e: any) {
      toast.error(e?.message ?? "Invoice 生成失败");
    } finally {
      setInvoiceBusy(false);
    }
  };

  const onConfirmAllPrices = async () => {
    const customers = fee_summary?.per_customer ?? [];
    const pendingCount = customers.filter((c: any) => !c.price_confirmed).length;
    if (!pendingCount) return toast.info("批次内客户价格均已确认");
    if (!window.confirm(`确认批次内 ${pendingCount} 位客户的价格？此操作只确认价格并生成未付账单，不会扣款。`)) return;
    setConfirmAllBusy(true);
    try {
      const result: any = await confirmAllPrices({ data: { batchId } });
      if (result.invoice_failed?.length) {
        toast.error(
          `已确认 ${result.confirmed_count} 位，但 ${result.invoice_failed.length} 位账单生成失败：${result.invoice_failed
            .map((f: any) => `${f.customer_code}(${f.error})`)
            .join("、")}`,
          { duration: 10000 },
        );
      } else {
        toast.success(`已批量确认 ${result.confirmed_count} 位客户并生成账单，未执行扣款`);
      }
      if (result.invoice_warned?.length) {
        toast.warning(
          `以下 ${result.invoice_warned.length} 位客户本次未生成账单：${result.invoice_warned
            .map((w: any) => `${w.customer_code}(${invoiceReasonText(w.reason)})`)
            .join("、")}`,
          { duration: 15000 },
        );
      }
      if (result.snapshot_ok === false) {
        toast.error(`客户端快照刷新失败：${result.snapshot_error ?? "未知错误"}，可点「刷新全部客户快照」重试`, {
          duration: 10000,
        });
      }
      await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
      await qc.invalidateQueries({ queryKey: ["batch-invoices", batch.batch_no ?? ""] });
    } catch (e: any) {
      toast.error(e?.message ?? "批量确认失败");
    } finally {
      setConfirmAllBusy(false);
    }
  };

  const onBulkDeduct = async () => {
    const customers = fee_summary?.per_customer ?? [];
    // 价格已确认 且 未付清 且 有客户账号 —— 与服务端目标口径一致，仅用于按钮可用性与确认提示
    const eligible = customers.filter((c: any) => c.price_confirmed && !c.is_paid && c.user_id);
    if (!eligible.length) return toast.info("没有可批量扣款的客户（需价格已确认且未付清）");
    if (
      !window.confirm(
        `从钱包余额批量扣款 ${eligible.length} 位客户？只从钱包余额扣，余额不足的客户会自动跳过、不做任何操作。`,
      )
    )
      return;
    setBulkDeductBusy(true);
    try {
      const r: any = await bulkDeduct({ data: { batchId } });
      const parts = [`结清 ${r.settled.length}`];
      if (r.skipped_insufficient.length) parts.push(`余额不足跳过 ${r.skipped_insufficient.length}`);
      if (r.skipped_already_paid.length) parts.push(`已结清 ${r.skipped_already_paid.length}`);
      if (r.failed.length) parts.push(`失败 ${r.failed.length}`);
      toast.success(`批量扣款：${parts.join(" · ")}`);
      if (r.skipped_insufficient.length) {
        toast.info(
          `余额不足跳过：${r.skipped_insufficient
            .map((s: any) => `${s.customer_code}(缺 CA$${(Number(s.need_cad ?? 0) - Number(s.balance_cad ?? 0)).toFixed(2)})`)
            .join("、")}`,
        );
      }
      await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
      await qc.invalidateQueries({ queryKey: ["batch-invoices", batch.batch_no ?? ""] });
    } catch (e: any) {
      toast.error(e?.message ?? "批量扣款失败");
    } finally {
      setBulkDeductBusy(false);
    }
  };

  // 客户端「我的批次」只读快照，不再现算。量尺/箱托盘进出批次等改动目前还没有全部接入自动
  // 刷新——这个按钮是兜底：整批重算并回写每个客户的快照行。
  const onRefreshAllSnapshots = async () => {
    if (!window.confirm("重新计算并刷新本批次所有客户的快照？运单较多时可能需要几秒到十几秒。")) return;
    setRefreshingAllSnap(true);
    try {
      const r: any = await refreshAllSnapshots({ data: { batchId } });
      toast.success(`已刷新 ${r.customers} 位客户的快照`);
      await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
    } catch (e: any) {
      toast.error(e?.message ?? "刷新失败");
    } finally {
      setRefreshingAllSnap(false);
    }
  };

  // meta edit
  const [meta, setMeta] = useState({ display_name: "", eta_date: "", vessel_no: "" });
  const [metaInit, setMetaInit] = useState(false);

  // bulk form
  const [bulkStatus, setBulkStatus] = useState<WaybillStatus | "">("");
  const [bulkEvent, setBulkEvent] = useState({ status_zh: "", location_zh: "", event_time: "" });

  // Customer drawer state
  const [drawerCustomer, setDrawerCustomer] = useState<string | null>(null);
  const [deductState, setDeductState] = useState<{
    user_id: string;
    customer_code: string;
    balance: number;
    subtotal: number;
  } | null>(null);
  const [deductDiscount, setDeductDiscount] = useState("0");
  const [deductMethod, setDeductMethod] = useState<"wallet" | "emt" | "cash">("wallet");
  const [deductRefNo, setDeductRefNo] = useState("");

  if (detailQ.isLoading)
    return (
      <div className="grid place-items-center p-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  if (detailQ.isError) return <div className="p-6 text-rose-400">{(detailQ.error as Error).message}</div>;
  const { batch, waybills, logs, waybill_total } = detailQ.data!;
  const fee_summary = feeQ.data?.fee_summary ?? null;
  const independent_clearance = feeQ.data?.independent_clearance ?? null;
  if (!metaInit) {
    setMeta({ display_name: batch.display_name ?? "", eta_date: batch.eta_date ?? "", vessel_no: batch.vessel_no ?? "" });
    setMetaInit(true);
  }
  const isLocked = batch.status !== "draft";
  const storedTotal = Number(batch.grand_total_cny ?? 0);
  const liveTotal = fee_summary?.grand_total_cny ?? 0;
  const totalDrift = isLocked && Math.abs(storedTotal - liveTotal) > 0.01;

  const onAssign = async () => {
    if (!selected.size) {
      setShowAssign(false);
      return;
    }
    setBusy(true);
    try {
      await assign({ data: { batchId, waybillIds: Array.from(selected) } });
      setSelected(new Set());
      setShowAssign(false);
      await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
    } finally {
      setBusy(false);
    }
  };
  const onRemove = async (ids: string[]) => {
    if (!confirm("从批次移除选中运单？")) return;
    await assign({ data: { batchId, waybillIds: ids, remove: true } });
    await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
  };
  const onSaveMeta = async () => {
    if (meta.eta_date && !/^\d{4}-\d{2}-\d{2}$/.test(meta.eta_date)) {
      alert("请输入完整的预计到货日期 YYYY-MM-DD");
      return;
    }
    await updBatch({
      data: { batchId, patch: { display_name: meta.display_name.trim() || null, eta_date: meta.eta_date || null, vessel_no: meta.vessel_no || null } },
    });
    await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
  };
  const onBulk = async () => {
    if (!bulkStatus && !bulkEvent.status_zh) return;
    setBusy(true);
    try {
      await bulkOp({
        data: {
          batchId,
          status: bulkStatus || undefined,
          event: bulkEvent.status_zh
            ? {
                status_zh: bulkEvent.status_zh,
                location_zh: bulkEvent.location_zh || undefined,
                event_time: bulkEvent.event_time ? new Date(bulkEvent.event_time).toISOString() : undefined,
              }
            : undefined,
        },
      });
      setShowBulk(false);
      setBulkStatus("");
      setBulkEvent({ status_zh: "", location_zh: "", event_time: "" });
      await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <BackLink to="/admin/batches">返回批次列表</BackLink>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold font-mono">{batch.batch_no}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <StatusBadge map={BATCH_STATUS_LABEL} color={BATCH_STATUS_COLOR} value={batch.status} />
            <span>· 计划发货 {batch.planned_ship_date}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LabelSizeToggle />
          <button
            onClick={onPrintLabel}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
          >
            <Printer className="h-3 w-3" />
            打印面单
          </button>
          <button
            onClick={onDownloadInvoice}
            disabled={invoiceBusy || Number(customsQ.data?.missing_count ?? 0) > 0}
            title={customsQ.data?.missing_count ? `仍有 ${customsQ.data.missing_count} 个商品缺少有效 HS Code` : "下载 Invoice / Packing List"}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 px-3 py-1.5 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {invoiceBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            下载 Invoice
          </button>
          {canEdit && (
            <>
              <button
                onClick={() => setShowScan(true)}
                className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90"
              >
                <ScanLine className="h-3 w-3" />
                扫码加入
              </button>
              <button
                onClick={() => setShowBulk(true)}
                className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
              >
                <Wand2 className="h-3 w-3" />
                批量操作运单
              </button>
              {(() => {
                const idx = BATCH_FLOW.findIndex((s) => s.key === batch.status);
                const next = idx >= 0 && idx < BATCH_FLOW.length - 1 ? BATCH_FLOW[idx + 1] : null;
                return next ? (
                  <button
                    onClick={async () => {
                      if (!confirm(`将批次推进到「${next.label}」？状态将同步到所属箱号/托盘。`)) return;
                      await setBatchStatus({ data: { batchId, status: next.key as any } });
                      qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
                      qc.invalidateQueries({ queryKey: ["batch-cartons", batchId] });
                      qc.invalidateQueries({ queryKey: ["batch-pallets", batchId] });
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
                  >
                    推进到 {next.label} <ChevronRight className="h-3 w-3" />
                  </button>
                ) : null;
              })()}
              <select
                value={batch.status}
                onChange={async (e) => {
                  await setBatchStatus({ data: { batchId, status: e.target.value as any } });
                  qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
                  qc.invalidateQueries({ queryKey: ["batch-cartons", batchId] });
                  qc.invalidateQueries({ queryKey: ["batch-pallets", batchId] });
                }}
                className="rounded-md border border-slate-600 bg-slate-700 px-2 py-1.5 text-xs text-white [&>option]:bg-slate-700"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {BATCH_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      <WorkflowStepper flow={BATCH_FLOW} current={batch.status} title="批次流程 · 状态变化会自动同步所属箱号/托盘" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="批次信息">
          <div className="space-y-1 text-xs text-slate-300">
            <div>名称：{batch.display_name ?? "—"}</div>
            <div>运输方式：{batch.shipping_method}</div>
            <div>货物类型：{batch.cargo_type ?? "—"}</div>
            <div>目的地：{batch.destination_code ?? "—"}</div>
            <div>序号：{batch.sequence_no}</div>
            <div>创建：{fmtDate(batch.created_at)}</div>
            <div>关闭：{batch.closed_at ? fmtDate(batch.closed_at) : "—"}</div>
          </div>
          <BatchPartiesEditor batch={batch} canEdit={canEdit}
            onSaved={() => qc.invalidateQueries({ queryKey: ["admin-batch", batchId], exact: true })} />
        </Card>
        <Card title="发运计划">
          <div className="grid grid-cols-1 gap-2 text-xs">
            <label className="text-slate-400">
              批次名称（可选）
              <input
                disabled={!canEdit}
                value={meta.display_name}
                onChange={(e) => setMeta({ ...meta, display_name: e.target.value })}
                placeholder="可手动填写"
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="text-slate-400">
              预计到货日期（直接输入年月日）
              <DateInput
                value={meta.eta_date}
                disabled={!canEdit}
                onChange={(v) => setMeta({ ...meta, eta_date: v })}
              />
            </label>
            <label className="text-slate-400">
              船号 / 航空号
              <input
                disabled={!canEdit}
                value={meta.vessel_no}
                onChange={(e) => setMeta({ ...meta, vessel_no: e.target.value })}
                placeholder="如 COSCO-1234 / CX889"
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <div className="rounded-md border border-dashed border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <FileText className="h-3.5 w-3.5" /> 上传提单并抓取信息
                  </div>
                  <div className="mt-1 text-[10px] leading-relaxed text-slate-500">
                    自动提取收发货人、发运日期、船名/航次、集装箱、总体积、总重量和提单品名；解析后仍可人工修改。
                  </div>
                  {batch.hbl_file_name && <div className="mt-1 text-[10px] text-emerald-300">已上传：{batch.hbl_file_name}</div>}
                </div>
                {canEdit && (
                  <button
                    onClick={() => hblInputRef.current?.click()}
                    disabled={hblBusy}
                    className="inline-flex shrink-0 items-center gap-1 rounded-md bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
                  >
                    {hblBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                    {hblBusy ? "解析中" : "上传提单"}
                  </button>
                )}
                <input
                  ref={hblInputRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && onUploadHbl(e.target.files[0])}
                />
              </div>
              {(batch.container_no || batch.hbl_total_weight_kg || batch.hbl_total_volume_m3) && (
                <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-slate-400">
                  <span>集装箱：<b className="text-slate-200">{batch.container_no ?? "—"}</b></span>
                  <span>提单重量：<b className="text-slate-200">{batch.hbl_total_weight_kg ?? "—"} kg</b></span>
                  <span>提单体积：<b className="text-slate-200">{batch.hbl_total_volume_m3 ?? "—"} m³</b></span>
                </div>
              )}
            </div>
            {canEdit && (
              <button
                onClick={onSaveMeta}
                className="mt-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white"
              >
                保存
              </button>
            )}
            <div className="mt-2 text-slate-500">
              运单总数：<span className="font-semibold text-slate-200">{waybill_total ?? waybills.length}</span>（直挂{" "}
              {waybills.length} · 含箱号/托盘内）· 总重量 {batch.total_weight_kg ?? 0} kg · 总金额 CA$
              {batch.total_cny ?? 0}
            </div>
            <div className="text-slate-500">备注：{batch.notes ?? "—"}</div>
          </div>
        </Card>
      </div>

      <Card title="独立清关 · HS 编码检查">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {customsQ.isLoading ? (
              <span className="text-xs text-slate-500">正在检查批次商品…</span>
            ) : customsQ.data?.missing_count ? (
              <>
                <div className="text-sm font-semibold text-amber-300">
                  批次内有 {customsQ.data.missing_count} 个商品缺少有效 HS Code
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  {customsQ.data.missing_names?.slice(0, 8).join("、") || "请检查商品明细"}
                </div>
              </>
            ) : (
              <div className="text-sm font-semibold text-emerald-300">批次商品 HS Code 已齐全</div>
            )}
            <div className="mt-1 text-[10px] text-slate-500">
              优先匹配本地 HS 库；无法可靠匹配时调用 OpenAI。AI返回编码必须存在于本地库且置信度达到要求才会回填。
            </div>
          </div>
          {canEdit && Number(customsQ.data?.missing_count ?? 0) > 0 && (
            <button
              onClick={onAutoMatchHs}
              disabled={hsBusy}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-amber-500/20 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
            >
              {hsBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              自动匹配 HS Code
            </button>
          )}
        </div>
      </Card>

      {independent_clearance && independent_clearance.groups?.length > 0 && (
        <Card title={`独立清关 × ${independent_clearance.customer_count} 个客户号`}>
          <div className="mb-2 text-[11px] text-slate-400">
            为本批次内含「批次级清关」线路的客户号各加一次<span className="text-slate-200">预设固定清关费</span>
            （非分摊，与运单数无关）。 合计：
            <span className="ml-1 font-mono font-semibold text-emerald-300">
              CA${independent_clearance.total_fee_cny.toFixed(2)}
            </span>
            <span className="ml-2 text-slate-500">— 直接计入对应客户的本批账单</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
                明细（线路 × 客户号 · 各加一次预设费）
              </div>
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="py-1">线路</th>
                    <th>客户号</th>
                    <th className="text-right">预设清关费</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {independent_clearance.groups.map((g: any, i: number) => (
                    <tr key={i}>
                      <td className="py-1 font-mono">{g.route_code}</td>
                      <td className="font-mono">{g.customer_code}</td>
                      <td className="text-right font-mono text-emerald-300">CA${g.fee_cny.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">按客户号小计（账单口径）</div>
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] uppercase text-slate-500">
                  <tr>
                    <th className="py-1">客户号</th>
                    <th className="text-right">独立清关费</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {independent_clearance.per_customer.map((c: any, i: number) => (
                    <tr key={i}>
                      <td className="py-1 font-mono">{c.customer_code}</td>
                      <td className="text-right font-mono text-emerald-300">CA${c.fee_cny.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {/* ===== 批次费用汇总 ===== */}
      {!fee_summary && (
        <Card title="批次费用汇总">
          <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
            {feeQ.isError ? (
              <span className="text-rose-400">费用汇总加载失败：{(feeQ.error as Error)?.message}</span>
            ) : (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                正在计算费用汇总（大批次首次可能较慢，请稍候）…
              </>
            )}
          </div>
        </Card>
      )}
      {fee_summary && (
        <Card
          title="批次费用汇总"
          action={
            isLocked ? (
              <span className="text-[10px] text-emerald-300">
                已锁定 · 已写入 CA${storedTotal.toFixed(2)}
                {totalDrift && (
                  <>
                    <span className="ml-2 text-amber-300">
                      ⚠ 与实时计算不一致：CA${liveTotal.toFixed(2)}
                    </span>
                    {canEdit && (
                      <button
                        onClick={async () => {
                          if (!confirm(`将已写入金额从 CA$${storedTotal.toFixed(2)} 重算为 CA$${liveTotal.toFixed(2)}？`)) return;
                          await setBatchStatus({ data: { batchId, status: batch.status } });
                          await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
                          await qc.invalidateQueries({ queryKey: ["admin-batches"] });
                        }}
                        className="ml-2 rounded bg-amber-500/20 px-2 py-0.5 text-amber-200 hover:bg-amber-500/30"
                      >
                        重算并写入
                      </button>
                    )}
                  </>
                )}
              </span>
            ) : (
              <span className="text-[10px] text-slate-500">草稿状态 · 实时计算，锁定时写入</span>
            )
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FeeStat label="总运费" value={fee_summary.totals.total_freight_cny} />
            <FeeStat label="总关税" value={fee_summary.totals.total_customs_cny} />
            <FeeStat label="总保险" value={fee_summary.totals.total_insurance_cny} />
            <FeeStat label="总清关费" value={fee_summary.totals.total_clearance_cny} />
            <FeeStat label="总仓储费" value={fee_summary.totals.total_storage_cny} pending />
            <FeeStat label="总派送费" value={fee_summary.totals.total_delivery_cny} pending />
            <FeeStat label="总检查费" value={fee_summary.totals.total_inspection_cny} pending />
            <FeeStat label="总附加费" value={fee_summary.totals.total_surcharge_cny} />
            <FeeStat label="总折扣" value={-Number(fee_summary.totals.total_discount_cny ?? 0)} />
          </div>
          <div className="mt-3 flex items-baseline justify-end gap-2 border-t border-white/5 pt-3">
            <span className="text-xs text-slate-400">合计：</span>
            <span className="font-mono text-2xl font-bold text-emerald-300">CA${liveTotal.toFixed(2)}</span>
          </div>
        </Card>
      )}

      {/* ===== 按客户号账单 ===== */}
      {fee_summary && (
        <Card
          title={
            <button
              type="button"
              onClick={() => setCustAcctOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 hover:text-brand"
            >
              {custAcctOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              按客户号账单（{fee_summary.per_customer.length} 个客户）
            </button>
          }
          action={
            custAcctOpen && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-500">点击客户号查看明细 · 批次附加费在此层级归集</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={onConfirmAllPrices}
                    disabled={confirmAllBusy || fee_summary.per_customer.every((c: any) => c.price_confirmed)}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {confirmAllBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                    {fee_summary.per_customer.every((c: any) => c.price_confirmed) ? "已全部确认" : "批量确认价格"}
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={onBulkDeduct}
                    disabled={
                      bulkDeductBusy ||
                      !fee_summary.per_customer.some((c: any) => c.price_confirmed && !c.is_paid && c.user_id)
                    }
                    title="从各客户钱包余额批量扣款；余额不足自动跳过"
                    className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {bulkDeductBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wallet className="h-3.5 w-3.5" />}
                    批量扣款（钱包）
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={onRefreshAllSnapshots}
                    disabled={refreshingAllSnap}
                    title="客户端「我的批次」只读快照；量尺/箱托盘改动等还没接入自动刷新时用这个兜底"
                    className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {refreshingAllSnap ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    刷新全部客户快照
                  </button>
                )}
              </div>
            )
          }
        >
          {!custAcctOpen ? null : fee_summary.per_customer.length === 0 && !fee_summary.unassigned ? (
            <div className="py-6 text-center text-xs text-slate-500">
              暂无客户号账单。请检查批次内的运单 / 客户号箱号 / 客户号托盘是否已正确绑定客户号。
            </div>
          ) : (
            <>
              <input
                value={custAcctSearch}
                onChange={(e) => setCustAcctSearch(e.target.value)}
                placeholder="搜索客户号 / 客户名 / 线路"
                className="mb-2 w-full max-w-xs rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
              />
              {(() => {
                const q = custAcctSearch.trim().toLowerCase();
                const filteredCustomers = !q
                  ? fee_summary.per_customer
                  : fee_summary.per_customer.filter((c: any) =>
                      [c.customer_code, c.customer_name, c.route_code].some((v) =>
                        String(v ?? "").toLowerCase().includes(q),
                      ),
                    );
                return (
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="py-2">客户号</th>
                  <th>线路</th>
                  <th className="text-right">运单数</th>
                  <th className="text-right">箱号</th>
                  <th className="text-right">托盘</th>
                  <th className="text-right">小计 CA$</th>
                  <th className="text-center">付款</th>
                  <th className="text-right">余额 CA$</th>
                  <th className="text-center">操作</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredCustomers.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-6 text-center text-xs text-slate-500">
                      没有匹配的客户号
                    </td>
                  </tr>
                )}
                {filteredCustomers.map((c: any) => (
                  <tr
                    key={c.group_key ?? c.customer_code}
                    className="cursor-pointer hover:bg-white/[0.03]"
                    onClick={() => setDrawerCustomer(c.group_key ?? c.customer_code)}
                  >
                    <td className="py-2 font-mono text-xs text-brand">
                      {c.customer_code}
                      {c.customer_name && <span className="ml-1 text-slate-500">· {c.customer_name}</span>}
                    </td>
                    <td className="text-xs">
                      {c.route_code ? (
                        <span className="inline-flex rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-mono text-brand">
                          {c.route_code}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">—</span>
                      )}
                    </td>
                    <td className="text-right text-xs font-mono">{c.waybill_count}</td>
                    <td className="text-right text-xs font-mono">{c.carton_count}</td>
                    <td className="text-right text-xs font-mono">{c.pallet_count}</td>
                    <td className="text-right text-xs font-mono font-semibold text-emerald-300">
                      {c.subtotal_cny.toFixed(2)}
                    </td>
                    <td className="text-center text-xs" onClick={(e) => e.stopPropagation()}>
                      {c.is_paid ? (
                        <span className="inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                          已付款
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full border border-amber-500/30 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                          未付款
                        </span>
                      )}
                    </td>
                    <td className="text-right text-xs font-mono text-slate-200">
                      {c.user_id ? Number(c.balance_cad ?? 0).toFixed(2) : "—"}
                    </td>
                    <td className="text-center" onClick={(e) => e.stopPropagation()}>
                      {canEdit && c.user_id ? (
                        <button
                          onClick={() => {
                            setDeductState({
                              user_id: c.user_id,
                              customer_code: c.customer_code,
                              balance: Number(c.balance_cad ?? 0),
                              subtotal: Number(c.gross_subtotal_cny ?? c.subtotal_cny ?? 0),
                            });
                            setDeductDiscount(String(Number(c.fee_discount_cad ?? 0)));
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/10"
                        >
                          <Wallet className="h-3 w-3" />
                          扣款
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-600">—</span>
                      )}
                    </td>
                    <td className="text-right pr-2">
                      <ChevronRight className="inline h-3.5 w-3.5 text-slate-500" />
                    </td>
                  </tr>
                ))}

                {fee_summary.unassigned && (
                  <tr className="bg-amber-500/5 text-slate-500">
                    <td className="py-2 text-xs" colSpan={2}>
                      <AlertCircle className="inline h-3 w-3 mr-1 text-amber-400" />
                      未指定客户（管理员排查）
                    </td>
                    <td className="text-right text-xs font-mono">{fee_summary.unassigned.waybill_count}</td>
                    <td className="text-right text-xs font-mono">—</td>
                    <td className="text-right text-xs font-mono">—</td>
                    <td className="text-right text-xs font-mono text-slate-400">
                      {fee_summary.unassigned.subtotal_cny.toFixed(2)}
                    </td>
                    <td colSpan={4}></td>
                  </tr>
                )}
              </tbody>
            </table>
                );
              })()}
            </>
          )}
        </Card>
      )}

      {/* ===== 批次附加费（按客户号归集） ===== */}
      <SurchargePanel
        scope="batch"
        id={batchId}
        canEdit={canEdit}
        showCustomerField
        collapsible
        title="批次附加费（按客户号账单层级 · 每条必须指定归属客户号）"
        onChanged={() => qc.invalidateQueries({ queryKey: ["admin-batch", batchId] })}
      />

      {(() => {
        const wbTotal = waybills.reduce((s: number, w: any) => s + Number(w.total_cad ?? 0), 0);
        const wbQ = wbSearch.trim().toLowerCase();
        const filteredWaybills = !wbQ
          ? waybills
          : waybills.filter((w: any) =>
              [w.waybill_no, w.customer_code, w.status].some((v) => String(v ?? "").toLowerCase().includes(wbQ)),
            );

        const ctLoaded = !!cartonsQ.data;
        const ctItems = cartonsQ.data?.items ?? [];
        const ctTotal = ctItems.reduce(
          (s: number, c: any) =>
            s + Number(c.customer_code ? (c.with_customer_total_cad ?? 0) : (c.without_customer_total_cad ?? 0)),
          0,
        );
        const ctQ = ctSearch.trim().toLowerCase();
        const filteredCartons = !ctQ
          ? ctItems
          : ctItems.filter((c: any) =>
              [c.carton_no, c.display_name, c.customer_code].some((v) => String(v ?? "").toLowerCase().includes(ctQ)),
            );

        const plLoaded = !!palletsQ.data;
        const plItems = palletsQ.data?.items ?? [];
        const plTotal = plItems.reduce(
          (s: number, p: any) =>
            s + Number(p.customer_code ? (p.with_customer_total_cad ?? 0) : (p.without_customer_total_cad ?? 0)),
          0,
        );
        const plQ = plSearch.trim().toLowerCase();
        const filteredPallets = !plQ
          ? plItems
          : plItems.filter((p: any) =>
              [p.pallet_no, p.display_name, p.customer_code].some((v) => String(v ?? "").toLowerCase().includes(plQ)),
            );

        // 运单 / 箱号 / 托盘：各自独立折叠，默认收起，不再用 tab 切换（同一时间只能看一个）
        return (
          <>
            <Card
              title={
                <button
                  type="button"
                  onClick={() => setWbSectionOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 hover:text-brand"
                >
                  {wbSectionOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  运单 ({waybills.length}) · CA${wbTotal.toFixed(2)}
                </button>
              }
              action={
                canEdit && (
                  <button
                    onClick={() => setShowScan(true)}
                    className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-xs font-semibold text-white hover:bg-brand/90"
                  >
                    <ScanLine className="h-3 w-3" />
                    扫码加入
                  </button>
                )
              }
            >
              {wbSectionOpen && (
                <>
                  <input
                    value={wbSearch}
                    onChange={(e) => setWbSearch(e.target.value)}
                    placeholder="搜索运单号 / 客户号 / 状态"
                    className="mb-2 w-full max-w-xs rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
                  />
                  <WaybillCompactList
                    waybills={filteredWaybills as any}
                    onKick={
                      canEdit
                        ? async (w) => {
                            await onRemove([w.id]);
                          }
                        : undefined
                    }
                  />
                </>
              )}
            </Card>

            <Card
              title={
                <button
                  type="button"
                  onClick={() => setCtSectionOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 hover:text-brand"
                >
                  {ctSectionOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  箱号 ({ctLoaded ? ctItems.length : "…"}){ctLoaded && ` · CA$${ctTotal.toFixed(2)}`}
                </button>
              }
              action={
                canEdit && (
                  <button
                    onClick={() => setShowScan(true)}
                    className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-xs font-semibold text-white"
                  >
                    <ScanLine className="h-3 w-3" />
                    扫码加入
                  </button>
                )
              }
            >
              {ctSectionOpen &&
                (cartonsQ.isLoading ? (
                  <div className="py-6 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-500" />
                  </div>
                ) : (
                  <>
                    <input
                      value={ctSearch}
                      onChange={(e) => setCtSearch(e.target.value)}
                      placeholder="搜索箱号 / 客户号 / 备注名"
                      className="mb-2 w-full max-w-xs rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
                    />
                    <CartonCompactList
                      cartons={filteredCartons as any}
                      onKick={
                        canEdit
                          ? async (c) => {
                              await updCarton({ data: { id: c.id, patch: { batch_id: null } } });
                              qc.invalidateQueries({ queryKey: ["batch-cartons", batchId] });
                            }
                          : undefined
                      }
                    />
                  </>
                ))}
            </Card>

            <Card
              title={
                <button
                  type="button"
                  onClick={() => setPlSectionOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-200 hover:text-brand"
                >
                  {plSectionOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  托盘 ({plLoaded ? plItems.length : "…"}){plLoaded && ` · CA$${plTotal.toFixed(2)}`}
                </button>
              }
              action={
                canEdit && (
                  <button
                    onClick={() => setShowScan(true)}
                    className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-xs font-semibold text-white"
                  >
                    <ScanLine className="h-3 w-3" />
                    扫码加入
                  </button>
                )
              }
            >
              {plSectionOpen &&
                (palletsQ.isLoading ? (
                  <div className="py-6 text-center">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-500" />
                  </div>
                ) : (
                  <>
                    <input
                      value={plSearch}
                      onChange={(e) => setPlSearch(e.target.value)}
                      placeholder="搜索托盘号 / 客户号 / 备注名"
                      className="mb-2 w-full max-w-xs rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
                    />
                    <PalletCompactList
                      pallets={filteredPallets as any}
                      onKick={
                        canEdit
                          ? async (p) => {
                              await updPallet({ data: { id: p.id, patch: { batch_id: null } } });
                              qc.invalidateQueries({ queryKey: ["batch-pallets", batchId] });
                            }
                          : undefined
                      }
                      onSplit={
                        canEdit
                          ? async (p) => {
                              if (!confirm(`拆分托盘 ${p.pallet_no}？下属箱号/运单将回到批次层级，托盘会被删除。`)) return;
                              const r = await doSplitPallet({ data: { id: p.id } });
                              alert(`已拆分：释放 ${r.released_cartons} 箱 / ${r.released_waybills} 单`);
                              qc.invalidateQueries({ queryKey: ["batch-pallets", batchId] });
                              qc.invalidateQueries({ queryKey: ["batch-cartons", batchId] });
                              qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
                            }
                          : undefined
                      }
                    />
                  </>
                ))}
            </Card>
          </>
        );
      })()}

      <Card title="操作记录">
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {logs.length === 0 && <div className="text-xs text-slate-500">暂无</div>}
          {logs.map((l: any) => (
            <div key={l.id} className="rounded-md border border-white/5 bg-white/[0.02] p-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">{l.action}</span>
                <span className="text-slate-500">{fmtDate(l.created_at)}</span>
              </div>
              <div className="text-slate-400">操作人：{l.operator_name ?? "—"}</div>
            </div>
          ))}
        </div>
      </Card>

      {showAssign && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl rounded-2xl border border-white/10 bg-[#0A0F1A] p-5"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">选择运单加入批次</h2>
              <button onClick={() => setShowAssign(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索运单号"
              className="mb-3 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
            />
            <div className="max-h-96 overflow-y-auto rounded-lg border border-white/5">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-white/5">
                  {availQ.data?.waybills
                    .filter((w: any) => w.assigned_batch_id !== batchId)
                    .map((w: any) => (
                      <tr key={w.id} className={selected.has(w.id) ? "bg-brand/10" : ""}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={selected.has(w.id)}
                            onChange={() => {
                              const s = new Set(selected);
                              s.has(w.id) ? s.delete(w.id) : s.add(w.id);
                              setSelected(s);
                            }}
                          />
                        </td>
                        <td className="font-mono text-xs">{w.waybill_no}</td>
                        <td className="text-xs">
                          <StatusBadge map={WAYBILL_STATUS_LABEL} color={WAYBILL_STATUS_COLOR} value={w.status} />
                        </td>
                        <td className="text-xs text-slate-400">{w.batch_no ? `已属批次 ${w.batch_no}` : "未分配"}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setShowAssign(false)}
                className="rounded-md border border-white/10 px-3 py-1.5 text-xs"
              >
                取消
              </button>
              <button
                onClick={onAssign}
                disabled={busy || !selected.size}
                className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                加入 {selected.size} 条
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulk && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A0F1A] p-5"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">批量操作 · 此批次全部运单</h2>
              <button onClick={() => setShowBulk(false)} className="text-slate-400">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-400">批量改状态</label>
                <select
                  value={bulkStatus}
                  onChange={(e) => setBulkStatus(e.target.value as any)}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]"
                >
                  <option value="">— 不更改 —</option>
                  {WAYBILL_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {WAYBILL_STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="border-t border-white/10 pt-3">
                <div className="mb-1 text-slate-400">批量添加物流轨迹</div>
                <input
                  placeholder="状态描述（中文）"
                  value={bulkEvent.status_zh}
                  onChange={(e) => setBulkEvent({ ...bulkEvent, status_zh: e.target.value })}
                  className="mb-2 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
                />
                <input
                  placeholder="位置（可选）"
                  value={bulkEvent.location_zh}
                  onChange={(e) => setBulkEvent({ ...bulkEvent, location_zh: e.target.value })}
                  className="mb-2 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
                />
                <input
                  type="datetime-local"
                  value={bulkEvent.event_time}
                  onChange={(e) => setBulkEvent({ ...bulkEvent, event_time: e.target.value })}
                  className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
                />
              </div>
              <button
                disabled={busy}
                onClick={onBulk}
                className="w-full rounded-md bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy ? "执行中…" : `应用到 ${waybills.length} 条运单`}
              </button>
            </div>
          </div>
        </div>
      )}

      <BatchInvoicesPanel batchNo={batch.batch_no ?? ""} />

      {showAddCarton && (

        <PickerDialog
          title="加入箱号"
          onClose={() => setShowAddCarton(false)}
          rows={allCartonsQ.data?.items.filter((c: any) => c.batch_id !== batchId) ?? []}
          renderRow={(c: any) => `${c.carton_no}${c.batch_no ? ` · 已在 ${c.batch_no}` : ""}`}
          onConfirm={async (ids) => {
            for (const id of ids) await updCarton({ data: { id, patch: { batch_id: batchId } } });
            await qc.invalidateQueries({ queryKey: ["batch-cartons", batchId] });
            setShowAddCarton(false);
          }}
        />
      )}
      {showAddPallet && (
        <PickerDialog
          title="加入托盘"
          onClose={() => setShowAddPallet(false)}
          rows={allPalletsQ.data?.items.filter((p: any) => p.batch_id !== batchId) ?? []}
          renderRow={(p: any) => `${p.pallet_no}${p.batch_no ? ` · 已在 ${p.batch_no}` : ""}`}
          onConfirm={async (ids) => {
            for (const id of ids) await updPallet({ data: { id, patch: { batch_id: batchId } } });
            await qc.invalidateQueries({ queryKey: ["batch-pallets", batchId] });
            setShowAddPallet(false);
          }}
        />
      )}
      <ScanAddDialog
        open={showScan}
        onClose={() => setShowScan(false)}
        container="batch"
        containerId={batchId}
        onChanged={() => {
          qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
          qc.invalidateQueries({ queryKey: ["batch-cartons", batchId] });
          qc.invalidateQueries({ queryKey: ["batch-pallets", batchId] });
        }}
      />

      {drawerCustomer &&
        (() => {
          const cd = fee_summary?.per_customer.find((c: any) => (c.group_key ?? c.customer_code) === drawerCustomer);
          if (!cd) return null;
          return (
            <CustomerDrawer
              batchId={batchId}
              customerCode={cd.customer_code ?? ""}
              customerData={cd}
              onClose={() => setDrawerCustomer(null)}
              canEdit={canEdit}
            />
          );
        })()}

      {deductState && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0A0F1A] p-5"
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold inline-flex items-center gap-2">
                <Wallet className="h-4 w-4 text-rose-300" />
                钱包扣款
              </h2>
              <button onClick={() => setDeductState(null)}>
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            {(() => {
              const sub = Number(deductState.subtotal ?? 0);
              const disc = Math.max(0, Math.min(sub, Number(deductDiscount || 0)));
              const finalAmt = +(sub - disc).toFixed(2);
              return (
                <>
                  <div className="space-y-2 text-xs text-slate-300">
                    <div>
                      客户号：<span className="font-mono text-brand">{deductState.customer_code}</span>
                    </div>
                    <div>
                      当前余额：<span className="font-mono text-emerald-300">CA${deductState.balance.toFixed(2)}</span>
                    </div>
                    <label className="block text-slate-400">
                      应扣金额 (CAD) · 已锁定
                      <input
                        readOnly
                        value={sub.toFixed(2)}
                        className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-400 cursor-not-allowed"
                      />
                    </label>
                    <label className="block text-slate-400">
                      折扣 (CAD)
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max={sub}
                        value={deductDiscount}
                        onChange={(e) => setDeductDiscount(e.target.value)}
                        className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
                      />
                    </label>
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1.5 text-emerald-200">
                      实际扣款：<span className="font-mono font-bold">CA${finalAmt.toFixed(2)}</span>
                      {disc > 0 && (
                        <span className="ml-2 text-[10px] text-emerald-300/80">（折扣 CA${disc.toFixed(2)}）</span>
                      )}
                    </div>
                    <div>
                      <label className="block text-slate-400">收款方式</label>
                      <div className="mt-1 grid grid-cols-3 gap-1">
                        {(["wallet", "emt", "cash"] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setDeductMethod(m)}
                            className={`rounded-md border px-2 py-1.5 text-xs font-semibold ${deductMethod === m ? "border-brand bg-brand/10 text-brand" : "border-white/10 bg-white/5 text-slate-300"}`}
                          >
                            {m === "wallet" ? "钱包" : m === "emt" ? "EMT" : "现金"}
                          </button>
                        ))}
                      </div>
                      {deductMethod !== "wallet" && (
                        <input
                          value={deductRefNo}
                          onChange={(e) => setDeductRefNo(e.target.value)}
                          placeholder="凭证号 / 参考号（可选）"
                          className="mt-2 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500"
                        />
                      )}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {deductMethod === "wallet"
                        ? "确认后：生成账单并结清 · 记录钱包流水 · 调整钱包余额 · 该客户批次未付运单标记为已付款 · 写入操作记录与物流轨迹 · 折扣计入批次账单明细。"
                        : "确认后：生成账单并结清 · 记录一条流水（不影响钱包余额）· 该客户批次未付运单标记为已付款 · 写入操作记录与物流轨迹 · 折扣计入批次账单明细。"}
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      onClick={() => setDeductState(null)}
                      className="rounded-md border border-white/10 px-3 py-1.5 text-xs"
                    >
                      取消
                    </button>
                    <button
                      onClick={async () => {
                        if (!(sub > 0)) {
                          alert("金额需大于 0");
                          return;
                        }
                        try {
                          const r: any =
                            deductMethod === "wallet"
                              ? await deduct({
                                  data: {
                                    batchId,
                                    userId: deductState.user_id,
                                    amountCad: sub,
                                    discountCad: disc,
                                    note: `批次 ${batch.batch_no} 扣款`,
                                  },
                                })
                              : await deductOffline({
                                  data: {
                                    batchId,
                                    userId: deductState.user_id,
                                    method: deductMethod,
                                    discountCad: disc,
                                    refNo: deductRefNo || undefined,
                                    note: `批次 ${batch.batch_no} ${deductMethod === "emt" ? "EMT" : "现金"}收款`,
                                  },
                                });
                          if (r?.ok === false && r.reason === "already_paid") {
                            alert("该客户在本批次已结清");
                          } else if (r?.ok) {
                            // 服务端按冻结账单金额扣款，可能与页面显示略有出入 —— 以实扣为准
                            const actual = Number(r.deducted_cad ?? 0);
                            if (actual > 0 && Math.abs(actual - (sub - disc)) > 0.01) {
                              alert(
                                `已按冻结账单结算 CA$${actual.toFixed(2)}（页面预估 CA$${(sub - disc).toFixed(2)}，价格可能已更新）`,
                              );
                            }
                          }
                          setDeductState(null);
                          setDeductDiscount("0");
                          setDeductMethod("wallet");
                          setDeductRefNo("");
                          await qc.invalidateQueries({ queryKey: ["admin-batch", batchId] });
                        } catch (e: any) {
                          alert(e.message);
                        }
                      }}
                      className="rounded-md bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500"
                    >
                      确认扣款
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

function FeeStat({ label, value, pending }: { label: string; value: number; pending?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-2.5 ${pending ? "border-white/5 bg-white/[0.01]" : "border-white/10 bg-white/[0.03]"}`}
    >
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
        {pending && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-300">待定</span>
        )}
      </div>
      <div className={`mt-1 font-mono text-sm font-bold ${pending ? "text-slate-500" : "text-slate-100"}`}>
        CA${Number(value ?? 0).toFixed(2)}
      </div>
    </div>
  );
}

function PickerDialog({
  title,
  rows,
  renderRow,
  onConfirm,
  onClose,
}: {
  title: string;
  rows: any[];
  renderRow: (r: any) => string;
  onConfirm: (ids: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0A0F1A] p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">{title}</h2>
          <button onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto rounded-lg border border-white/5">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-white/5">
              {rows.length === 0 && (
                <tr>
                  <td className="py-6 text-center text-slate-500">没有可选项</td>
                </tr>
              )}
              {rows.map((r: any) => (
                <tr key={r.id} className={sel.has(r.id) ? "bg-brand/10" : ""}>
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      checked={sel.has(r.id)}
                      onChange={() => {
                        const s = new Set(sel);
                        s.has(r.id) ? s.delete(r.id) : s.add(r.id);
                        setSel(s);
                      }}
                    />
                  </td>
                  <td className="font-mono text-xs">{renderRow(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-white/10 px-3 py-1.5 text-xs">
            取消
          </button>
          <button
            disabled={busy || !sel.size}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(Array.from(sel));
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            加入 {sel.size} 条
          </button>
        </div>
      </div>
    </div>
  );
}

// 批次账单：价格确认时自动生成（每客户一张），此处可查看/下载
function BatchInvoicesPanel({ batchNo }: { batchNo: string }) {
  const fetchInvoices = useServerFn(listBatchInvoices);
  const q = useQuery({
    queryKey: ["batch-invoices", batchNo],
    queryFn: () => fetchInvoices({ data: { batchNo } }),
  });
  const items: any[] = (q.data as any)?.items ?? [];
  const LABEL: Record<string, string> = { unpaid: "待付", paid: "已付", overdue: "逾期", void: "作废" };
  const COLOR: Record<string, string> = {
    unpaid: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    paid: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    overdue: "border-rose-500/30 bg-rose-500/10 text-rose-300",
    void: "border-slate-500/30 bg-slate-500/10 text-slate-400",
  };
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3 text-sm font-semibold">
        <Wallet className="h-4 w-4 text-blue-400" />
        批次账单（{items.length}）
        <span className="text-[11px] font-normal text-slate-500">价格确认后每位客户自动生成一张账单</span>
      </div>
      {q.isLoading ? (
        <div className="py-8 text-center">
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-500" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-xs text-slate-500">暂无账单（确认客户价格后自动生成）</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2">账单号</th>
              <th className="px-4 py-2">客户</th>
              <th className="px-4 py-2">金额</th>
              <th className="px-4 py-2">状态</th>
              <th className="px-4 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {items.map((r) => (
              <tr key={r.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2.5 font-mono text-xs">{r.invoice_no}</td>
                <td className="px-4 py-2.5 text-xs">
                  {r.customer?.full_name ?? r.customer?.email ?? "—"}
                  <span className="ml-1 font-mono text-[10px] text-slate-500">{r.customer?.customer_code}</span>
                </td>
                <td className="px-4 py-2.5 text-xs font-semibold">
                  CA${(Number(r.total_cny) * Number(r.fx_rate ?? 1)).toFixed(2)}
                </td>
                <td className="px-4 py-2.5">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${COLOR[r.status]}`}>
                    {LABEL[r.status] ?? r.status}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    to="/admin/invoices/$invoiceId"
                    params={{ invoiceId: r.id }}
                    className="text-xs text-blue-300 hover:underline"
                  >
                    查看 / 下载 PDF
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
