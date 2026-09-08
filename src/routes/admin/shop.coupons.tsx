import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listCoupons, saveCoupon, deleteCoupon } from "@/lib/shop.functions";
import { Tag, Plus, Save, Trash2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/shop/coupons")({ component: CouponsPage });

function CouponsPage() {
  const fetchList = useServerFn(listCoupons);
  const save = useServerFn(saveCoupon);
  const del = useServerFn(deleteCoupon);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["coupons"], queryFn: () => fetchList() });
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ code: "", type: "fixed", value: 0, min_order_cny: 0, is_active: true });

  const onSave = async () => {
    await save({ data: editing ?? form });
    setEditing(null); setForm({ code: "", type: "fixed", value: 0, min_order_cny: 0, is_active: true });
    qc.invalidateQueries({ queryKey: ["coupons"] });
  };
  const onDel = async (id: string) => { if (confirm("确认删除？")) { await del({ data: { id } }); qc.invalidateQueries({ queryKey: ["coupons"] }); } };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-5 font-display text-2xl font-bold inline-flex items-center gap-2"><Tag className="h-5 w-5 text-blue-400"/>优惠券</h1>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02]">
          {q.isLoading ? <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin"/></div> : (
            <table className="w-full text-sm">
              <thead className="border-b border-white/5 text-left text-[10px] uppercase tracking-wider text-slate-500">
                <tr><th className="p-3">码</th><th className="p-3">类型</th><th className="p-3 text-right">面值</th><th className="p-3 text-right">门槛</th><th className="p-3 text-right">已用/上限</th><th className="p-3">状态</th><th></th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {(q.data?.items ?? []).map((c: any) => (
                  <tr key={c.id} className="hover:bg-white/5">
                    <td className="p-3 font-mono text-xs">{c.code}</td>
                    <td className="p-3 text-xs">{c.type === "fixed" ? "固定金额" : "百分比"}</td>
                    <td className="p-3 text-right">{c.type === "fixed" ? `¥${c.value}` : `${c.value}%`}</td>
                    <td className="p-3 text-right">¥{c.min_order_cny}</td>
                    <td className="p-3 text-right text-xs">{c.used_count} / {c.usage_limit ?? "∞"}</td>
                    <td className="p-3">{c.is_active ? <span className="text-emerald-300">启用</span> : <span className="text-slate-500">停用</span>}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => setEditing({ ...c })} className="mr-2 text-xs text-brand hover:underline">编辑</button>
                      <button onClick={() => onDel(c.id)} className="text-rose-400"><Trash2 className="h-3.5 w-3.5"/></button>
                    </td>
                  </tr>
                ))}
                {(q.data?.items ?? []).length === 0 && <tr><td colSpan={7} className="p-6 text-center text-slate-500">暂无优惠券</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-bold">{editing ? "编辑" : "新增"}</div>
            {editing && <button onClick={() => setEditing(null)} className="text-xs text-slate-400">取消</button>}
          </div>
          <div className="space-y-3">
            <F label="优惠码"><I value={(editing ?? form).code} onChange={v => editing ? setEditing({ ...editing, code: v }) : setForm({ ...form, code: v })}/></F>
            <F label="名称"><I value={(editing ?? form).name ?? ""} onChange={v => editing ? setEditing({ ...editing, name: v }) : setForm({ ...form, name: v })}/></F>
            <F label="类型">
              <select value={(editing ?? form).type} onChange={e => editing ? setEditing({ ...editing, type: e.target.value }) : setForm({ ...form, type: e.target.value })}
                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm [&>option]:bg-[#0E1626]">
                <option value="fixed">固定金额</option><option value="percent">百分比</option>
              </select>
            </F>
            <F label="面值"><I type="number" value={String((editing ?? form).value ?? 0)} onChange={v => editing ? setEditing({ ...editing, value: Number(v) || 0 }) : setForm({ ...form, value: Number(v) || 0 })}/></F>
            <F label="最低消费 CNY"><I type="number" value={String((editing ?? form).min_order_cny ?? 0)} onChange={v => editing ? setEditing({ ...editing, min_order_cny: Number(v) || 0 }) : setForm({ ...form, min_order_cny: Number(v) || 0 })}/></F>
            <F label="使用次数上限"><I type="number" value={String((editing ?? form).usage_limit ?? "")} onChange={v => editing ? setEditing({ ...editing, usage_limit: v ? Number(v) : null }) : setForm({ ...form, usage_limit: v ? Number(v) : null })}/></F>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={(editing ?? form).is_active} onChange={e => editing ? setEditing({ ...editing, is_active: e.target.checked }) : setForm({ ...form, is_active: e.target.checked })}/>启用
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
function F({ label, children }: any) { return <div><div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">{label}</div>{children}</div>; }
function I({ value, onChange, type = "text" }: { value: string; onChange: (v: string) => void; type?: string }) { return <input type={type} value={value} onChange={e => onChange(e.target.value)} className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"/>; }
