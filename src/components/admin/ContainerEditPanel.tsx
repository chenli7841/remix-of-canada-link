import { useEffect, useState } from "react";
import { Card } from "@/lib/admin-shared";
import { Save, Loader2, Lock } from "lucide-react";

type Kind = "carton" | "pallet";

const CARTON_STATUS = ["pending", "procurement", "received", "storage", "packed", "shipped", "arrived", "in_transit", "ready_pickup", "delivered", "cancelled", "closed", "draft", "locked"];

export function ContainerEditPanel({
  kind, row, onSave, locked,
}: {
  kind: Kind;
  row: any;
  onSave: (patch: any) => Promise<any>;
  locked?: boolean;
}) {
  const [f, setF] = useState({
    display_name: row.display_name ?? "",
    route_code: row.route_code ?? "",
    status: row.status ?? "",
    customer_code: row.customer_code ?? "",
    pickup_warehouse: row.pickup_warehouse ?? "",
    destination_code: row.destination_code ?? "",
  });
  useEffect(() => {
    setF({
      display_name: row.display_name ?? "",
      route_code: row.route_code ?? "",
      status: row.status ?? "",
      customer_code: row.customer_code ?? "",
      pickup_warehouse: row.pickup_warehouse ?? "",
      destination_code: row.destination_code ?? "",
    });
  }, [row.id, row.display_name, row.route_code, row.status, row.customer_code, row.pickup_warehouse, row.destination_code]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = async () => {
    if (locked) return;
    setSaving(true); setErr(null);
    try {
      const patch: any = {};
      for (const k of Object.keys(f) as (keyof typeof f)[]) {
        const v = (f[k] ?? "").toString().trim();
        patch[k] = v === "" ? null : v;
      }
      await onSave(patch);
    } catch (e: any) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const upd = (k: keyof typeof f) => (e: any) => setF({ ...f, [k]: e.target.value });
  const inputCls = `mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 ${locked ? "opacity-50 cursor-not-allowed" : ""}`;

  return (
    <Card title={`基本字段 · ${kind === "carton" ? "箱号" : "托盘"}线路/状态/客户/地点`} action={
      <button onClick={handleSave} disabled={saving || locked} title={locked ? "已锁定" : ""}
        className="inline-flex items-center gap-1 rounded-md bg-brand px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50">
        {locked ? <Lock className="h-3 w-3"/> : saving ? <Loader2 className="h-3 w-3 animate-spin"/> : <Save className="h-3 w-3"/>}保存
      </button>
    }>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 text-xs">
        <F label="名称" value={f.display_name} onChange={upd("display_name")} placeholder="可手动填写" disabled={locked}/>
        <F label="线路代码" value={f.route_code} onChange={upd("route_code")} placeholder="例如 CAAIR" disabled={locked}/>
        <div>
          <label className="text-slate-400">状态</label>
          <select value={f.status} onChange={upd("status")} disabled={locked}
            className={`mt-1 w-full rounded-md border border-slate-600 bg-slate-700 px-2 py-1.5 text-sm text-white ${locked ? "opacity-60 cursor-not-allowed" : ""}`}>
            {CARTON_STATUS.map((s) => <option key={s} value={s} className="bg-slate-700 text-white">{s}</option>)}
          </select>
        </div>
        <F label="客户号" value={f.customer_code} onChange={upd("customer_code")} placeholder="5 位客户号" disabled={locked}/>
        <F label="取货点" value={f.pickup_warehouse} onChange={upd("pickup_warehouse")} placeholder="仓库名" disabled={locked}/>
        <F label="目的地" value={f.destination_code} onChange={upd("destination_code")} placeholder="TOR / YVR ..." disabled={locked}/>
      </div>
      {err && <div className="mt-2 text-xs text-rose-400">{err}</div>}
      <div className="mt-2 text-[10px] text-slate-500">
        {locked
          ? "所属批次已非草稿状态且未解锁，字段只读。"
          : "修改后立即保存并写入操作记录。线路代码变化会影响运费重算。状态会随所属批次自动同步。"}
      </div>
    </Card>
  );
}

function F({ label, value, onChange, placeholder, disabled }: { label: string; value: any; onChange: (e: any) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <div>
      <label className="text-slate-400">{label}</label>
      <input value={value} onChange={onChange} placeholder={placeholder} disabled={disabled}
        className={`mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}/>
    </div>
  );
}
