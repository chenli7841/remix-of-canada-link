import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listBatches, bulkApplyBatchDeliveryFee } from "@/lib/orders.functions";
import { Loader2, X, Truck } from "lucide-react";

type Props = {
  batchId: string;
  onClose: () => void;
  onApplied: () => void;
};

export function BulkDeliveryFeeDialog({ batchId, onClose, onApplied }: Props) {
  const fetchBatches = useServerFn(listBatches);
  const applyFn = useServerFn(bulkApplyBatchDeliveryFee);
  const batchesQ = useQuery({ queryKey: ["admin-batches-for-compare"], queryFn: () => fetchBatches() });

  const [fee, setFee] = useState("");
  const [trigger, setTrigger] = useState("");
  const [compareId, setCompareId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const candidates = ((batchesQ.data as any)?.batches ?? []).filter((b: any) => b.id !== batchId);

  const onSubmit = async () => {
    setErr(null);
    setResult(null);
    const feeAmt = Number(fee);
    const trgAmt = Number(trigger);
    if (!isFinite(feeAmt) || feeAmt <= 0) {
      setErr("请填写有效的派送费金额");
      return;
    }
    if (!isFinite(trgAmt) || trgAmt <= 0) {
      setErr("请填写有效的触发重量");
      return;
    }
    setBusy(true);
    try {
      const r: any = await applyFn({
        data: { batchId, feeCad: feeAmt, triggerWeightKg: trgAmt, compareBatchId: compareId || null },
      });
      setResult(r);
      onApplied();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#0A0F1A] p-5"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold inline-flex items-center gap-2">
            <Truck className="h-5 w-5 text-brand" />
            批量添加派送费
          </h2>
          <button onClick={onClose}>
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>
        <p className="mb-3 text-xs leading-snug text-slate-400">
          按客户号计费重量（实重与体积重取大者，体积重 ÷6000 估算）自动筛选：计费重量低于触发重量的客户自动加入派送费。
          若选择了对比批次，则用「本批次 + 对比批次」合并后的计费重量判断——合并后仍低于触发重量则加入派送费；
          若合并后已达到触发重量，且对比批次已为该客户收取过派送费，则在本批次为该客户加入等额折扣冲抵，避免重复收取。
        </p>

        <div className="space-y-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500">派送费金额 (CAD)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
              placeholder="例如 15"
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500">派送费触发重量 (kg)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder="例如 100（计费重量低于该值才收取）"
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-500">
              对比批次（可选 · 合并计费重量判断，避免拆批漏收 / 重复收）
            </label>
            <select
              value={compareId}
              onChange={(e) => setCompareId(e.target.value)}
              className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="">不对比（仅按本批次计费重量判断）</option>
              {candidates.map((b: any) => (
                <option key={b.id} value={b.id}>
                  {b.batch_no} · {new Date(b.created_at).toLocaleDateString("zh-CN")}
                </option>
              ))}
            </select>
          </div>
        </div>

        {err && <div className="mt-2 text-xs text-rose-400">{err}</div>}

        {result && (
          <div className="mt-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-200">
            已处理：加入派送费 {result.charged_count} 位 · 加入冲抵折扣 {result.discounted_count} 位 · 未处理{" "}
            {result.skipped_count} 位
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-white/10 px-3 py-1.5 text-xs">
            关闭
          </button>
          <button
            onClick={onSubmit}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            批量添加
          </button>
        </div>
      </div>
    </div>
  );
}
