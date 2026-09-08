import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listTrackingPresets, upsertTrackingPreset, deleteTrackingPreset } from "@/lib/orders.functions";
import { getMyRoles } from "@/lib/admin.functions";
import { Page, Card } from "@/lib/admin-shared";
import { Plus, Pencil, Trash2, X, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/tracking-presets")({ component: PresetsPage });

function PresetsPage() {
  const qc = useQueryClient();
  const fetchList = useServerFn(listTrackingPresets);
  const fetchRoles = useServerFn(getMyRoles);
  const upsert = useServerFn(upsertTrackingPreset);
  const del = useServerFn(deleteTrackingPreset);

  const q = useQuery({ queryKey: ["tracking-presets"], queryFn: () => fetchList() });
  const meQ = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles(), staleTime: 60_000 });
  const canEdit = (meQ.data?.roles ?? []).some(r => r === "owner" || r === "manager");

  const [editing, setEditing] = useState<any | null>(null);

  return (
    <Page title="物流轨迹预设" subtitle="管理常用物流轨迹文案，可在添加轨迹时一键选用"
      action={canEdit && (
        <button onClick={() => setEditing({})}
          className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90">
          <Plus className="h-4 w-4"/>新增预设
        </button>
      )}>
      <Card>
        {q.isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500"/>}
        <table className="w-full text-sm">
          <thead className="text-left text-[11px] uppercase text-slate-500">
            <tr><th className="py-2">代码</th><th>中文</th><th>英文</th><th>默认位置</th><th>排序</th><th>启用</th><th></th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.data?.presets.map((p: any) => (
              <tr key={p.id} className="hover:bg-white/[0.03]">
                <td className="py-2 font-mono text-xs">{p.code}</td>
                <td className="text-sm">{p.label_zh}</td>
                <td className="text-xs text-slate-400">{p.label_en ?? "—"}</td>
                <td className="text-xs text-slate-400">{p.default_location_zh ?? "—"}</td>
                <td className="text-xs">{p.sort_order}</td>
                <td className="text-xs">{p.is_active ? <span className="text-emerald-300">是</span> : <span className="text-slate-500">否</span>}</td>
                <td className="text-right">
                  {canEdit && (
                    <div className="inline-flex gap-1">
                      <button onClick={() => setEditing(p)} className="rounded p-1 text-slate-400 hover:bg-white/10"><Pencil className="h-3 w-3"/></button>
                      <button onClick={async () => { if (confirm("删除？")) { await del({ data: { id: p.id } }); qc.invalidateQueries({ queryKey: ["tracking-presets"] }); } }}
                        className="rounded p-1 text-rose-400 hover:bg-rose-500/10"><Trash2 className="h-3 w-3"/></button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {editing && (
        <PresetForm initial={editing} onClose={() => setEditing(null)} onSave={async (payload, id) => {
          await upsert({ data: { id, payload } });
          await qc.invalidateQueries({ queryKey: ["tracking-presets"] });
          setEditing(null);
        }}/>
      )}
    </Page>
  );
}

function PresetForm({ initial, onClose, onSave }: { initial: any; onClose: () => void; onSave: (payload: any, id?: string) => Promise<void> }) {
  const [f, setF] = useState({
    code: initial.code ?? "", label_zh: initial.label_zh ?? "", label_en: initial.label_en ?? "",
    default_location_zh: initial.default_location_zh ?? "", default_location_en: initial.default_location_en ?? "",
    sort_order: initial.sort_order ?? 0, is_active: initial.is_active ?? true,
  });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <form onClick={(e) => e.stopPropagation()} onSubmit={async (e) => {
        e.preventDefault(); setBusy(true); setErr(null);
        try { await onSave(f, initial.id); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
      }} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">{initial.id ? "编辑预设" : "新增预设"}</h2>
          <button type="button" onClick={onClose} className="text-slate-400"><X className="h-4 w-4"/></button>
        </div>
        <div className="space-y-3 text-sm">
          {[
            ["code", "代码 *", true],
            ["label_zh", "中文 *", true],
            ["label_en", "英文", false],
            ["default_location_zh", "默认位置（中）", false],
            ["default_location_en", "默认位置（英）", false],
          ].map(([k, l, req]) => (
            <div key={k as string}>
              <label className="text-xs text-slate-400">{l as string}</label>
              <input value={(f as any)[k as string]} onChange={(e) => setF({ ...f, [k as string]: e.target.value })} required={req as boolean}
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-slate-100"/>
            </div>
          ))}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs text-slate-400">排序</label>
              <input type="number" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: Number(e.target.value) })}
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-slate-100"/>
            </div>
            <label className="flex items-end gap-2 text-xs text-slate-300 pb-2">
              <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })}/>启用
            </label>
          </div>
          {err && <div className="text-xs text-rose-400">{err}</div>}
          <button type="submit" disabled={busy} className="w-full rounded-md bg-brand py-2 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </div>
  );
}
