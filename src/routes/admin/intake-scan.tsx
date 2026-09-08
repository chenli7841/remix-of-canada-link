import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, useRef, useEffect } from "react";
import { intakeScanSearch, intakeScanCommit, markDetained, intakeScanReceiveWaybill, intakeScanReceiveOrder } from "@/lib/scan.functions";
import { Page } from "@/lib/admin-shared";
import { InventoryIntakePanel } from "@/components/admin/InventoryIntakePanel";
import { ScanLine, Search, Package, AlertTriangle, Loader2, Check, StickyNote } from "lucide-react";

export const Route = createFileRoute("/admin/intake-scan")({ component: IntakeScanPage });

type Candidate = any;

function IntakeScanPage() {
  const search = useServerFn(intakeScanSearch);
  const commit = useServerFn(intakeScanCommit);
  const receiveWb = useServerFn(intakeScanReceiveWaybill);
  const receiveOrder = useServerFn(intakeScanReceiveOrder);
  const detain = useServerFn(markDetained);

  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [matchType, setMatchType] = useState<"exact" | "fuzzy" | "waybill" | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [boxCount, setBoxCount] = useState(1);
  const [weight, setWeight] = useState<string>("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [log, setLog] = useState<{ time: string; code: string; action: string }[]>([]);
  const [waybillNote, setWaybillNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const onSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true); setMsg(null); setPicked(null);
    try {
      const r: any = await search({ data: { code: c } });
      setMatchType(r.match);
      setCandidates(r.candidates ?? []);
      if (r.match === "waybill" && r.waybill) {
        // 运单号 → 直接入库（面单在量尺称重保存时打印）
        try {
          await receiveWb({ data: { waybillId: r.waybill.id } });
          const note = r.waybill.parent_buyer_note || r.waybill.parent_note;
          const noteText = note ? ` | 客户备注: ${note}` : "";
          setMsg({ ok: true, text: `✓ 运单 ${r.waybill.waybill_no} 已收件${noteText}` });
          setWaybillNote(note || null);
          setLog(l => [{ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), code: c, action: `运单收件 ${r.waybill.waybill_no}${noteText}` }, ...l].slice(0, 30));
          // keep the note visible — only clear input
          setCode(""); setCandidates([]); setPicked(null); setMatchType(null);
          setTimeout(() => inputRef.current?.focus(), 50);
        } catch (err: any) {
          setMsg({ ok: false, text: `运单收件失败: ${err.message}` });
        }
      } else if (r.match === "exact" && r.candidates.length === 1) {
        const cand = r.candidates[0];
        if (cand.kind === "order" && cand.via === "order_no") {
          await autoReceiveOrder(cand, c);
        } else {
          setPicked(cand);
          setBoxCount(cand.box_count || 1);
        }
      } else if (r.match === "fuzzy" && r.candidates.length === 0) {
        // 无任何匹配 — 自动登记滞留
        try {
          await detain({ data: { code: c } });
          setMsg({ ok: true, text: `× 无任何匹配 — 已自动登记滞留: ${c}` });
          setLog(l => [{ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), code: c, action: "自动滞留登记" }, ...l].slice(0, 30));
          reset();
        } catch (err: any) {
          setMsg({ ok: false, text: `自动滞留失败: ${err.message}` });
        }
      }
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    } finally { setBusy(false); }
  };

  const autoReceiveOrder = async (cand: Candidate, c: string) => {
    try {
      const r: any = await receiveOrder({ data: { orderId: cand.id } });
      const ids = (r.waybills ?? []).map((w: any) => w.id);
      setMsg({ ok: true, text: `✓ 电商订单 ${r.parentNo} 已按 ${ids.length} 个运单全部收件` });
      setLog(l => [{ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), code: c, action: `电商订单收件 ${r.parentNo} → ${ids.length}单` }, ...l].slice(0, 30));
      reset();
    } catch (err: any) {
      setMsg({ ok: false, text: `电商订单收件失败: ${err.message}` });
    }
  };


  const doIntake = async () => {
    if (!picked) return;
    setBusy(true); setMsg(null);
    try {
      const r = await commit({ data: { parentKind: picked.kind, parentId: picked.id, boxCount, weightPerBox: weight ? Number(weight) : undefined } });
      setMsg({ ok: true, text: `✓ 已生成 ${r.waybills.length} 个运单 (${r.parentNo})，面单请在量尺称重保存时打印` });
      setLog(l => [{ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), code: code.trim(), action: `入库 ${picked.display_no} → ${r.waybills.length}单` }, ...l].slice(0, 30));
      reset();
    } catch (err: any) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  };

  const doDetain = async () => {
    const c = code.trim();
    if (!c) return;
    setBusy(true); setMsg(null);
    try {
      await detain({ data: { code: c } });
      setMsg({ ok: true, text: `✓ 已登记滞留: ${c}` });
      setLog(l => [{ time: new Date().toLocaleTimeString("zh-CN", { hour12: false }), code: c, action: "滞留登记" }, ...l].slice(0, 30));
      reset();
    } catch (err: any) { setMsg({ ok: false, text: err.message }); } finally { setBusy(false); }
  };

  const reset = () => {
    setCode(""); setCandidates([]); setPicked(null); setMatchType(null); setBoxCount(1); setWeight("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <Page title="入库扫描" subtitle="运单号/电商订单号 → 直接收件; 集运订单号/国内单号 → 手动输入箱数生成运单; 无匹配 → 自动登记滞留">
      <div className="mx-auto max-w-4xl space-y-4">
        <form onSubmit={onSearch} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <label className="text-xs font-semibold text-slate-300 inline-flex items-center gap-1.5"><ScanLine className="h-4 w-4 text-brand"/>扫描单号 (运单号 / 电商订单号 / 集运订单号 / 国内单号 均可)</label>
          <div className="mt-2 flex gap-2">
            <input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)}
              placeholder="扫描或输入任意单号后按回车 — 运单号→自动收件; 订单号/国内号→手动输入箱数"
              className="flex-1 rounded-md border border-brand/40 bg-white/5 px-3 py-2.5 text-sm text-slate-100 focus:border-brand focus:outline-none"
              autoComplete="off"/>
            <button type="submit" disabled={busy} className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Search className="h-4 w-4"/>}
            </button>
          </div>
          {msg && <div className={`mt-2 text-sm ${msg.ok ? "text-emerald-300" : "text-rose-300"}`}>{msg.text}</div>}
        </form>

        <InventoryIntakePanel />


        {waybillNote && (
          <div className="rounded-2xl border-2 border-amber-500/60 bg-amber-500/10 p-4">
            <div className="flex items-start gap-2">
              <StickyNote className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-300"/>
              <div className="flex-1">
                <div className="text-[11px] font-bold uppercase tracking-wider text-amber-300">客户备注 (上次扫描运单)</div>
                <div className="mt-1 text-sm font-semibold text-amber-100 whitespace-pre-wrap">{waybillNote}</div>
              </div>
              <button onClick={() => setWaybillNote(null)} className="text-amber-300/70 hover:text-amber-200"><AlertTriangle className="h-3 w-3 rotate-45"/></button>
            </div>
          </div>
        )}

        {matchType && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">
                {matchType === "exact" ? "✓ 找到精确匹配" : candidates.length ? `⚠ 无精确匹配，最近 ${candidates.length} 条相似单` : "× 无任何匹配"}
              </h3>
              <button onClick={doDetain} disabled={busy} className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300 hover:bg-amber-500/20">
                <AlertTriangle className="h-3 w-3"/>登记滞留
              </button>
            </div>

            {candidates.length > 0 && (
              <div className="space-y-1.5">
                {candidates.map((c) => {
                  const noteText = c.buyer_note || c.note || null;
                  return (
                    <button key={c.id} onClick={() => { setPicked(c); setBoxCount(c.box_count || 1); }}
                      className={`w-full text-left rounded-md border px-3 py-2 text-xs transition ${picked?.id === c.id ? "border-brand bg-brand/10" : "border-white/10 bg-white/5 hover:bg-white/10"}`}>
                      <div className="flex items-center justify-between">
                        <div className="font-mono font-semibold text-slate-200">
                          {c.kind === "order" ? "订单" : "集运"} {c.display_no}
                        </div>
                        <div className="font-mono text-slate-400">{c.customer_code ?? "—"}</div>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-400">
                        <span>国内单号: <span className="font-mono text-slate-300">{c.domestic_tracking_no ?? "—"}</span></span>
                        <span>箱数: {c.box_count ?? "—"}</span>
                        <span>线路: {c.route_code ?? "—"}</span>
                        <span>目的地: {c.destination_code ?? "—"}</span>
                        <span>状态: {c.status}</span>
                        {c.existing_waybill_count > 0 && (
                          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-1.5 text-emerald-300">
                            已有 {c.existing_waybill_count} 单
                          </span>
                        )}
                      </div>
                      {c.existing_waybill_count > 0 && (
                        <div className="mt-1 font-mono text-[10px] text-emerald-200/80">
                          {(c.existing_waybills ?? []).map((w: any) => w.waybill_no).join(" · ")}
                        </div>
                      )}
                      {noteText && (
                        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
                          <StickyNote className="mr-1 inline h-3 w-3 text-amber-300"/><span className="font-semibold">客户备注:</span> {noteText}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {picked && (() => {
              const pickedNote = picked.buyer_note || picked.note || null;
              return (
                <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-300">
                    <span>已选: {picked.display_no}</span>
                    {picked.existing_waybill_count > 0 && (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px]">
                        已有 {picked.existing_waybill_count} 单 · 将直接收件不重复生成
                      </span>
                    )}
                  </div>
                  {pickedNote && (
                    <div className="mb-3 rounded-md border-2 border-amber-500/60 bg-amber-500/10 p-2">
                      <div className="flex items-start gap-2">
                        <StickyNote className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-300"/>
                        <div>
                          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-300">客户备注</div>
                          <div className="text-sm font-semibold text-amber-100 whitespace-pre-wrap">{pickedNote}</div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-[11px] text-slate-400">箱数{picked.existing_waybill_count > 0 && <span className="ml-1 text-emerald-400">(已读取已有)</span>}
                      <input type="number" min={1} max={200} value={boxCount}
                        disabled={picked.existing_waybill_count > 0}
                        onChange={(e) => setBoxCount(Math.max(1, Number(e.target.value)))}
                        className="mt-1 block w-24 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 disabled:opacity-60"/>
                    </label>
                    <label className="text-[11px] text-slate-400">每箱重量 (kg, 可空)
                      <input value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="可留空"
                        className="mt-1 block w-32 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"/>
                    </label>
                    <button onClick={doIntake} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500/90 disabled:opacity-50">
                      <Package className="h-4 w-4"/>
                      {picked.existing_waybill_count > 0 ? `入库 (${picked.existing_waybill_count}单已有)` : `入库 (${boxCount}单)`}
                    </button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-300">本次操作记录</span>
            <Link to="/admin/detained" className="text-brand hover:underline">查看滞留单 →</Link>
          </div>
          {log.length === 0 ? <div className="py-2 text-center text-xs text-slate-500">暂无</div> :
            <ul className="space-y-1 text-xs">
              {log.map((l, i) => (
                <li key={i} className="flex items-center gap-2 rounded-md bg-white/[0.02] px-2 py-1">
                  <Check className="h-3 w-3 text-emerald-400"/>
                  <span className="font-mono text-[10px] text-slate-500">{l.time}</span>
                  <span className="font-mono text-slate-300">{l.code}</span>
                  <span className="text-slate-400">— {l.action}</span>
                </li>
              ))}
            </ul>}
        </div>
      </div>
    </Page>
  );
}
