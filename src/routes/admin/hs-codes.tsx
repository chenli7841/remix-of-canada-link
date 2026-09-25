import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { listHsCodes, upsertHsCode, deleteHsCode } from "@/lib/hs-codes.functions";
import { HsCodeInput } from "@/components/HsCodeInput";
import { BookText, Loader2, Plus, Save, Trash2, Search, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";

const PAGE_SIZE = 50;

export const Route = createFileRoute("/admin/hs-codes")({ component: HsCodesPage });

const EMPTY: any = {
  hs_code: "", chapter: "", name_zh: "", name_en: "", unit: "",
  mfn_rate: 0, gst_rate: 0.05, anti_dumping_rate: 0,
  anti_dumping_note: "", note: "", material: "", origin: "China",
  aliases: [], sima_involved: false, is_active: true,
};



function HsCodesPage() {
  const fetchList = useServerFn(listHsCodes);
  const save = useServerFn(upsertHsCode);
  const del = useServerFn(deleteHsCode);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["hs-codes", debounced, page],
    queryFn: () => fetchList({ data: { search: debounced || undefined, page, pageSize: PAGE_SIZE } }),
  });
  const total = q.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // 搜索词变了就回到第 1 页——否则停在旧页码上，搜索结果可能刚好被"翻页"藏起来，看着像 0 条
  useEffect(() => {
    setPage(1);
  }, [debounced]);

  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(EMPTY);

  // 支持 ?prefill=<品名> — 自动预填品名 + 别名，方便从运单/批次页跳来快速新增
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search).get("prefill");
    if (p && !form.name_zh) {
      setForm((f: any) => ({ ...f, name_zh: p, aliases: [p] }));
      setSearch(p); setDebounced(p);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [msg, setMsg] = useState<string | null>(null);

  const current = editing ?? form;
  const update = (k: string, v: any) => editing ? setEditing({ ...editing, [k]: v }) : setForm({ ...form, [k]: v });

  const onSave = async () => {
    setMsg(null);
    try {
      await save({ data: current });
      setMsg("✓ 已保存");
      setEditing(null); setForm(EMPTY);
      qc.invalidateQueries({ queryKey: ["hs-codes"] });
    } catch (e: any) { setMsg("✗ " + e.message); }
  };
  const onDelete = async (id: string) => {
    if (!confirm("确认删除该 HS 编码？")) return;
    await del({ data: { id } });
    qc.invalidateQueries({ queryKey: ["hs-codes"] });
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold inline-flex items-center gap-2">
          <BookText className="h-5 w-5 text-blue-400" />HS 编码库
        </h1>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <a href="https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2025/menu-eng.html" target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 hover:text-white"><ExternalLink className="h-3 w-3"/>Customs Tariff T2025</a>
          <a href="https://www.cbsa-asfc.gc.ca/sima-lmsi/mif-mev/menu-eng.html" target="_blank" rel="noreferrer"
             className="inline-flex items-center gap-1 hover:text-white"><ExternalLink className="h-3 w-3"/>Measures in Force</a>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="rounded-2xl border border-white/5 bg-white/[0.02]">
          <div className="flex items-center gap-2 border-b border-white/5 p-3">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); clearTimeout((window as any).__hs); (window as any).__hs = setTimeout(() => setDebounced(e.target.value), 300); }}
              placeholder="搜索 HS 编码 / 品名…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
            />
            <span className="text-xs text-slate-500">共 {total} 条</span>
          </div>
          {q.isLoading ? (
            <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-slate-500"/></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-white/5 text-left text-[10px] uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="p-3">HS 编码</th>
                    <th className="p-3">章节</th>
                    <th className="p-3">品名 / 别名</th>
                    <th className="p-3 text-right">MFN</th>
                    <th className="p-3 text-right">GST</th>
                    <th className="p-3 text-center">SIMA</th>
                    <th className="p-3">状态</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {(q.data?.items ?? []).map((c: any) => (
                    <tr key={c.id} className="hover:bg-white/5 align-top">
                      <td className="p-3 font-mono text-xs">{c.hs_code}</td>
                      <td className="p-3 text-slate-400">{c.chapter ?? "-"}</td>
                      <td className="p-3 max-w-md">
                        <div>{c.name_zh}</div>
                        {c.name_en && <div className="text-[11px] text-slate-500">{c.name_en}</div>}
                        <div className="text-[11px] text-slate-500">
                          材质：{c.material || "—"} · 产地：{c.origin || "China"}
                        </div>
                        {Array.isArray(c.aliases) && c.aliases.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {c.aliases.map((a: string, i: number) => (
                              <span key={i} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-300">{a}</span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right">{(Number(c.mfn_rate) * 100).toFixed(2)}%</td>
                      <td className="p-3 text-right">{(Number(c.gst_rate) * 100).toFixed(2)}%</td>
                      <td className="p-3 text-center">
                        {c.sima_involved ? (
                          <span title={c.anti_dumping_note ?? ""} className="inline-flex items-center rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">SIMA</span>
                        ) : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="p-3">{c.is_active ? <span className="text-emerald-300">启用</span> : <span className="text-slate-500">停用</span>}</td>
                      <td className="p-3 text-right whitespace-nowrap">
                        <button onClick={() => setEditing({ ...c, aliases: c.aliases ?? [] })} className="mr-2 text-xs text-brand hover:underline">编辑</button>
                        <button onClick={() => onDelete(c.id)} className="text-rose-400 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5"/></button>
                      </td>
                    </tr>
                  ))}
                  {(q.data?.items ?? []).length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-8 text-center text-slate-500">
                        {debounced ? `未找到匹配"${debounced}"的 HS 编码（该编码可能尚未录入编码库，可点右侧「新增」创建）` : "尚无 HS 编码"}
                      </td>
                    </tr>
                  )}

                </tbody>
              </table>
            </div>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-white/5 p-3 text-xs text-slate-400">
              <span>第 {page} / {totalPages} 页</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 hover:bg-white/5 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />上一页
                </button>
                <input
                  type="number"
                  min={1}
                  max={totalPages}
                  value={page}
                  onChange={(e) => {
                    const v = Math.min(totalPages, Math.max(1, Number(e.target.value) || 1));
                    setPage(v);
                  }}
                  className="w-14 rounded-md border border-white/10 bg-white/5 px-1.5 py-1 text-center"
                />
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 hover:bg-white/5 disabled:opacity-40"
                >
                  下一页<ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="font-bold">{editing ? "编辑 HS 编码" : "新增 HS 编码"}</div>
            {editing && <button onClick={() => { setEditing(null); setMsg(null); }} className="text-xs text-slate-400 hover:text-white">取消</button>}
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="HS 编码 *"><HsCodeInput value={current.hs_code} onChange={v => update("hs_code", v)} /></Field>
              <Field label="章节"><Input value={current.chapter ?? ""} onChange={v => update("chapter", v)} placeholder="01"/></Field>
            </div>
            <Field label="品名（中文）*"><Input value={current.name_zh} onChange={v => update("name_zh", v)}/></Field>
            <Field label="品名（英文）"><Input value={current.name_en ?? ""} onChange={v => update("name_en", v)}/></Field>
            <Field label="计量单位"><Input value={current.unit ?? ""} onChange={v => update("unit", v)} placeholder="KGM / NMB / -"/></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="材质"><Input value={current.material ?? ""} onChange={v => update("material", v)} placeholder="如：塑料 / 纯棉 / 不锈钢"/></Field>
              <Field label="产地"><Input value={current.origin ?? "China"} onChange={v => update("origin", v)} placeholder="China"/></Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="MFN 关税"><RateInput value={current.mfn_rate} onChange={v => update("mfn_rate", v)}/></Field>
              <Field label="GST"><RateInput value={current.gst_rate} onChange={v => update("gst_rate", v)}/></Field>
              <Field label="反倾销"><RateInput value={current.anti_dumping_rate} onChange={v => update("anti_dumping_rate", v)}/></Field>
            </div>
            <Field label="反倾销备注（SIMA / 案号）"><Input value={current.anti_dumping_note ?? ""} onChange={v => update("anti_dumping_note", v)} placeholder="如 SIMA: Mattresses (China)"/></Field>
            <Field label="中文别名（用逗号分隔，便于品名自动匹配）">
              <textarea
                value={(current.aliases ?? []).join("，")}
                onChange={(e) => update("aliases", e.target.value.split(/[,，\s]+/).map(s => s.trim()).filter(Boolean))}
                rows={2}
                placeholder="例如：T恤，纯棉T恤，男士短袖"
                className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"
              />
            </Field>
            <Field label="备注"><Input value={current.note ?? ""} onChange={v => update("note", v)}/></Field>
            <div className="flex items-center gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={current.is_active} onChange={(e) => update("is_active", e.target.checked)}/>
                启用
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!current.sima_involved} onChange={(e) => update("sima_involved", e.target.checked)}/>
                <span className="text-rose-300">涉及 SIMA 反倾销</span>
              </label>
            </div>

            <button onClick={onSave} className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white hover:bg-brand/90">
              {editing ? <Save className="h-3.5 w-3.5"/> : <Plus className="h-3.5 w-3.5"/>}{editing ? "保存" : "新增"}
            </button>
            {msg && <div className={`text-xs ${msg.startsWith("✓") ? "text-emerald-300" : "text-rose-300"}`}>{msg}</div>}
            <p className="text-[11px] text-slate-500">税率以百分比输入，例如 6.5 表示 6.5%。GST 默认 5%。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: any) {
  return <div><div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">{label}</div>{children}</div>;
}
function Input({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
    className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm focus:border-brand focus:outline-none"/>;
}
function RateInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative">
      <input
        type="number" step="0.01" min="0"
        value={Number(((value ?? 0) * 100).toFixed(4))}
        onChange={(e) => onChange((Number(e.target.value) || 0) / 100)}
        className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 pr-6 text-sm focus:border-brand focus:outline-none"/>
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-500">%</span>
    </div>
  );
}
