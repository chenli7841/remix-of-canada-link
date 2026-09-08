import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, fmtDate } from "@/lib/admin-shared";
import {
  listSurcharges,
  addSurcharge,
  updateSurcharge,
  deleteSurcharge,
  type SurchargeScope,
} from "@/lib/surcharges.functions";
import { Plus, Trash2, Loader2, Save, Pencil, X, Truck } from "lucide-react";
import { BulkDeliveryFeeDialog } from "@/components/admin/BulkDeliveryFeeDialog";

type Props = {
  scope: SurchargeScope;
  id: string;
  canEdit?: boolean;
  /** Batch scope: show customer_code field. */
  showCustomerField?: boolean;
  /** Override the card title. */
  title?: string;
  onChanged?: () => void;
};

const SCOPE_LABEL: Record<SurchargeScope, string> = {
  waybill: "运单",
  carton: "箱号",
  pallet: "托盘",
  batch: "批次",
  forwarding: "集运订单",
};

export function SurchargePanel({ scope, id, canEdit = true, showCustomerField, title, onChanged }: Props) {
  const qc = useQueryClient();
  const fetchList = useServerFn(listSurcharges);
  const addFn = useServerFn(addSurcharge);
  const updFn = useServerFn(updateSurcharge);
  const delFn = useServerFn(deleteSurcharge);

  const key = ["surcharges", scope, id];
  const q = useQuery({ queryKey: key, queryFn: () => fetchList({ data: { scope, id } }) });

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ amount_cny: "", note: "", customer_code: "" });
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ amount_cny: "", note: "", customer_code: "" });
  const [err, setErr] = useState<string | null>(null);
  const [showBulk, setShowBulk] = useState(false);

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: key });
    onChanged?.();
  };

  const onAdd = async () => {
    setErr(null);
    const amt = Number(form.amount_cny);
    if (!isFinite(amt) || amt === 0) {
      setErr("请填写有效的金额（可以是负数表示扣减）");
      return;
    }
    if (!form.note.trim()) {
      setErr("请填写费用说明");
      return;
    }
    if (scope === "batch" && !form.customer_code.trim()) {
      setErr("批次附加费必须归属到具体客户号（按客户号账单层级）");
      return;
    }
    setBusy(true);
    try {
      await addFn({
        data: {
          scope,
          id,
          amount_cny: amt,
          note: form.note,
          customer_code: showCustomerField ? form.customer_code.trim() || null : null,
        },
      });
      setForm({ amount_cny: "", note: "", customer_code: "" });
      setAdding(false);
      await refresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const onSaveEdit = async (rowId: string) => {
    setBusy(true);
    try {
      await updFn({
        data: {
          id: rowId,
          amount_cny: Number(editForm.amount_cny),
          note: editForm.note,
          customer_code: showCustomerField ? editForm.customer_code.trim() || null : undefined,
        },
      });
      setEditingId(null);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (rowId: string) => {
    if (!confirm("删除这条附加费？")) return;
    setBusy(true);
    try {
      await delFn({ data: { id: rowId } });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={title ?? `附加费 · ${SCOPE_LABEL[scope]}`}
      action={
        canEdit &&
        !adding && (
          <div className="flex items-center gap-2">
            {scope === "batch" && (
              <button
                onClick={() => setShowBulk(true)}
                className="inline-flex items-center gap-1 rounded-md border border-brand/40 px-2 py-1 text-xs font-semibold text-brand hover:bg-brand/10"
              >
                <Truck className="h-3 w-3" />
                批量添加派送费
              </button>
            )}
            <button
              onClick={() => {
                setAdding(true);
                setErr(null);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-xs font-semibold text-white hover:bg-brand/90"
            >
              <Plus className="h-3 w-3" />
              添加
            </button>
          </div>
        )
      }
    >
      {q.isLoading && (
        <div className="py-4">
          <Loader2 className="mx-auto h-4 w-4 animate-spin text-slate-500" />
        </div>
      )}
      {q.isError && <div className="text-xs text-rose-400">{(q.error as Error).message}</div>}

      {q.data && (
        <>
          {adding && (
            <div className="mb-3 rounded-md border border-brand/30 bg-brand/5 p-2.5 space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[120px_1fr]">
                <input
                  type="number"
                  step="0.01"
                  value={form.amount_cny}
                  onChange={(e) => setForm({ ...form, amount_cny: e.target.value })}
                  placeholder="金额（¥，可负）"
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100"
                />
                <input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="说明（必填，例如：仓库重新打包费）"
                  className="rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-slate-100"
                />
              </div>
              {showCustomerField && (
                <input
                  value={form.customer_code}
                  onChange={(e) => setForm({ ...form, customer_code: e.target.value })}
                  placeholder={scope === "batch" ? "归属客户号（必填，按客户号账单层级归集）" : "归属客户号（可选）"}
                  className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-xs font-mono text-slate-100"
                />
              )}
              {err && <div className="text-xs text-rose-400">{err}</div>}
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => {
                    setAdding(false);
                    setErr(null);
                  }}
                  className="rounded-md border border-white/10 px-3 py-1 text-xs"
                >
                  取消
                </button>
                <button
                  onClick={onAdd}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}保存
                </button>
              </div>
            </div>
          )}

          {q.data.items.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-500">暂无附加费</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="py-1.5 w-24">金额 ¥</th>
                  <th>说明</th>
                  {showCustomerField && <th className="w-28">归属客户</th>}
                  <th className="w-32">操作人 / 时间</th>
                  {canEdit && <th className="w-16"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {q.data.items.map((r: any) => {
                  const isEditing = editingId === r.id;
                  return (
                    <tr key={r.id}>
                      <td className="py-1.5">
                        {isEditing ? (
                          <input
                            type="number"
                            step="0.01"
                            value={editForm.amount_cny}
                            onChange={(e) => setEditForm({ ...editForm, amount_cny: e.target.value })}
                            className="w-full rounded border border-white/10 bg-white/5 px-1 py-0.5 text-xs"
                          />
                        ) : (
                          <span
                            className={`font-mono text-xs ${Number(r.amount_cny) < 0 ? "text-rose-300" : "text-emerald-300"}`}
                          >
                            {Number(r.amount_cny).toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="text-xs">
                        {isEditing ? (
                          <input
                            value={editForm.note}
                            onChange={(e) => setEditForm({ ...editForm, note: e.target.value })}
                            className="w-full rounded border border-white/10 bg-white/5 px-1 py-0.5 text-xs"
                          />
                        ) : (
                          <span className="text-slate-200">{r.note}</span>
                        )}
                      </td>
                      {showCustomerField && (
                        <td className="text-xs">
                          {isEditing ? (
                            <input
                              value={editForm.customer_code}
                              onChange={(e) => setEditForm({ ...editForm, customer_code: e.target.value })}
                              className="w-full rounded border border-white/10 bg-white/5 px-1 py-0.5 text-xs font-mono"
                              placeholder="(空)"
                            />
                          ) : (
                            <span className="font-mono text-slate-300">{r.customer_code ?? "—（共担）"}</span>
                          )}
                        </td>
                      )}
                      <td className="text-[10px] text-slate-500">
                        {r.created_by_name ?? "—"}
                        <br />
                        {fmtDate(r.created_at)}
                      </td>
                      {canEdit && (
                        <td className="text-right">
                          {isEditing ? (
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => onSaveEdit(r.id)}
                                disabled={busy}
                                className="rounded p-1 text-emerald-300 hover:bg-emerald-500/10"
                              >
                                <Save className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => setEditingId(null)}
                                className="rounded p-1 text-slate-400 hover:bg-white/10"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex justify-end gap-1">
                              <button
                                onClick={() => {
                                  setEditingId(r.id);
                                  setEditForm({
                                    amount_cny: String(r.amount_cny),
                                    note: r.note,
                                    customer_code: r.customer_code ?? "",
                                  });
                                }}
                                className="rounded p-1 text-slate-400 hover:bg-white/10"
                              >
                                <Pencil className="h-3 w-3" />
                              </button>
                              <button
                                onClick={() => onDelete(r.id)}
                                className="rounded p-1 text-rose-400 hover:bg-rose-500/10"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
                <tr className="bg-white/[0.02]">
                  <td className="py-1.5 font-mono text-xs font-bold text-amber-300">{q.data.total_cny.toFixed(2)}</td>
                  <td className="text-[10px] text-slate-500" colSpan={showCustomerField ? 4 : 3}>
                    合计
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </>
      )}
      {showBulk && <BulkDeliveryFeeDialog batchId={id} onClose={() => setShowBulk(false)} onApplied={refresh} />}
    </Card>
  );
}
