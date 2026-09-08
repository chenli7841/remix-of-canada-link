import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listBanners, saveBanner, deleteBanner } from "@/lib/shop.functions";
import { Image as ImageIcon, Plus, Save, Trash2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/shop/banners")({ component: BannersPage });

function BannersPage() {
  const fetchList = useServerFn(listBanners);
  const save = useServerFn(saveBanner);
  const del = useServerFn(deleteBanner);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["banners"], queryFn: () => fetchList() });
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>({ title: "", image_url: "", link_url: "", position: "home_top", sort_order: 0, is_active: true });

  const onSave = async () => {
    await save({ data: editing ?? form });
    setEditing(null); setForm({ title: "", image_url: "", link_url: "", position: "home_top", sort_order: 0, is_active: true });
    qc.invalidateQueries({ queryKey: ["banners"] });
  };
  const onDel = async (id: string) => { if (confirm("删除？")) { await del({ data: { id } }); qc.invalidateQueries({ queryKey: ["banners"] }); } };

  const cur = editing ?? form;
  const setCur = (patch: any) => editing ? setEditing({ ...editing, ...patch }) : setForm({ ...form, ...patch });

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-5 font-display text-2xl font-bold inline-flex items-center gap-2"><ImageIcon className="h-5 w-5 text-blue-400"/>首页 Banner 装修</h1>
      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02]">
          {q.isLoading ? <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin"/></div> : (
            <div className="divide-y divide-white/5">
              {(q.data?.items ?? []).map((b: any) => (
                <div key={b.id} className="flex items-center gap-3 p-3 hover:bg-white/5">
                  <div className="h-12 w-20 shrink-0 overflow-hidden rounded bg-white/5">
                    {b.image_url && <img src={b.image_url} alt={b.title} className="h-full w-full object-cover"/>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{b.title}</div>
                    <div className="text-[10px] text-slate-500">{b.position} · 排序 {b.sort_order}</div>
                  </div>
                  <div className="text-xs">{b.is_active ? <span className="text-emerald-300">启用</span> : <span className="text-slate-500">停用</span>}</div>
                  <button onClick={() => setEditing({ ...b })} className="text-xs text-brand hover:underline">编辑</button>
                  <button onClick={() => onDel(b.id)} className="text-rose-400"><Trash2 className="h-3.5 w-3.5"/></button>
                </div>
              ))}
              {(q.data?.items ?? []).length === 0 && <div className="p-6 text-center text-sm text-slate-500">尚无 Banner</div>}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-bold">{editing ? "编辑" : "新增"}</div>
            {editing && <button onClick={() => setEditing(null)} className="text-xs text-slate-400">取消</button>}
          </div>
          <div className="space-y-3">
            <F label="标题"><I value={cur.title} onChange={v => setCur({ title: v })}/></F>
            <F label="图片 URL"><I value={cur.image_url} onChange={v => setCur({ image_url: v })}/></F>
            <F label="链接"><I value={cur.link_url ?? ""} onChange={v => setCur({ link_url: v })}/></F>
            <F label="位置">
              <select value={cur.position} onChange={e => setCur({ position: e.target.value })}
                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm [&>option]:bg-[#0E1626]">
                <option value="home_top">首页顶部</option><option value="home_mid">首页中部</option><option value="home_bottom">首页底部</option>
              </select>
            </F>
            <F label="排序"><I type="number" value={String(cur.sort_order ?? 0)} onChange={v => setCur({ sort_order: Number(v) || 0 })}/></F>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={cur.is_active} onChange={e => setCur({ is_active: e.target.checked })}/>启用
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
