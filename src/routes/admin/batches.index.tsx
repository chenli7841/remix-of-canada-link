import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import {
  listBatches,
  createBatch,
  updateBatchStatus,
  confirmAllBatchPrices,
  findBatchIdsForCustomerCode,
  type BatchMethod,
  type BatchStatus,
} from "@/lib/orders.functions";
import { toast } from "sonner";
import { getContainerLabelData } from "@/lib/cartons.functions";
import { listCargoTypes, listDestinations } from "@/lib/presets.functions";
import { listRoutes } from "@/lib/settings.functions";
import { getMyRoles } from "@/lib/admin.functions";
import { BATCH_STATUS_LABEL, BATCH_STATUS_COLOR, METHOD_LABEL, StatusBadge, Page, fmtDate } from "@/lib/admin-shared";
import { renderLabel } from "@/lib/label-render";
import { DateInput } from "@/components/admin/DateInput";
import { Pagination } from "@/components/admin/Pagination";
import { DeleteRowButton, useCanDelete } from "@/components/admin/DeleteRowButton";
import { deleteBatchRecord } from "@/lib/admin-delete.functions";
import { Plus, Loader2, X, ArrowRight, Truck, Printer, Search } from "lucide-react";

export const Route = createFileRoute("/admin/batches/")({ component: BatchesPage });

const BATCH_METHODS: BatchMethod[] = ["air", "sea", "express"];
const STATUSES: BatchStatus[] = ["draft", "locked", "shipped", "arrived", "closed"];

function BatchesPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listBatches);
  const fetchRoles = useServerFn(getMyRoles);
  const create = useServerFn(createBatch);
  const setBatchStatus = useServerFn(updateBatchStatus);
  const fetchCargoTypes = useServerFn(listCargoTypes);
  const fetchDests = useServerFn(listDestinations);
  const fetchRoutes = useServerFn(listRoutes);
  const fetchLabel = useServerFn(getContainerLabelData);
  const delBatch = useServerFn(deleteBatchRecord);
  const canDelete = useCanDelete();
  const confirmAllPrices = useServerFn(confirmAllBatchPrices);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  // Preset lists are only needed by the "new batch" dialog — load them lazily
  // so opening the batch list doesn't wait on three extra round-trips.
  const [showForm, setShowForm] = useState(false);

  const q = useQuery({ queryKey: ["admin-batches"], queryFn: () => fetchList() });
  const meQ = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles(), staleTime: 30 * 60_000, refetchOnMount: false, refetchOnWindowFocus: false });
  const cargoQ = useQuery({ queryKey: ["cargo-types"], queryFn: () => fetchCargoTypes(), enabled: showForm, staleTime: 10 * 60_000 });
  const destQ = useQuery({ queryKey: ["destinations"], queryFn: () => fetchDests(), enabled: showForm, staleTime: 10 * 60_000 });
  const routesQ = useQuery({ queryKey: ["routes-for-batches"], queryFn: () => fetchRoutes(), enabled: showForm, staleTime: 10 * 60_000 });
  const canCreate = (meQ.data?.roles ?? []).some(r => ["owner","manager","warehouse_cn"].includes(r));
  const canEdit = (meQ.data?.roles ?? []).some(r => ["owner","manager"].includes(r));

  // Methods derived from active shipping_routes; restricted to those supported by batches table
  const availableMethods = useMemo<BatchMethod[]>(() => {
    const set = new Set<string>();
    for (const r of (routesQ.data?.routes ?? []) as any[]) {
      if (r.shipping_method && BATCH_METHODS.includes(r.shipping_method as BatchMethod)) set.add(r.shipping_method);
    }
    return set.size ? Array.from(set) as BatchMethod[] : BATCH_METHODS;
  }, [routesQ.data]);

  const onPrint = async (id: string) => { const d = await fetchLabel({ data: { kind: "batch", id } }); renderLabel(d as any); };

  // 批量确认这个批次下所有客户的价格——跟详情页那个"批量确认价格"按钮调的是
  // 同一个函数，这里只是给列表页开个直达入口，不用先点进详情页。
  const onConfirmAll = async (b: any) => {
    if (
      !confirm(`确认批量确认批次 ${b.batch_no} 下所有客户的价格？会为每位客户生成/刷新未付账单快照，不会执行扣款。`)
    )
      return;
    setConfirmingId(b.id);
    try {
      const result: any = await confirmAllPrices({ data: { batchId: b.id } });
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
      if (result.snapshot_ok === false) {
        toast.error(`客户端快照刷新失败：${result.snapshot_error ?? "未知错误"}，请进入批次详情页重试`, {
          duration: 10000,
        });
      }
      await qc.invalidateQueries({ queryKey: ["admin-batches"] });
    } catch (e: any) {
      toast.error(e?.message ?? "批量确认失败");
    } finally {
      setConfirmingId(null);
    }
  };

  const [page, setPage] = useState(1); const pageSize = 10;
  const allBatches = useMemo(() => (q.data?.batches ?? []) as any[], [q.data]);

  // 筛选：方式/目的地都是纯前端过滤（数据已经在列表里），某一类里啥都不勾 = 不按
  // 这类过滤，全部显示；勾了就是"或"（勾海运+空运→两个都显示），几类之间是"且"
  // （海运 + tor → 只显示去 tor 的海运）。客户号需要查库，单独一个查询取交集。
  const [methodFilter, setMethodFilter] = useState<Set<BatchMethod>>(new Set());
  const [destFilter, setDestFilter] = useState<Set<string>>(new Set());
  const [customerCodeInput, setCustomerCodeInput] = useState("");
  const [debouncedCode, setDebouncedCode] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedCode(customerCodeInput.trim()), 400);
    return () => clearTimeout(t);
  }, [customerCodeInput]);

  const fetchBatchIdsForCode = useServerFn(findBatchIdsForCustomerCode);
  const codeQ = useQuery({
    queryKey: ["admin-batches-by-customer-code", debouncedCode],
    queryFn: () => fetchBatchIdsForCode({ data: { customerCode: debouncedCode } }),
    enabled: !!debouncedCode,
  });
  const customerBatchIds = useMemo(
    () => (debouncedCode ? new Set(((codeQ.data as any)?.batchIds ?? []) as string[]) : null),
    [debouncedCode, codeQ.data],
  );

  const availableDestinations = useMemo(
    () => Array.from(new Set(allBatches.map((b) => b.destination_code).filter(Boolean))).sort(),
    [allBatches],
  );

  const filteredBatches = useMemo(() => {
    return allBatches.filter((b) => {
      if (methodFilter.size > 0 && !methodFilter.has(b.shipping_method)) return false;
      if (destFilter.size > 0 && !destFilter.has(b.destination_code)) return false;
      // 客户号搜索还没查回来之前，宁可先不显示（避免一瞬间闪出一批不该显示的批次），
      // 查询失败也当作"查不到"处理，不当无过滤放行。
      if (debouncedCode) {
        if (codeQ.isLoading || !customerBatchIds) return false;
        if (!customerBatchIds.has(b.id)) return false;
      }
      return true;
    });
  }, [allBatches, methodFilter, destFilter, debouncedCode, customerBatchIds, codeQ.isLoading]);

  useEffect(() => {
    setPage(1);
  }, [methodFilter, destFilter, debouncedCode]);

  const toggleMethod = (m: BatchMethod) => {
    setMethodFilter((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };
  const toggleDest = (d: string) => {
    setDestFilter((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const pageItems = filteredBatches.slice((page - 1) * pageSize, page * pageSize);

  const [form, setForm] = useState({ display_name: "", planned_ship_date: "", shipping_method: "air" as BatchMethod, cargo_type: "", destination_code: "", notes: "" });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.planned_ship_date)) throw new Error("请输入完整发货日期 YYYY-MM-DD");
      await create({ data: form });
      setShowForm(false); setForm({ display_name: "", planned_ship_date: "", shipping_method: availableMethods[0] ?? "air", cargo_type: "", destination_code: "", notes: "" });
      await qc.invalidateQueries({ queryKey: ["admin-batches"] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Page title="批次管理" subtitle={
      q.data
        ? filteredBatches.length === allBatches.length
          ? `共 ${allBatches.length} 个批次`
          : `筛选出 ${filteredBatches.length} / ${allBatches.length} 个批次`
        : "加载中…"
    }
      action={canCreate && (
        <button onClick={() => { setForm(f => ({ ...f, shipping_method: availableMethods[0] ?? "air" })); setShowForm(true); }}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90">
          <Plus className="h-4 w-4"/>新建批次
        </button>
      )}>
      <div className="mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-white/5 bg-white/[0.02] px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] uppercase tracking-wider text-slate-500">方式</span>
          {BATCH_METHODS.map((m) => (
            <label
              key={m}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${methodFilter.has(m) ? "border-brand bg-brand/10 text-brand" : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"}`}
            >
              <input type="checkbox" checked={methodFilter.has(m)} onChange={() => toggleMethod(m)} className="hidden" />
              {METHOD_LABEL[m] ?? m}
            </label>
          ))}
        </div>
        {availableDestinations.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] uppercase tracking-wider text-slate-500">目的地</span>
            {availableDestinations.map((d) => (
              <label
                key={d}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${destFilter.has(d) ? "border-brand bg-brand/10 text-brand" : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20"}`}
              >
                <input type="checkbox" checked={destFilter.has(d)} onChange={() => toggleDest(d)} className="hidden" />
                {d}
              </label>
            ))}
          </div>
        )}
        <div className="relative ml-auto">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={customerCodeInput}
            onChange={(e) => setCustomerCodeInput(e.target.value)}
            placeholder="客户号"
            className="w-40 rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-7 text-xs text-slate-100 placeholder:text-slate-500 focus:border-brand focus:outline-none"
          />
          {debouncedCode && codeQ.isLoading && (
            <Loader2 className="absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-500" />
          )}
          {customerCodeInput && !codeQ.isLoading && (
            <button
              onClick={() => setCustomerCodeInput("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {(methodFilter.size > 0 || destFilter.size > 0 || customerCodeInput) && (
          <button
            onClick={() => {
              setMethodFilter(new Set());
              setDestFilter(new Set());
              setCustomerCodeInput("");
            }}
            className="text-xs text-slate-500 hover:text-slate-300"
          >
            清空筛选
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5">批次号</th>
              <th className="px-4 py-2.5">计划发货</th>
              <th className="px-4 py-2.5">方式</th>
              <th className="px-4 py-2.5">货物 / 目的地</th>
              <th className="px-4 py-2.5">运单数</th>
              <th className="px-4 py-2.5 text-right">总收费</th>
              <th className="px-4 py-2.5">账单快照</th>
              <th className="px-4 py-2.5">付款</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">创建</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && <tr><td colSpan={11} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500"/></td></tr>}
            {!q.isLoading && q.data?.batches.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-slate-500">暂无批次</td></tr>}
            {!q.isLoading && allBatches.length > 0 && filteredBatches.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-slate-500">没有符合筛选条件的批次</td></tr>}
            {pageItems.map((b: any) => {
              const pmap: Record<string, string> = { paid: "text-emerald-300", partial: "text-amber-300", unpaid: "text-rose-300", empty: "text-slate-500" };
              const plabel: Record<string, string> = { paid: "已付", partial: "部分", unpaid: "未付", empty: "—" };
              const grand = Number(b.grand_total_cny ?? 0);
              return (
              <tr key={b.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2.5">
                  {b.display_name && <div className="text-sm font-semibold text-slate-100">{b.display_name}</div>}
                  <div className="font-mono text-base text-brand">{b.batch_no}</div>
                </td>
                <td className="px-4 py-2.5 text-sm">{b.planned_ship_date}</td>
                <td className="px-4 py-2.5 text-sm">{METHOD_LABEL[b.shipping_method] ?? b.shipping_method}</td>
                <td className="px-4 py-2.5 text-sm text-slate-400">{b.cargo_type ?? "—"} / {b.destination_code ?? "—"}</td>
                <td className="px-4 py-2.5 text-sm font-semibold text-slate-200">{b.waybill_total ?? 0}</td>
                <td className="px-4 py-2.5 text-right text-sm font-mono">
                  {b.status === "draft"
                    ? <span className="text-slate-500" title="草稿状态不结算总额，锁定后写入">—（草稿）</span>
                    : <span className="font-semibold text-emerald-300">CA${grand.toFixed(2)}</span>}
                </td>
                <td className="px-4 py-2.5">
                  {(() => {
                    const total = Number(b.settlement_total ?? 0);
                    const confirmed = Number(b.settlement_confirmed ?? 0);
                    const label =
                      total === 0 ? "未确认" : confirmed === total ? `已确认 (${confirmed})` : `部分确认 (${confirmed}/${total})`;
                    const cls =
                      total === 0
                        ? "bg-slate-500/10 text-slate-400"
                        : confirmed === total
                          ? "bg-emerald-500/10 text-emerald-300"
                          : "bg-amber-500/10 text-amber-300";
                    return canEdit ? (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onConfirmAll(b);
                        }}
                        disabled={confirmingId === b.id}
                        title="点击批量确认这个批次下所有客户的价格"
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold hover:brightness-110 disabled:opacity-50 ${cls}`}
                      >
                        {confirmingId === b.id ? "确认中…" : label}
                      </button>
                    ) : (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
                    );
                  })()}
                </td>
                <td className={`px-4 py-2.5 text-sm ${pmap[b.payment_status] ?? ""}`}>{plabel[b.payment_status] ?? "—"}</td>
                <td className="px-4 py-2.5">
                  {canEdit ? (
                    <select value={b.status} onClick={(e) => e.stopPropagation()}
                      onChange={async (e) => {
                        await setBatchStatus({ data: { batchId: b.id, status: e.target.value as BatchStatus } });
                        qc.invalidateQueries({ queryKey: ["admin-batches"] });
                      }}
                      className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-100 [&>option]:bg-[#0E1626]">
                      {STATUSES.map(s => <option key={s} value={s}>{BATCH_STATUS_LABEL[s]}</option>)}
                    </select>
                  ) : <StatusBadge map={BATCH_STATUS_LABEL} color={BATCH_STATUS_COLOR} value={b.status}/>}
                </td>
                <td className="px-4 py-2.5 text-sm text-slate-400">{fmtDate(b.created_at)}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">
                  <button onClick={() => onPrint(b.id)} className="mr-2 text-xs text-slate-300 hover:text-white"><Printer className="inline h-3.5 w-3.5"/></button>
                  <Link to="/admin/batches/$batchId" params={{ batchId: b.id }} className="text-sm text-brand hover:underline">详情 <ArrowRight className="inline h-3.5 w-3.5"/></Link>
                  {canDelete && <DeleteRowButton label="批次" name={b.batch_no} extra="下属运单 / 箱号 / 托盘会被解绑，但不会删除。" onDelete={async () => { await delBatch({ data: { id: b.id } }); await qc.invalidateQueries({ queryKey: ["admin-batches"] }); }}/>}
                </td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={filteredBatches.length} onChange={setPage}/>



      {showForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <form onClick={(e) => e.stopPropagation()} onSubmit={onCreate}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold inline-flex items-center gap-2"><Truck className="h-4 w-4 text-brand"/>新建批次</h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X className="h-4 w-4"/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">批次名称（可选，可手动填写）</label>
                <input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  placeholder="例如：7月多伦多海运批次"
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
              </div>
              <div>
                <label className="text-xs text-slate-400">计划发货日期 *（直接输入年月日，如 20260628）</label>
                <DateInput value={form.planned_ship_date} onChange={(v) => setForm({ ...form, planned_ship_date: v })}/>
              </div>
              <div>
                <label className="text-xs text-slate-400">运输方式 *（同步自线路设置）</label>
                <select value={form.shipping_method} onChange={(e) => setForm({ ...form, shipping_method: e.target.value as any })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
                  {availableMethods.map(m => <option key={m} value={m}>{METHOD_LABEL[m] ?? m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">货物类型（后台字段）</label>
                <select value={form.cargo_type} onChange={(e) => setForm({ ...form, cargo_type: e.target.value })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
                  <option value="">— 请选择 —</option>
                  {cargoQ.data?.items.filter((c: any) => c.active).map((c: any) => (
                    <option key={c.id} value={c.code}>{c.code} · {c.name_zh}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">目的地（后台字段）</label>
                <select value={form.destination_code} onChange={(e) => setForm({ ...form, destination_code: e.target.value })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
                  <option value="">— 请选择 —</option>
                  {destQ.data?.items.filter((d: any) => d.active).map((d: any) => (
                    <option key={d.id} value={d.code}>{d.code} · {d.name_zh}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">备注</label>
                <textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
              </div>
              {err && <div className="text-xs text-rose-400">{err}</div>}
              <div className="text-[11px] text-slate-500">批次号示例：BAT{form.planned_ship_date.replaceAll("-","") || "YYYYMMDD"}{form.shipping_method === "air" ? "AIR" : form.shipping_method === "sea" ? "SEA" : "EXP"}{(form.cargo_type || "GEN").substring(0,4).toUpperCase()}{(form.destination_code || "XXX").toUpperCase()}001</div>
              <button type="submit" disabled={busy} className="w-full rounded-md bg-brand py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
                {busy ? "创建中…" : "创建"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Page>
  );
}
