import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { saveBatchCustomsParty } from "@/lib/batch-customs.functions";

const fields = [
  ["name", "公司名称"], ["contact_name", "联系人"], ["phone", "电话"],
  ["email", "邮箱"], ["address", "地址"], ["country", "国家／地区"], ["tax_id", "税号"],
] as const;

export function BatchPartiesEditor({ batch, canEdit, onSaved }: {
  batch: any; canEdit: boolean; onSaved: () => Promise<unknown>;
}) {
  return <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
    {(["customs_shipper", "customs_consignee"] as const).map((party) =>
      <PartyEditor key={`${batch.id}-${party}`} batchId={batch.id} party={party}
        saved={batch[party]} canEdit={canEdit} onSaved={onSaved} />)}
  </div>;
}

function PartyEditor({ batchId, party, saved, canEdit, onSaved }: {
  batchId: string; party: "customs_shipper" | "customs_consignee"; saved: any;
  canEdit: boolean; onSaved: () => Promise<unknown>;
}) {
  const save = useServerFn(saveBatchCustomsParty);
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [busy, setBusy] = useState(false);
  const current = Object.fromEntries(fields.map(([key]) => [key, String(saved?.[key] ?? "")]));
  const value = draft ?? current;
  const title = party === "customs_shipper" ? "发货方资料" : "收货方资料";
  const dirty = fields.some(([key]) => value[key] !== current[key]);
  return <form onSubmit={async (e) => {
    e.preventDefault();
    if (!canEdit || busy || !dirty) return;
    setBusy(true);
    try {
      await save({ data: { batchId, party, values: value } });
      await onSaved();
      setDraft(null);
      toast.success(`${title}已保存`);
    } catch (error: any) { toast.error(error?.message ?? "保存失败，请重试"); }
    finally { setBusy(false); }
  }}>
    <h3 className="mb-2 text-sm font-semibold text-slate-200">{title}</h3>
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {fields.map(([key, label]) => <label key={key} className={`text-xs text-slate-400 ${key === "address" ? "sm:col-span-2" : ""}`}>
        {label}
        {key === "address" ? <textarea aria-label={`${title}－${label}`} rows={2} maxLength={1000} disabled={!canEdit || busy}
          value={value[key]} onChange={(e) => setDraft({ ...value, [key]: e.target.value })}
          className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100" />
          : <input aria-label={`${title}－${label}`} type={key === "email" ? "email" : key === "phone" ? "tel" : "text"}
            disabled={!canEdit || busy} value={value[key]} maxLength={1000}
            onChange={(e) => setDraft({ ...value, [key]: e.target.value })}
            className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100" />}
      </label>)}
    </div>
    {canEdit && <div className="mt-2 flex gap-2">
      <button type="submit" disabled={busy || !dirty} className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
        {busy ? "保存中…" : `保存${title}`}
      </button>
      {dirty && <button type="button" disabled={busy} onClick={() => setDraft(null)} className="text-xs text-slate-400">取消修改</button>}
    </div>}
  </form>;
}
