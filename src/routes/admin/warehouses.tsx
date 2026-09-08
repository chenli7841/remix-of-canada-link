import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  listWarehouses, upsertWarehouse, deleteWarehouse, type Warehouse,
} from "@/lib/settings.functions";
import { getMyRoles } from "@/lib/admin.functions";
import { Loader2, Plus, Pencil, Trash2, Warehouse as WarehouseIcon, X } from "lucide-react";

export const Route = createFileRoute("/admin/warehouses")({
  component: WarehousesPage,
});

const COUNTRY_OPTIONS = [
  { v: "CN", label: "中国" }, { v: "CA", label: "加拿大" },
  { v: "US", label: "美国" }, { v: "OTHER", label: "其他" },
];
function roleLabel(w: Warehouse): string {
  const r: string[] = [];
  if (w.can_origin) r.push("起点");
  if (w.can_destination) r.push("终点");
  if (w.can_inventory) r.push("库存");
  return r.length ? r.join(" / ") : "—";
}


function WarehousesPage() {
  const fetchList = useServerFn(listWarehouses);
  const fetchRoles = useServerFn(getMyRoles);
  const q = useQuery({ queryKey: ["admin-warehouses"], queryFn: () => fetchList() });
  const meQ = useQuery({ queryKey: ["my-roles"], queryFn: () => fetchRoles(), staleTime: 60_000 });
  const canEdit = (meQ.data?.roles ?? []).some((r) => r === "owner" || r === "manager");

  const [editing, setEditing] = useState<Partial<Warehouse> | null>(null);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
            <WarehouseIcon className="h-5 w-5 text-emerald-400" />仓库管理
          </h1>
          <p className="mt-1 text-sm text-slate-400">{q.data ? `共 ${q.data.warehouses.length} 个仓库` : "加载中…"}</p>
        </div>
        {canEdit && (
          <button
            onClick={() => setEditing({ country: "CN", can_origin: true, can_destination: false, can_inventory: true, is_active: true, sort_order: 0 })}
            className="inline-flex items-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90"
          >
            <Plus className="h-4 w-4" />新增仓库
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-[11px] uppercase tracking-wider text-slate-400">
            <tr>
              <th className="px-4 py-2.5">编码</th>
              <th className="px-4 py-2.5">名称</th>
              <th className="px-4 py-2.5">国家</th>
              <th className="px-4 py-2.5">角色</th>
              <th className="px-4 py-2.5">联系人</th>
              <th className="px-4 py-2.5">状态</th>
              <th className="px-4 py-2.5">排序</th>
              <th className="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {q.isLoading && (<tr><td colSpan={8} className="px-4 py-12 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-500" /></td></tr>)}
            {q.isError && (<tr><td colSpan={8} className="px-4 py-12 text-center text-rose-400">{(q.error as Error).message}</td></tr>)}
            {q.data?.warehouses.length === 0 && (<tr><td colSpan={8} className="px-4 py-12 text-center text-slate-500">暂无仓库</td></tr>)}
            {q.data?.warehouses.map((w) => (
              <tr key={w.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-3 font-mono text-xs">{w.code}</td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-100">{w.name_zh}</div>
                  {w.name_en && <div className="text-xs text-slate-500">{w.name_en}</div>}
                </td>
                <td className="px-4 py-3 text-xs">{COUNTRY_OPTIONS.find((c) => c.v === w.country)?.label ?? w.country}</td>
                <td className="px-4 py-3 text-xs">{roleLabel(w)}</td>
                <td className="px-4 py-3 text-xs text-slate-400">
                  {w.contact ?? "—"}{w.phone ? ` · ${w.phone}` : ""}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${w.is_active ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-slate-500/30 bg-slate-500/10 text-slate-400"}`}>
                    {w.is_active ? "启用" : "停用"}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-slate-400">{w.sort_order}</td>
                <td className="px-4 py-3 text-right">
                  {canEdit ? (
                    <button onClick={() => setEditing(w)} className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs hover:bg-white/5">
                      <Pencil className="h-3 w-3" />编辑
                    </button>
                  ) : <span className="text-xs text-slate-600">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && canEdit && (
        <WarehouseEditor
          initial={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function WarehouseEditor({ initial, onClose }: { initial: Partial<Warehouse>; onClose: () => void }) {
  const qc = useQueryClient();
  const save = useServerFn(upsertWarehouse);
  const del = useServerFn(deleteWarehouse);

  const [form, setForm] = useState<Partial<Warehouse>>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof Warehouse, v: any) => setForm((p) => ({ ...p, [k]: v }));

  const onSave = async () => {
    setBusy(true); setErr(null);
    try {
      if (!form.code || !form.name_zh) throw new Error("编码与中文名为必填");
      await save({
        data: {
          id: form.id,
          payload: {
            code: form.code!, name_zh: form.name_zh!, name_en: form.name_en ?? null,
            country: (form.country ?? "CN") as any, type: (form.type ?? null) as any,
            can_origin: !!form.can_origin, can_destination: !!form.can_destination,
            can_inventory: form.can_inventory ?? true,
            storage_fee_cad_per_cbm_day: Number(form.storage_fee_cad_per_cbm_day ?? 0),
            storage_free_days: Number(form.storage_free_days ?? 0),
            inout_fee_cad_per_cbm: Number(form.inout_fee_cad_per_cbm ?? 0),
            address: form.address ?? null, contact: form.contact ?? null, phone: form.phone ?? null,
            is_active: form.is_active ?? true, sort_order: Number(form.sort_order ?? 0),
            note: form.note ?? null,
          },
        },

      });
      await qc.invalidateQueries({ queryKey: ["admin-warehouses"] });
      onClose();
    } catch (e: any) { setErr(e?.message ?? "保存失败"); }
    finally { setBusy(false); }
  };

  const onDelete = async () => {
    if (!form.id) return;
    if (!confirm(`确定删除仓库「${form.name_zh}」？关联线路不会被删除，但会失去对应仓库。`)) return;
    setBusy(true); setErr(null);
    try {
      await del({ data: { id: form.id } });
      await qc.invalidateQueries({ queryKey: ["admin-warehouses"] });
      onClose();
    } catch (e: any) { setErr(e?.message ?? "删除失败"); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0E1626] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">{form.id ? "编辑仓库" : "新增仓库"}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-white/5"><X className="h-4 w-4" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Field label="编码 *"><Input value={form.code ?? ""} onChange={(v) => set("code", v.toUpperCase())} placeholder="CN-GZ" /></Field>
          <Field label="排序"><Input type="number" value={String(form.sort_order ?? 0)} onChange={(v) => set("sort_order", Number(v))} /></Field>
          <Field label="中文名 *"><Input value={form.name_zh ?? ""} onChange={(v) => set("name_zh", v)} placeholder="广州仓" /></Field>
          <Field label="英文名"><Input value={form.name_en ?? ""} onChange={(v) => set("name_en", v)} placeholder="Guangzhou Warehouse" /></Field>
          <Field label="国家">
            <Select value={form.country ?? "CN"} onChange={(v) => set("country", v)} options={COUNTRY_OPTIONS} />
          </Field>
          <Field label="角色（可多选）" full>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!form.can_origin} onChange={(e) => set("can_origin", e.target.checked)} className="h-4 w-4 accent-brand" />作为起始仓（发货）</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={!!form.can_destination} onChange={(e) => set("can_destination", e.target.checked)} className="h-4 w-4 accent-brand" />作为终点仓（到货）</label>
              <label className="inline-flex items-center gap-2"><input type="checkbox" checked={form.can_inventory !== false} onChange={(e) => set("can_inventory", e.target.checked)} className="h-4 w-4 accent-brand" />作为库存仓</label>
            </div>
          </Field>

          <Field label="联系人"><Input value={form.contact ?? ""} onChange={(v) => set("contact", v)} /></Field>
          <Field label="电话"><Input value={form.phone ?? ""} onChange={(v) => set("phone", v)} /></Field>
          <Field label="地址" full><Input value={form.address ?? ""} onChange={(v) => set("address", v)} /></Field>
          <Field label="仓储费 CA$/天/cbm">
            <Input type="number" value={String(form.storage_fee_cad_per_cbm_day ?? 0)} onChange={(v) => set("storage_fee_cad_per_cbm_day", Number(v))} />
          </Field>
          <Field label="免费仓储天数（之后开始计费）">
            <Input type="number" value={String(form.storage_free_days ?? 0)} onChange={(v) => set("storage_free_days", Number(v))} />
          </Field>
          <Field label="进出库费 CA$/cbm">
            <Input type="number" value={String(form.inout_fee_cad_per_cbm ?? 0)} onChange={(v) => set("inout_fee_cad_per_cbm", Number(v))} />
          </Field>
          <Field label="备注" full><Input value={form.note ?? ""} onChange={(v) => set("note", v)} /></Field>
          <Field label="状态" full>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!form.is_active} onChange={(e) => set("is_active", e.target.checked)} className="h-4 w-4 accent-brand" />
              <span>启用</span>
            </label>
          </Field>
        </div>

        {err && <div className="mt-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{err}</div>}

        <div className="mt-5 flex items-center justify-between">
          <div>
            {form.id && (
              <button onClick={onDelete} disabled={busy}
                className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 px-3 py-2 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50">
                <Trash2 className="h-3.5 w-3.5" />删除
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-md border border-white/10 px-3 py-2 text-sm text-slate-200 hover:bg-white/5">取消</button>
            <button onClick={onSave} disabled={busy}
              className="inline-flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      {children}
    </div>
  );
}
function Input(props: { value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return (
    <input
      type={props.type ?? "text"}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm placeholder:text-slate-500 focus:border-brand focus:outline-none"
    />
  );
}
function Select(props: { value: string; onChange: (v: string) => void; options: { v: string; label: string }[] }) {
  return (
    <select value={props.value} onChange={(e) => props.onChange(e.target.value)}
      className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-100 focus:border-brand focus:outline-none [&>option]:bg-[#0E1626] [&>option]:text-slate-100">
      {props.options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}
