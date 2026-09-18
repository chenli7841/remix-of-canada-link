import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, useEffect } from "react";
import { measureLookup, measureSaveDims, measureCreatePalletsBatch, getWaybillsLabelData } from "@/lib/scan.functions";
import { renderLabel } from "@/lib/label-render";
import { LabelSizeToggle } from "@/components/admin/LabelSizeToggle";
import { Page } from "@/lib/admin-shared";
import { Ruler, Search, Loader2, Copy, Save, Layers, X, CheckSquare, Square, Plus, Trash2, StickyNote } from "lucide-react";

export const Route = createFileRoute("/admin/measure")({ component: MeasurePage });

type Row = {
  id: string; waybill_no: string; box_no: string | null;
  length_cm: number | null; width_cm: number | null; height_cm: number | null; weight_kg: number | null;
  pallet_id: string | null; pallet_no: string | null;
};

type PalletForm = {
  boxCount: string;
  length_cm: string; width_cm: string; height_cm: string; weight_kg: string;
  self_length_cm: string; self_width_cm: string; self_height_cm: string;
  self_weight_kg: string; self_volume_m3: string;
  notes: string;
};

const emptyPallet = (): PalletForm => ({
  boxCount: "1",
  length_cm: "", width_cm: "", height_cm: "", weight_kg: "",
  self_length_cm: "", self_width_cm: "", self_height_cm: "",
  self_weight_kg: "", self_volume_m3: "",
  notes: "",
});

function MeasurePage() {
  const lookup = useServerFn(measureLookup);
  const save = useServerFn(measureSaveDims);
  const createPallets = useServerFn(measureCreatePalletsBatch);
  const fetchLabels = useServerFn(getWaybillsLabelData);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [parent, setParent] = useState<any>(null);
  const [parentKind, setParentKind] = useState<"order" | "forwarding" | null>(null);
  const [parentNo, setParentNo] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState({ length_cm: "", width_cm: "", height_cm: "", weight_kg: "" });

  const [showPallet, setShowPallet] = useState(false);
  const [palletForms, setPalletForms] = useState<PalletForm[]>([emptyPallet()]);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const onSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const c = code.trim(); if (!c || busy) return;
    setBusy(true); setMsg(null);
    try {
      const r: any = await lookup({ data: { code: c } });
      setParent(r.parent); setParentKind(r.parentKind); setParentNo(r.parentNo);
      setRows(r.waybills as Row[]);
      setSelected(new Set());
      if (!r.waybills?.length) setMsg({ ok: false, text: "该单号下暂无运单" });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
      setParent(null); setRows([]);
    } finally { setBusy(false); }
  };

  const updateRow = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleAll = () => setSelected((s) => s.size === rows.length ? new Set() : new Set(rows.map(r => r.id)));

  const copyDown = (i: number) => {
    if (i >= rows.length - 1) return;
    const src = rows[i];
    updateRow(i + 1, {
      length_cm: src.length_cm, width_cm: src.width_cm,
      height_cm: src.height_cm, weight_kg: src.weight_kg,
    });
  };

  const applyBulk = () => {
    const patch: Partial<Row> = {};
    if (bulk.length_cm !== "") patch.length_cm = Number(bulk.length_cm);
    if (bulk.width_cm !== "") patch.width_cm = Number(bulk.width_cm);
    if (bulk.height_cm !== "") patch.height_cm = Number(bulk.height_cm);
    if (bulk.weight_kg !== "") patch.weight_kg = Number(bulk.weight_kg);
    const targets = selected.size ? selected : new Set(rows.map(r => r.id));
    setRows((rs) => rs.map((r) => targets.has(r.id) ? { ...r, ...patch } : r));
  };

  const onSaveAll = async () => {
    setBusy(true); setMsg(null);
    try {
      const items = rows.map((r) => ({
        id: r.id,
        length_cm: r.length_cm ?? null,
        width_cm: r.width_cm ?? null,
        height_cm: r.height_cm ?? null,
        weight_kg: r.weight_kg ?? null,
      }));
      const r: any = await save({ data: { items } });
      // 保存后自动打印面单
      const ids = rows.map((x) => x.id);
      let printText = "";
      if (ids.length) {
        try {
          const labels: any = await fetchLabels({ data: { waybillIds: ids } });
          renderLabel(labels.items as any);
          printText = `，已打印 ${ids.length} 张面单`;
        } catch (e: any) {
          printText = `，面单打印失败: ${e.message}`;
        }
      }
      setMsg({ ok: true, text: `✓ 已保存 ${r.updated} 条尺寸/重量${printText}，可扫描下一个单号` });
      // Auto-refresh: clear and refocus scan input
      setRows([]); setParent(null); setParentKind(null); setParentNo(null); setSelected(new Set());
      setCode("");
      setTimeout(() => inputRef.current?.focus(), 50);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally { setBusy(false); }
  };

  // Arrow-key navigation between numeric inputs in the rows table; Enter = save all
  const onGridKeyDown = (e: React.KeyboardEvent<HTMLTableSectionElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== "INPUT") return;
    const key = e.key;
    if (key === "Enter") {
      if (!e.shiftKey) { e.preventDefault(); onSaveAll(); }
      return;
    }
    if (!["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(key)) return;
    const idxAttr = target.getAttribute("data-nav-idx");
    if (!idxAttr) return;
    const [rIdx, cIdx] = idxAttr.split(":").map(Number);
    const cols = 4; // length, width, height, weight
    let nr = rIdx, nc = cIdx;
    if (key === "ArrowUp") nr = Math.max(0, rIdx - 1);
    else if (key === "ArrowDown") nr = Math.min(rows.length - 1, rIdx + 1);
    else if (key === "ArrowLeft") nc = Math.max(0, cIdx - 1);
    else if (key === "ArrowRight") nc = Math.min(cols - 1, cIdx + 1);
    if (nr === rIdx && nc === cIdx) return;
    e.preventDefault();
    const next = document.querySelector<HTMLInputElement>(`input[data-nav-idx="${nr}:${nc}"]`);
    if (next) { next.focus(); next.select(); }
  };

  const num = (s: string) => s === "" ? null : Number(s);

  const submitPallets = async () => {
    // distribute waybills across pallets: from selected (or unassigned), in order
    const pool = selected.size
      ? rows.filter(r => selected.has(r.id)).map(r => r.id)
      : rows.filter(r => !r.pallet_id).map(r => r.id);
    const drafts: any[] = [];
    let idx = 0;
    for (const f of palletForms) {
      const n = Math.max(0, Math.min(pool.length - idx, parseInt(f.boxCount || "0", 10) || 0));
      const ids = pool.slice(idx, idx + n);
      idx += n;
      if (!ids.length) continue;
      drafts.push({
        waybillIds: ids,
        notes: f.notes || null,
        length_cm: num(f.length_cm), width_cm: num(f.width_cm), height_cm: num(f.height_cm),
        weight_kg: num(f.weight_kg),
        self_length_cm: num(f.self_length_cm), self_width_cm: num(f.self_width_cm), self_height_cm: num(f.self_height_cm),
        self_weight_kg: num(f.self_weight_kg), self_volume_m3: num(f.self_volume_m3),
      });
    }
    if (!drafts.length) { setMsg({ ok: false, text: "无可加入的运单 / 箱数为 0" }); return; }
    setBusy(true); setMsg(null);
    try {
      const r: any = await createPallets({ data: {
        pallets: drafts,
        customer_user_id: parent?.user_id ?? null,
        customer_code: parent?.customer_code ?? null,
        route_id: parent?.route_id ?? null,
        route_code: parent?.route_code ?? null,
        pickup_warehouse: parent?.pickup_warehouse ?? parent?.warehouse ?? null,
        destination_code: parent?.destination_code ?? null,
      }});
      setMsg({ ok: true, text: `✓ 已创建 ${r.pallets.length} 个托盘` });
      setShowPallet(false);
      setPalletForms([emptyPallet()]);
      await onSearch();
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally { setBusy(false); }
  };

  const customerNote: string | null = parent?.buyer_note || parent?.note || null;

  return (
    <Page title="量尺称重" subtitle="扫描单号后录入 长×宽×高 / 重量 · 方向键在格子间移动 · Enter 保存并打印面单">
      <div className="space-y-4">
        <form onSubmit={onSearch} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <label className="text-xs font-semibold text-slate-300 inline-flex items-center gap-1.5"><Ruler className="h-4 w-4 text-brand"/>扫描单号</label>
          <div className="mt-2 flex gap-2">
            <input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="扫描或输入任意单号后回车"
              className="flex-1 rounded-md border border-brand/40 bg-white/5 px-3 py-2.5 text-sm text-slate-100 focus:border-brand focus:outline-none" autoComplete="off"/>
            <button type="submit" disabled={busy} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Search className="h-4 w-4"/>}
            </button>
          </div>
          {msg && <div className={`mt-2 text-sm ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</div>}
        </form>

        {parent && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            {customerNote && (
              <div className="mb-3 rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-3">
                <div className="flex items-start gap-2">
                  <StickyNote className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-300"/>
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300">客户备注</div>
                    <div className="mt-1 text-sm font-semibold text-amber-100 whitespace-pre-wrap">{customerNote}</div>
                  </div>
                </div>
              </div>
            )}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm">
                <span className="text-slate-400">{parentKind === "order" ? "电商订单" : "集运订单"}: </span>
                <span className="font-mono font-semibold text-slate-100">{parentNo}</span>
                <span className="ml-3 text-slate-400">客户: </span>
                <span className="font-mono text-slate-200">{parent.customer_code ?? "—"}</span>
                <span className="ml-3 text-slate-400">线路: </span>
                <span className="text-slate-200">{parent.route_code ?? "—"} / {parent.destination_code ?? "—"}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <LabelSizeToggle className="mr-1" />
                <button onClick={() => { setPalletForms([emptyPallet()]); setShowPallet(true); }} className="inline-flex items-center gap-1.5 rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20">
                  <Layers className="h-3.5 w-3.5"/>新建托盘 / 入托 (支持多个)
                </button>
                <button onClick={onSaveAll} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500/90 disabled:opacity-50">
                  <Save className="h-3.5 w-3.5"/>保存全部并打印面单
                </button>
              </div>
            </div>

            <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="mb-2 text-[11px] font-semibold text-slate-400">批量写入 (留空不修改；未勾选时应用到全部)</div>
              <div className="flex flex-wrap items-end gap-2">
                {(["length_cm","width_cm","height_cm","weight_kg"] as const).map((k) => (
                  <label key={k} className="text-[11px] text-slate-400">{k === "weight_kg" ? "重量 kg" : k === "length_cm" ? "长 cm" : k === "width_cm" ? "宽 cm" : "高 cm"}
                    <input type="number" step="0.01" value={(bulk as any)[k]} onChange={(e) => setBulk((b) => ({ ...b, [k]: e.target.value }))}
                      className="mt-1 block w-24 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
                  </label>
                ))}
                <button onClick={applyBulk} className="rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white">应用</button>
                <button onClick={() => setBulk({ length_cm: "", width_cm: "", height_cm: "", weight_kg: "" })} className="rounded-md border border-white/10 px-3 py-2 text-xs text-slate-300">清空</button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-white/5">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03] text-left text-[11px] uppercase text-slate-400">
                  <tr>
                    <th className="px-3 py-2">
                      <button onClick={toggleAll} className="text-slate-300">
                        {selected.size === rows.length && rows.length ? <CheckSquare className="h-4 w-4"/> : <Square className="h-4 w-4"/>}
                      </button>
                    </th>
                    <th>箱号</th><th>运单号</th>
                    <th>长 cm</th><th>宽 cm</th><th>高 cm</th><th>重量 kg</th>
                    <th>托盘</th>
                    <th className="px-3">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5" onKeyDown={onGridKeyDown}>
                  {rows.map((r, i) => (
                    <tr key={r.id} className="hover:bg-white/[0.02]">
                      <td className="px-3 py-2">
                        <button onClick={() => toggle(r.id)} className="text-slate-300">
                          {selected.has(r.id) ? <CheckSquare className="h-4 w-4 text-brand"/> : <Square className="h-4 w-4"/>}
                        </button>
                      </td>
                      <td className="text-xs font-mono text-slate-300">{r.box_no ?? "—"}</td>
                      <td className="text-xs font-mono text-slate-200">{r.waybill_no}</td>
                      {(["length_cm","width_cm","height_cm","weight_kg"] as const).map((k, cIdx) => (
                        <td key={k} className="py-1">
                          <input type="number" step="0.01" value={(r as any)[k] ?? ""}
                            data-nav-idx={`${i}:${cIdx}`}
                            onChange={(e) => updateRow(i, { [k]: e.target.value === "" ? null : Number(e.target.value) } as any)}
                            className="w-20 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-100"/>
                        </td>
                      ))}
                      <td className="text-xs font-mono text-slate-400">{r.pallet_no ?? "—"}</td>
                      <td className="px-3">
                        <button onClick={() => copyDown(i)} disabled={i >= rows.length - 1}
                          title="复制到下一行 (同上)"
                          className="inline-flex items-center gap-1 rounded border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/10 disabled:opacity-30">
                          <Copy className="h-3 w-3"/>同上↓
                        </button>
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={9} className="py-6 text-center text-xs text-slate-500">扫描后显示运单列表</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showPallet && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={() => setShowPallet(false)}>
            <div onClick={(e) => e.stopPropagation()} className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-lg font-bold inline-flex items-center gap-2"><Layers className="h-4 w-4 text-brand"/>批量新建托盘 / 加入运单</h2>
                <button onClick={() => setShowPallet(false)}><X className="h-4 w-4 text-slate-400"/></button>
              </div>
              <div className="mb-3 rounded-lg border border-white/10 bg-white/[0.03] p-2 text-xs text-slate-400">
                客户: <span className="font-mono text-slate-200">{parent?.customer_code ?? "—"}</span>
                <span className="ml-3">线路: <span className="text-slate-200">{parent?.route_code ?? "—"}</span></span>
                <span className="ml-3">目的地: <span className="text-slate-200">{parent?.destination_code ?? "—"}</span></span>
                <span className="ml-3">来源仓: <span className="text-slate-200">{parent?.pickup_warehouse ?? parent?.warehouse ?? "—"}</span></span>
                <span className="ml-3">可分配: <span className="text-slate-200">{(selected.size || rows.filter(r => !r.pallet_id).length)} 单</span></span>
              </div>

              <div className="space-y-3">
                {palletForms.map((f, i) => (
                  <div key={i} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-300">托盘 #{i + 1}</div>
                      {palletForms.length > 1 && (
                        <button onClick={() => setPalletForms(fs => fs.filter((_, idx) => idx !== i))}
                          className="inline-flex items-center gap-1 rounded border border-rose-500/30 px-2 py-0.5 text-[10px] text-rose-300 hover:bg-rose-500/10">
                          <Trash2 className="h-3 w-3"/>删除
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                      <label className="text-[11px] text-slate-400">箱数
                        <input type="number" min={0} value={f.boxCount}
                          onChange={(e) => setPalletForms(fs => fs.map((x, idx) => idx === i ? { ...x, boxCount: e.target.value } : x))}
                          className="mt-1 w-full rounded-md border border-brand/40 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
                      </label>
                      <label className="text-[11px] text-slate-400">备注
                        <input value={f.notes}
                          onChange={(e) => setPalletForms(fs => fs.map((x, idx) => idx === i ? { ...x, notes: e.target.value } : x))}
                          className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
                      </label>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-300/80">托盘自身 (决定运费快照 self_freight_cny = 线路规则 × 自身重/体积)</div>
                      <div className="text-[10px] text-slate-500">体积 m³ = 长×宽×高 / 1,000,000 (自动)</div>
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-5">
                      {([
                        ["self_length_cm","自身长 cm"],["self_width_cm","自身宽 cm"],["self_height_cm","自身高 cm"],
                        ["self_weight_kg","自身重 kg"],
                      ] as const).map(([k,label]) => (
                        <label key={k} className="text-[11px] text-slate-400">{label}
                          <input type="number" step="0.001" value={(f as any)[k]}
                            onChange={(e) => setPalletForms(fs => fs.map((x, idx) => {
                              if (idx !== i) return x;
                              const next = { ...x, [k]: e.target.value } as PalletForm;
                              const L = Number(k === "self_length_cm" ? e.target.value : next.self_length_cm);
                              const W = Number(k === "self_width_cm" ? e.target.value : next.self_width_cm);
                              const H = Number(k === "self_height_cm" ? e.target.value : next.self_height_cm);
                              if (L > 0 && W > 0 && H > 0) next.self_volume_m3 = ((L*W*H)/1_000_000).toFixed(6);
                              else if (k === "self_length_cm" || k === "self_width_cm" || k === "self_height_cm") next.self_volume_m3 = "";
                              return next;
                            }))}
                            className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
                        </label>
                      ))}
                      <label className="text-[11px] text-slate-400">自身体积 m³ (自动)
                        <input type="number" step="0.000001" readOnly value={f.self_volume_m3}
                          className="mt-1 w-full rounded-md border border-white/10 bg-white/[0.02] px-2 py-1.5 text-sm text-slate-300"/>
                      </label>
                    </div>
                    <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      外尺寸 / 总重 (可选参考 — 含内容物的整体外围值，仅用于登记堆场空间/装柜规划，不参与运费计算)
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-2 md:grid-cols-4">
                      {([
                        ["length_cm","长 cm"],["width_cm","宽 cm"],["height_cm","高 cm"],["weight_kg","总重 kg"],
                      ] as const).map(([k,label]) => (
                        <label key={k} className="text-[11px] text-slate-400">{label}
                          <input type="number" step="0.01" value={(f as any)[k]}
                            onChange={(e) => setPalletForms(fs => fs.map((x, idx) => idx === i ? { ...x, [k]: e.target.value } : x))}
                            className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                <button onClick={() => setPalletForms(fs => [...fs, emptyPallet()])}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-brand/40 px-3 py-2 text-xs font-semibold text-brand hover:bg-brand/10">
                  <Plus className="h-3.5 w-3.5"/>再加一个托盘
                </button>
              </div>

              <button onClick={submitPallets} disabled={busy}
                className="mt-4 w-full rounded-md bg-brand py-2.5 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "创建中…" : `创建 ${palletForms.length} 个托盘并加入运单`}
              </button>
            </div>
          </div>
        )}
      </div>
    </Page>
  );
}
