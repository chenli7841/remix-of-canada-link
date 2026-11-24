import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { updateCarton, updatePallet } from "@/lib/cartons.functions";
import { toast } from "sonner";

export function ContainerBillingChoice({ kind, row }: { kind: "carton" | "pallet"; row: any }) {
  const carton = useServerFn(updateCarton), pallet = useServerFn(updatePallet);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const mode = row.billing_mode ?? "split";
  return <div className="rounded-xl border border-white/10 p-4">
    <label className="text-sm">收费方式
      <select aria-label="收费方式" disabled={busy} value={mode} className="ml-3 rounded bg-slate-900 p-2" onChange={async e => {
        const next = e.target.value;
        if (next === mode) return;
        setBusy(true);
        try {
          await (kind === "carton" ? carton : pallet)({ data: { id: row.id, patch: { billing_mode: next } } });
          await qc.invalidateQueries();
          toast.success("收费方式已保存；已确认账单需取消确认后重新核价");
        } catch (error: any) { toast.error(error.message ?? "保存失败"); }
        finally { setBusy(false); }
      }}><option value="split">按单收费</option><option value="merged">合箱收费</option></select>
    </label>
    <p className="mt-2 text-xs text-slate-400">合箱收费以当前箱号／托盘运费替代内部运费，不重复收取；关税、保险等仍按内部运单汇总。</p>
  </div>;
}
