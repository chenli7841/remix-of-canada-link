import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listCargoTypes, upsertCargoType, deleteCargoType } from "@/lib/presets.functions";
import { Page } from "@/lib/admin-shared";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/cargo-types")({ component: CargoTypesPage });

function CargoTypesPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listCargoTypes);
  const save = useServerFn(upsertCargoType);
  const del = useServerFn(deleteCargoType);
  const q = useQuery({ queryKey: ["cargo-types"], queryFn: () => fetchList() });
  const [editing, setEditing] = useState<any | null>(null);
  const [show, setShow] = useState(false);

  return (
    <Page title="货物类型" subtitle="后台预设；批次创建时通过下拉选择"
      action={<button onClick={() => { setEditing(null); setShow(true); }}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4"/>新增</button>}>
      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
            <tr><th className="px-4 py-2.5">代码</th><th>中文</th><th>英文</th><th>排序</th><th>状态</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && <tr><td colSpan={6} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500"/></td></tr>}
            {q.data?.items.map((c: any) => (
              <tr key={c.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-2.5 font-mono text-xs text-brand">{c.code}</td>
                <td className="text-sm">{c.name_zh}</td>
                <td className="text-xs text-slate-400">{c.name_en ?? "—"}</td>
                <td className="text-xs">{c.sort_order}</td>
                <td className="text-xs">{c.active ? <span className="text-emerald-400">启用</span> : <span className="text-slate-500">停用</span>}</td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => { setEditing(c); setShow(true); }} className="mr-2 text-xs text-slate-300 hover:text-white"><Pencil className="inline h-3 w-3"/></button>
                  <button onClick={async () => { if (confirm("删除？")) { await del({ data: { id: c.id } }); qc.invalidateQueries({ queryKey: ["cargo-types"] }); } }}
                    className="text-xs text-rose-400 hover:text-rose-300"><Trash2 className="inline h-3 w-3"/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show && <EditModal initial={editing} onClose={() => setShow(false)} onSave={async (p) => {
        await save({ data: p }); setShow(false); qc.invalidateQueries({ queryKey: ["cargo-types"] });
      }}/>}
    </Page>
  );
}

function EditModal({ initial, onClose, onSave }: { initial: any; onClose: () => void; onSave: (p: any) => Promise<void> }) {
  const [form, setForm] = useState({
    id: initial?.id, code: initial?.code ?? "", name_zh: initial?.name_zh ?? "",
    name_en: initial?.name_en ?? "", sort_order: initial?.sort_order ?? 0, active: initial?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <form onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); setBusy(true); await onSave(form); setBusy(false); }}
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
        <div className="mb-3 flex items-center justify-between"><h2 className="font-display text-lg font-bold">{initial ? "编辑" : "新增"}货物类型</h2>
          <button type="button" onClick={onClose}><X className="h-4 w-4 text-slate-400"/></button></div>
        <div className="space-y-3">
          <Field label="代码 *"><input required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className={input}/></Field>
          <Field label="中文名 *"><input required value={form.name_zh} onChange={(e) => setForm({ ...form, name_zh: e.target.value })} className={input}/></Field>
          <Field label="英文名"><input value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} className={input}/></Field>
          <Field label="排序"><input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: +e.target.value })} className={input}/></Field>
          <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/>启用</label>
          <button disabled={busy} className="w-full rounded-md bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "保存中…" : "保存"}</button>
        </div>
      </form>
    </div>
  );
}
const input = "mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs text-slate-400">{label}</label>{children}</div>;
}
