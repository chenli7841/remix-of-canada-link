import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  listBatches,
  createBatch,
  updateBatchStatus,
  type BatchMethod,
  type BatchStatus,
} from "@/lib/orders.functions";
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
import { Plus, Loader2, X, ArrowRight, Truck, Printer } from "lucide-react";

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

  // Preset lists are only needed by the "new batch" dialog — load them lazily
  // so opening the batch list doesn't wait on three extra round-trips.
  const [showForm, setShowForm] = useState(false);

  const q = useQuery({ queryKey: ["admin-batches"], queryFn: () => fetchList() });
  const meQ = useQuery({
    queryKey: ["my-roles"],
    queryFn: () => fetchRoles(),
    staleTime: 30 * 60_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
  const cargoQ = useQuery({
    queryKey: ["cargo-types"],
    queryFn: () => fetchCargoTypes(),
    enabled: showForm,
    staleTime: 10 * 60_000,
  });
  const destQ = useQuery({
    queryKey: ["destinations"],
    queryFn: () => fetchDests(),
    enabled: showForm,
    staleTime: 10 * 60_000,
  });
  const routesQ = useQuery({
    queryKey: ["routes-for-batches"],
    queryFn: () => fetchRoutes(),
    enabled: showForm,
    staleTime: 10 * 60_000,
  });
  const canCreate = (meQ.data?.roles ?? []).some((r) => ["owner", "manager", "warehouse_cn"].includes(r));
  const canEdit = (meQ.data?.roles ?? []).some((r) => ["owner", "manager"].includes(r));

  // Methods derived from active shipping_routes; restricted to those supported by batches table
  const availableMethods = useMemo<BatchMethod[]>(() => {
    const set = new Set<string>();
    for (const r of (routesQ.data?.routes ?? []) as any[]) {
      if (r.shipping_method && BATCH_METHODS.includes(r.shipping_method as BatchMethod)) set.add(r.shipping_method);
    }
    return set.size ? (Array.from(set) as BatchMethod[]) : BATCH_METHODS;
  }, [routesQ.data]);

  const onPrint = async (id: string) => {
    const d = await fetchLabel({ data: { kind: "batch", id } });
    renderLabel(d as any);
  };

  const [page, setPage] = useState(1);
  const pageSize = 10;
  const allBatches = (q.data?.batches ?? []) as any[];
  const pageItems = allBatches.slice((page - 1) * pageSize, page * pageSize);

  const [form, setForm] = useState({
    display_name: "",
    planned_ship_date: "",
    shipping_method: "air" as BatchMethod,
    cargo_type: "",
    destination_code: "",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.planned_ship_date)) throw new Error("请输入完整发货日期 YYYY-MM-DD");
      await create({ data: form });
      setShowForm(false);
      setForm({
        display_name: "",
        planned_ship_date: "",
        shipping_method: availableMethods[0] ?? "air",
        cargo_type: "",
        destination_code: "",
        notes: "",
      });
      await qc.invalidateQueries({ queryKey: ["admin-batches"] });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="批次管理"
      subtitle={q.data ? `共 ${q.data.batches.length} 个批次` : "加载中…"}
      action={
        canCreate && (
          <button
            onClick={() => {
              setForm((f) => ({ ...f, shipping_method: availableMethods[0] ?? "air" }));
              setShowForm(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90"
          >
            <Plus className="h-4 w-4" />
            新建批次
          </button>
        )
      }
    >
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
              <th className="px-4 py-2.5">付款</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">创建</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && (
              <tr>
                <td colSpan={10} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" />
                </td>
              </tr>
            )}
            {q.data?.batches.length === 0 && (
              <tr>
                <td colSpan={10} className="py-10 text-center text-slate-500">
                  暂无批次
                </td>
              </tr>
            )}
            {pageItems.map((b: any) => {
              const pmap: Record<string, string> = {
                paid: "text-emerald-300",
                partial: "text-amber-300",
                unpaid: "text-rose-300",
                empty: "text-slate-500",
              };
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
                  <td className="px-4 py-2.5 text-sm text-slate-400">
                    {b.cargo_type ?? "—"} / {b.destination_code ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-sm font-semibold text-slate-200">{b.waybill_total ?? 0}</td>
                  <td className="px-4 py-2.5 text-right text-sm font-mono">
                    {b.status === "draft" ? (
                      <span className="text-slate-500" title="草稿状态不结算总额，锁定后写入">
                        —（草稿）
                      </span>
                    ) : (
                      <span className="font-semibold text-emerald-300">CA${grand.toFixed(2)}</span>
                    )}
                  </td>
                  <td className={`px-4 py-2.5 text-sm ${pmap[b.payment_status] ?? ""}`}>
                    {plabel[b.payment_status] ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {canEdit ? (
                      <select
                        value={b.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={async (e) => {
                          await setBatchStatus({ data: { batchId: b.id, status: e.target.value as BatchStatus } });
                          qc.invalidateQueries({ queryKey: ["admin-batches"] });
                        }}
                        className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-100 [&>option]:bg-[#0E1626]"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {BATCH_STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <StatusBadge map={BATCH_STATUS_LABEL} color={BATCH_STATUS_COLOR} value={b.status} />
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-sm text-slate-400">{fmtDate(b.created_at)}</td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => onPrint(b.id)} className="mr-2 text-xs text-slate-300 hover:text-white">
                      <Printer className="inline h-3.5 w-3.5" />
                    </button>
                    <Link
                      to="/admin/batches/$batchId"
                      params={{ batchId: b.id }}
                      className="text-sm text-brand hover:underline"
                    >
                      详情 <ArrowRight className="inline h-3.5 w-3.5" />
                    </Link>
                    {canDelete && (
                      <DeleteRowButton
                        label="批次"
                        name={b.batch_no}
                        extra="下属运单 / 箱号 / 托盘会被解绑，但不会删除。"
                        onDelete={async () => {
                          await delBatch({ data: { id: b.id } });
                          await qc.invalidateQueries({ queryKey: ["admin-batches"] });
                        }}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pageSize={pageSize} total={allBatches.length} onChange={setPage} />

      {showForm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={onCreate}
            className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A0F1A] p-5"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold inline-flex items-center gap-2">
                <Truck className="h-4 w-4 text-brand" />
                新建批次
              </h2>
              <button type="button" onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-400">批次名称（可选，可手动填写）</label>
                <input
                  value={form.display_name}
                  onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  placeholder="例如：7月多伦多海运批次"
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">计划发货日期 *（直接输入年月日，如 20260628）</label>
                <DateInput
                  value={form.planned_ship_date}
                  onChange={(v) => setForm({ ...form, planned_ship_date: v })}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400">运输方式 *（同步自线路设置）</label>
                <select
                  value={form.shipping_method}
                  onChange={(e) => setForm({ ...form, shipping_method: e.target.value as any })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]"
                >
                  {availableMethods.map((m) => (
                    <option key={m} value={m}>
                      {METHOD_LABEL[m] ?? m}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">货物类型（后台字段）</label>
                <select
                  value={form.cargo_type}
                  onChange={(e) => setForm({ ...form, cargo_type: e.target.value })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]"
                >
                  <option value="">— 请选择 —</option>
                  {cargoQ.data?.items
                    .filter((c: any) => c.active)
                    .map((c: any) => (
                      <option key={c.id} value={c.code}>
                        {c.code} · {c.name_zh}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">目的地（后台字段）</label>
                <select
                  value={form.destination_code}
                  onChange={(e) => setForm({ ...form, destination_code: e.target.value })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]"
                >
                  <option value="">— 请选择 —</option>
                  {destQ.data?.items
                    .filter((d: any) => d.active)
                    .map((d: any) => (
                      <option key={d.id} value={d.code}>
                        {d.code} · {d.name_zh}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-400">备注</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
                />
              </div>
              {err && <div className="text-xs text-rose-400">{err}</div>}
              <div className="text-[11px] text-slate-500">
                批次号示例：BAT{form.planned_ship_date.replaceAll("-", "") || "YYYYMMDD"}
                {form.shipping_method === "air" ? "AIR" : form.shipping_method === "sea" ? "SEA" : "EXP"}
                {(form.cargo_type || "GEN").substring(0, 4).toUpperCase()}
                {(form.destination_code || "XXX").toUpperCase()}001
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-md bg-brand py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50"
              >
                {busy ? "创建中…" : "创建"}
              </button>
            </div>
          </form>
        </div>
      )}
    </Page>
  );
}
