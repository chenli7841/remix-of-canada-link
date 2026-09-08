import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listOversizeRules, upsertOversizeRule, deleteOversizeRule, listRoutes, type OversizeRule } from "@/lib/settings.functions";
import { getMyRoles } from "@/lib/admin.functions";
import { Page, Card, fmtDate } from "@/lib/admin-shared";
import { Plus, Loader2, X, Save, Trash2, Pencil, Ruler } from "lucide-react";

export const Route = createFileRoute("/admin/oversize-rules")({ component: OversizeRulesPage });

type FormState = {
  id?: string;
  name: string;
  shipping_method: string;
  route_id: string;
  max_length_cm: string;
  max_width_cm: string;
  max_height_cm: string;
  max_single_side_cm: string;
  max_weight_kg: string;
  max_volume_m3: string;
  max_girth_cm: string;
  is_active: boolean;
  notes: string;
};

const EMPTY: FormState = {
  name: "", shipping_method: "", route_id: "",
  max_length_cm: "", max_width_cm: "", max_height_cm: "",
  max_single_side_cm: "", max_weight_kg: "", max_volume_m3: "", max_girth_cm: "",
  is_active: true, notes: "",
};

const METHODS = ["air", "sea", "express", "truck"];

function OversizeRulesPage() {
  const qc = useQueryClient();
  const fetchRoles = useServerFn(getMyRoles);
  const fetchList = useServerFn(listOversizeRules);
  const fetchRoutes = useServerFn(listRoutes);
  const upsert = useServerFn(upsertOversizeRule);
  const del = useServerFn(deleteOversizeRule);

  const meQ = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles(), staleTime: 60_000 });
  const q = useQuery({ queryKey: ["oversize-rules"], queryFn: () => fetchList() });
  const routesQ = useQuery({ queryKey: ["routes-for-oversize"], queryFn: () => fetchRoutes() });

  const canEdit = (meQ.data?.roles ?? []).some(r => r === "owner" || r === "manager");

  const [editing, setEditing] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const openNew = () => { setErr(null); setEditing({ ...EMPTY }); };
  const openEdit = (r: OversizeRule) => {
    setErr(null);
    setEditing({
      id: r.id, name: r.name,
      shipping_method: r.shipping_method ?? "",
      route_id: r.route_id ?? "",
      max_length_cm: r.max_length_cm?.toString() ?? "",
      max_width_cm: r.max_width_cm?.toString() ?? "",
      max_height_cm: r.max_height_cm?.toString() ?? "",
      max_single_side_cm: r.max_single_side_cm?.toString() ?? "",
      max_weight_kg: r.max_weight_kg?.toString() ?? "",
      max_volume_m3: r.max_volume_m3?.toString() ?? "",
      max_girth_cm: r.max_girth_cm?.toString() ?? "",
      is_active: r.is_active, notes: r.notes ?? "",
    });
  };

  const onSave = async () => {
    if (!editing) return;
    if (!editing.name.trim()) { setErr("请填写规则名称"); return; }
    setBusy(true); setErr(null);
    try {
      await upsert({ data: {
        id: editing.id,
        payload: {
          name: editing.name.trim(),
          shipping_method: editing.shipping_method || null,
          route_id: editing.route_id || null,
          max_length_cm: editing.max_length_cm as any,
          max_width_cm: editing.max_width_cm as any,
          max_height_cm: editing.max_height_cm as any,
          max_single_side_cm: editing.max_single_side_cm as any,
          max_weight_kg: editing.max_weight_kg as any,
          max_volume_m3: editing.max_volume_m3 as any,
          max_girth_cm: editing.max_girth_cm as any,
          is_active: editing.is_active,
          notes: editing.notes || null,
        } as any,
      } });
      setEditing(null);
      await qc.invalidateQueries({ queryKey: ["oversize-rules"] });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const onDelete = async (id: string) => {
    if (!confirm("删除该规则？")) return;
    await del({ data: { id } });
    await qc.invalidateQueries({ queryKey: ["oversize-rules"] });
  };

  const routeMap = new Map<string, any>();
  for (const r of (routesQ.data?.routes ?? []) as any[]) routeMap.set(r.id, r);

  return (
    <Page title="超大件规则" subtitle="按线路 / 运输方式 / 通用 三级配置阈值；任一阈值越界即判定为超大件"
      action={canEdit && (
        <button onClick={openNew} className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90">
          <Plus className="h-4 w-4"/>新建规则
        </button>
      )}>
      <Card>
        {q.isLoading && <div className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500"/></div>}
        {q.isError && <div className="p-4 text-rose-400 text-sm">{(q.error as Error).message}</div>}
        {q.data && (
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase text-slate-500">
              <tr>
                <th className="py-2">规则名</th>
                <th>适用范围</th>
                <th>长 × 宽 × 高 (cm)</th>
                <th>单边 / 周长 (cm)</th>
                <th>重量 (kg)</th>
                <th>体积 (m³)</th>
                <th>启用</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {q.data.rules.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-slate-500">暂无规则 · 点击右上"新建规则"</td></tr>
              )}
              {q.data.rules.map((r) => {
                const route = r.route_id ? routeMap.get(r.route_id) : null;
                const scope = route ? `线路：${route.code}` : r.shipping_method ? `方式：${r.shipping_method}` : "通用";
                return (
                  <tr key={r.id} className={r.is_active ? "" : "opacity-50"}>
                    <td className="py-2.5">
                      <div className="text-xs font-semibold text-slate-100">{r.name}</div>
                      {r.notes && <div className="mt-0.5 text-[10px] text-slate-500">{r.notes}</div>}
                    </td>
                    <td className="text-xs text-slate-300">{scope}</td>
                    <td className="text-xs font-mono text-slate-300">{r.max_length_cm ?? "—"} × {r.max_width_cm ?? "—"} × {r.max_height_cm ?? "—"}</td>
                    <td className="text-xs font-mono text-slate-300">{r.max_single_side_cm ?? "—"} / {r.max_girth_cm ?? "—"}</td>
                    <td className="text-xs font-mono text-slate-300">{r.max_weight_kg ?? "—"}</td>
                    <td className="text-xs font-mono text-slate-300">{r.max_volume_m3 ?? "—"}</td>
                    <td className="text-xs">{r.is_active ? <span className="text-emerald-300">是</span> : <span className="text-slate-500">否</span>}</td>
                    <td className="text-right text-xs text-slate-500">
                      {canEdit && (
                        <div className="inline-flex gap-1">
                          <button onClick={() => openEdit(r)} className="rounded p-1 text-slate-400 hover:bg-white/10"><Pencil className="h-3 w-3"/></button>
                          <button onClick={() => onDelete(r.id)} className="rounded p-1 text-rose-400 hover:bg-rose-500/10"><Trash2 className="h-3 w-3"/></button>
                        </div>
                      )}
                      <div className="mt-0.5 text-[10px]">{fmtDate(r.created_at)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setEditing(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="inline-flex items-center gap-2 font-display text-lg font-bold"><Ruler className="h-4 w-4 text-brand"/>{editing.id ? "编辑超大件规则" : "新建超大件规则"}</h2>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-white"><X className="h-4 w-4"/></button>
            </div>
            <div className="space-y-3">
              <FormRow label="规则名 *">
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
                  placeholder="例：空运标准超大件"/>
              </FormRow>
              <div className="grid gap-3 sm:grid-cols-2">
                <FormRow label="运输方式（可空 = 不限）">
                  <select value={editing.shipping_method} onChange={(e) => setEditing({ ...editing, shipping_method: e.target.value })}
                    className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
                    <option value="">— 不限 —</option>
                    {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </FormRow>
                <FormRow label="线路（可空 = 该方式通用 / 全局）">
                  <select value={editing.route_id} onChange={(e) => setEditing({ ...editing, route_id: e.target.value })}
                    className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
                    <option value="">— 不限 —</option>
                    {(routesQ.data?.routes ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.code} · {r.name_zh}</option>)}
                  </select>
                </FormRow>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <NumField label="最长 (cm)" v={editing.max_length_cm} on={(v) => setEditing({ ...editing, max_length_cm: v })}/>
                <NumField label="最宽 (cm)" v={editing.max_width_cm} on={(v) => setEditing({ ...editing, max_width_cm: v })}/>
                <NumField label="最高 (cm)" v={editing.max_height_cm} on={(v) => setEditing({ ...editing, max_height_cm: v })}/>
                <NumField label="单边最大 (cm)" v={editing.max_single_side_cm} on={(v) => setEditing({ ...editing, max_single_side_cm: v })}/>
                <NumField label="周长 L+2(W+H) (cm)" v={editing.max_girth_cm} on={(v) => setEditing({ ...editing, max_girth_cm: v })}/>
                <NumField label="最大重量 (kg)" v={editing.max_weight_kg} on={(v) => setEditing({ ...editing, max_weight_kg: v })}/>
                <NumField label="最大体积 (m³)" v={editing.max_volume_m3} on={(v) => setEditing({ ...editing, max_volume_m3: v })}/>
              </div>
              <FormRow label="备注">
                <textarea rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                  className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
              </FormRow>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={editing.is_active} onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}/>
                启用
              </label>
              {err && <div className="text-xs text-rose-400">{err}</div>}
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setEditing(null)} className="rounded-md border border-white/10 px-3 py-1.5 text-xs">取消</button>
                <button onClick={onSave} disabled={busy}
                  className="inline-flex items-center gap-1 rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                  {busy ? <Loader2 className="h-3 w-3 animate-spin"/> : <Save className="h-3 w-3"/>}保存
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">{label}</div>{children}</div>;
}

function NumField({ label, v, on }: { label: string; v: string; on: (s: string) => void }) {
  return (
    <FormRow label={label}>
      <input type="number" step="any" value={v} onChange={(e) => on(e.target.value)}
        placeholder="—"
        className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
    </FormRow>
  );
}
