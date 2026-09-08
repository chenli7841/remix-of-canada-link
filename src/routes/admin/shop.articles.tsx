import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { listArticles, saveArticle, deleteArticle } from "@/lib/shop.functions";
import { FileText, Plus, Save, Trash2, Loader2 } from "lucide-react";

export const Route = createFileRoute("/admin/shop/articles")({ component: ArticlesPage });

function ArticlesPage() {
  const fetchList = useServerFn(listArticles);
  const save = useServerFn(saveArticle);
  const del = useServerFn(deleteArticle);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["articles"], queryFn: () => fetchList() });
  const [editing, setEditing] = useState<any>(null);
  const empty = { title: "", slug: "", excerpt: "", content_md: "", cover_url: "", status: "draft" };
  const [form, setForm] = useState<any>(empty);

  const cur = editing ?? form;
  const setCur = (patch: any) => editing ? setEditing({ ...editing, ...patch }) : setForm({ ...form, ...patch });

  const onSave = async () => {
    await save({ data: cur });
    setEditing(null); setForm(empty);
    qc.invalidateQueries({ queryKey: ["articles"] });
  };
  const onDel = async (id: string) => { if (confirm("删除？")) { await del({ data: { id } }); qc.invalidateQueries({ queryKey: ["articles"] }); } };

  return (
    <div className="mx-auto max-w-6xl p-6">
      <h1 className="mb-5 font-display text-2xl font-bold inline-flex items-center gap-2"><FileText className="h-5 w-5 text-blue-400"/>文章管理</h1>
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02]">
          {q.isLoading ? <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin"/></div> : (
            <div className="divide-y divide-white/5">
              {(q.data?.items ?? []).map((a: any) => (
                <div key={a.id} className="flex items-center gap-3 p-3 hover:bg-white/5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{a.title}</div>
                    <div className="text-[10px] text-slate-500">{a.slug} · {a.status} {a.published_at && `· ${new Date(a.published_at).toLocaleDateString()}`}</div>
                  </div>
                  <button onClick={() => setEditing({ ...a })} className="text-xs text-brand hover:underline">编辑</button>
                  <button onClick={() => onDel(a.id)} className="text-rose-400"><Trash2 className="h-3.5 w-3.5"/></button>
                </div>
              ))}
              {(q.data?.items ?? []).length === 0 && <div className="p-6 text-center text-sm text-slate-500">尚无文章</div>}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-bold">{editing ? "编辑文章" : "新增文章"}</div>
            {editing && <button onClick={() => setEditing(null)} className="text-xs text-slate-400">取消</button>}
          </div>
          <div className="space-y-3">
            <F label="标题"><I value={cur.title} onChange={v => setCur({ title: v })}/></F>
            <F label="Slug"><I value={cur.slug} onChange={v => setCur({ slug: v })}/></F>
            <F label="封面 URL"><I value={cur.cover_url ?? ""} onChange={v => setCur({ cover_url: v })}/></F>
            <F label="摘要">
              <textarea value={cur.excerpt ?? ""} onChange={e => setCur({ excerpt: e.target.value })} rows={2}
                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"/>
            </F>
            <F label="正文 (Markdown)">
              <textarea value={cur.content_md ?? ""} onChange={e => setCur({ content_md: e.target.value })} rows={8}
                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs focus:border-brand focus:outline-none"/>
            </F>
            <F label="状态">
              <select value={cur.status} onChange={e => setCur({ status: e.target.value })}
                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm [&>option]:bg-[#0E1626]">
                <option value="draft">草稿</option><option value="published">已发布</option><option value="archived">归档</option>
              </select>
            </F>
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
