import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listCategories, saveCategory, deleteCategory } from "@/lib/shop.functions";
import { Tag, Loader2, Plus, Save, Trash2 } from "lucide-react";

export const Route = createFileRoute("/admin/shop/categories")({ component: CategoriesPage });

function CategoriesPage() {
  const fetchList = useServerFn(listCategories);
  const save = useServerFn(saveCategory);
  const del = useServerFn(deleteCategory);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["shop-cats"], queryFn: () => fetchList() });
  const [form, setForm] = useState<any>({ name: "", slug: "", sort_order: 0, is_active: true });
  const [editing, setEditing] = useState<any>(null);

  const onSave = async () => {
    await save({ data: editing ?? form });
    setEditing(null);
    setForm({ name: "", slug: "", sort_order: 0, is_active: true });
    qc.invalidateQueries({ queryKey: ["shop-cats"] });
  };
  const onDelete = async (id: string) => {
    if (!confirm("确认删除该分类？")) return;
    await del({ data: { id } });
    qc.invalidateQueries({ queryKey: ["shop-cats"] });
  };

  return (
    <div className="mx-auto max-w-5xl p-6">
      <h1 className="mb-5 font-display text-2xl font-bold inline-flex items-center gap-2"><Tag className="h-5 w-5 text-blue-400"/>商品分类</h1>

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02]">
          {q.isLoading ? <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-slate-500"/></div> : (
            <table className="w-full text-sm">
              <thead className="border-b border-white/5 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="p-3">名称</th><th className="p-3">Slug</th><th className="p-3 text-right">排序</th><th className="p-3">状态</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(q.data?.items ?? []).map((c: any) => (
                  <tr key={c.id} className="hover:bg-white/5">
                    <td className="p-3">{c.name}</td>
                    <td className="p-3 font-mono text-xs text-slate-400">{c.slug}</td>
                    <td className="p-3 text-right">{c.sort_order}</td>
                    <td className="p-3">{c.is_active ? <span className="text-emerald-300">启用</span> : <span className="text-slate-500">停用</span>}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => setEditing({ ...c })} className="mr-2 text-xs text-brand hover:underline">编辑</button>
                      <button onClick={() => onDelete(c.id)} className="text-rose-400 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5"/></button>
                    </td>
                  </tr>
                ))}
                {(q.data?.items ?? []).length === 0 && <tr><td colSpan={5} className="p-6 text-center text-slate-500">尚无分类</td></tr>}
              </tbody>
            </table>
          )}
        </div>

        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-bold">{editing ? "编辑分类" : "新增分类"}</div>
            {editing && <button onClick={() => setEditing(null)} className="text-xs text-slate-400 hover:text-white">取消</button>}
          </div>
          <div className="space-y-3">
            <Field label="名称"><Input value={(editing ?? form).name} onChange={v => editing ? setEditing({ ...editing, name: v }) : setForm({ ...form, name: v })}/></Field>
            <Field label="英文名"><Input value={(editing ?? form).name_en ?? ""} onChange={v => editing ? setEditing({ ...editing, name_en: v }) : setForm({ ...form, name_en: v })}/></Field>
            <Field label="Slug"><Input value={(editing ?? form).slug} onChange={v => editing ? setEditing({ ...editing, slug: v }) : setForm({ ...form, slug: v })}/></Field>
            <Field label="排序"><Input type="number" value={String((editing ?? form).sort_order ?? 0)} onChange={v => editing ? setEditing({ ...editing, sort_order: Number(v) || 0 }) : setForm({ ...form, sort_order: Number(v) || 0 })}/></Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={(editing ?? form).is_active}
                onChange={e => editing ? setEditing({ ...editing, is_active: e.target.checked }) : setForm({ ...form, is_active: e.target.checked })}/>
              启用
            </label>
            <button onClick={onSave} className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90">
              {editing ? <Save className="h-3.5 w-3.5"/> : <Plus className="h-3.5 w-3.5"/>}{editing ? "保存" : "新增"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: any) {
  return <div><div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">{label}</div>{children}</div>;
}
function Input({ value, onChange, type = "text" }: { value: string; onChange: (v: string) => void; type?: string }) {
  return <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
    className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"/>;
}
