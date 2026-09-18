import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import {
  getReceivingDetail, scanReceive, removeReceivingScan,
  confirmReceiving, matchReceivingBatch, updateReceiving,
} from "@/lib/receivings.functions";
import { prepareDelivery } from "@/lib/delivery-queue.functions";
import { listBatches } from "@/lib/orders.functions";
import {
  BATCH_STATUS_LABEL, BATCH_STATUS_COLOR, METHOD_LABEL, StatusBadge, BackLink, Card, fmtDate,
} from "@/lib/admin-shared";
import { Loader2, ScanLine, Check, AlertCircle, X, Trash2, PackageCheck, AlertTriangle, CheckCircle2, Truck } from "lucide-react";

export const Route = createFileRoute("/admin/receivings/$receivingId")({ component: ReceivingDetail });

const RECV_LABEL: Record<string, string> = { open: "待匹配", matched: "已匹配", confirmed: "已确认", closed: "已关闭" };
const RECV_COLOR: Record<string, string> = {
  open: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  matched: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  confirmed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  closed: "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

// Loud alert beep via Web Audio (no asset needed)
function playAlertBeep() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const now = ctx.currentTime;
    // three loud beeps
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.value = 1100;
      g.gain.setValueAtTime(0.0001, now + i * 0.22);
      g.gain.exponentialRampToValueAtTime(1.0, now + i * 0.22 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.22 + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(now + i * 0.22);
      o.stop(now + i * 0.22 + 0.2);
    }
    setTimeout(() => ctx.close().catch(() => {}), 1200);
  } catch { /* noop */ }
}

function ReceivingDetail() {
  const { receivingId } = Route.useParams();
  const qc = useQueryClient();
  const fetchDetail = useServerFn(getReceivingDetail);
  const scan = useServerFn(scanReceive);
  const removeScan = useServerFn(removeReceivingScan);
  const confirm = useServerFn(confirmReceiving);
  const match = useServerFn(matchReceivingBatch);
  const update = useServerFn(updateReceiving);
  const prepare = useServerFn(prepareDelivery);
  const fetchBatches = useServerFn(listBatches);

  const q = useQuery({ queryKey: ["receiving", receivingId], queryFn: () => fetchDetail({ data: { receivingId } }) });
  const batchesQ = useQuery({ queryKey: ["batches-for-recv-detail"], queryFn: () => fetchBatches(), staleTime: 30_000 });

  const [code, setCode] = useState("");
  const [log, setLog] = useState<{ time: string; code: string; ok: boolean; info: string; extra?: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [showMatch, setShowMatch] = useState(false);
  const [pickBatchId, setPickBatchId] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["receiving", receivingId] });

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 200); }, []);

  if (q.isLoading) return <div className="grid place-items-center p-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>;
  if (q.isError) return <div className="p-6 text-rose-400">{(q.error as Error).message}</div>;

  const { receiving: r, scans, direct, secondary, diff } = q.data!;
  const isFinal = r.status === "confirmed" || r.status === "closed";

  const onScan = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const c = code.trim(); if (!c || busy) return;
    setBusy(true);
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    try {
      const res: any = await scan({ data: { receivingId, code: c } });
      setLog(l => [{ time, code: c, ok: true, info: res.info, extra: res.extra }, ...l].slice(0, 50));
      if (res.extra) {
        playAlertBeep();
        const keep = window.confirm(`⚠ 差异警告\n\n${res.info}\n\n该件不属于当前匹配批次。\n\n确定要保留这条扫描记录吗？\n（取消将删除该记录）`);
        if (!keep && res.scan_id) {
          await removeScan({ data: { scanId: res.scan_id } });
        }
      }
      await refresh();
    } catch (err: any) {
      playAlertBeep();
      setLog(l => [{ time, code: c, ok: false, info: err.message }, ...l].slice(0, 50));
    } finally {
      setCode(""); setBusy(false); inputRef.current?.focus();
    }
  };

  const onConfirm = async () => {
    if (!r.batch_id) { alert("请先匹配批次"); return; }
    const hasMissing = diff.missing_waybills.length || diff.missing_cartons.length || diff.missing_pallets.length;
    const hasPendingSecondary = secondary.pending_count > 0;
    if (hasMissing || hasPendingSecondary) {
      const parts: string[] = [];
      if (hasMissing) parts.push(`直挂未到 ${diff.missing_waybills.length} 单 / ${diff.missing_cartons.length} 箱 / ${diff.missing_pallets.length} 托`);
      if (hasPendingSecondary) parts.push(`待二次确认 ${secondary.pending_count} 项`);
      playAlertBeep();
      if (!window.confirm(`⚠ 仍有差异：\n${parts.join("\n")}\n\n仍确认到件？`)) return;
    } else {
      if (!window.confirm("确认完成收货？将自动把批次和所有运单标记为已到件并更新轨迹。")) return;
    }
    setBusy(true);
    try {
      const res = await confirm({ data: { receivingId } });
      alert(`已确认收货：更新 ${res.waybills_updated} 单`);
      await refresh();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  const onMatch = async () => {
    await match({ data: { receivingId, batchId: pickBatchId || null } });
    setShowMatch(false);
    await refresh();
  };

  const onRemove = async (id: string) => {
    if (!window.confirm("移除该扫描？")) return;
    await removeScan({ data: { scanId: id } });
    await refresh();
  };

  const onSaveNotes = async (notes: string) => {
    await update({ data: { receivingId, patch: { notes } } });
    await refresh();
  };
  const onPrepare = async () => {
    if (!r.batch_id) { alert("请先匹配批次"); return; }
    if (!window.confirm("将按规则把本批次的运单 / 有客户号箱号 / 有客户号托盘 添加到「待派送列表」？")) return;
    setBusy(true);
    try {
      const res: any = await prepare({ data: { receivingId } });
      alert(`已加入待派送：运单 ${res.counts.waybills} · 箱号 ${res.counts.cartons} · 托盘 ${res.counts.pallets}\n（新增 ${res.counts.inserted}，已存在 ${res.counts.skipped}）`);
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };


  // 直挂 stats
  const directWbScanned = direct.waybills.filter((w: any) => scans.some((s: any) => s.kind === "waybill" && s.ref_id === w.id)).length;
  const directCtScanned = direct.cartons.filter((c: any) => scans.some((s: any) => s.kind === "carton" && s.ref_id === c.id)).length;
  const directPlScanned = direct.pallets.filter((p: any) => scans.some((s: any) => s.kind === "pallet" && s.ref_id === p.id)).length;

  const secondaryAllDone = secondary.total_count > 0 && secondary.pending_count === 0;

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <BackLink to="/admin/receivings">返回收货列表</BackLink>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold font-mono">{r.receiving_no}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <StatusBadge map={RECV_LABEL} color={RECV_COLOR} value={r.status} />
            {r.warehouse_code && <span>· 仓库 {r.warehouse_code}</span>}
            {r.confirmed_at && <span>· 确认 {fmtDate(r.confirmed_at)}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {!isFinal && (
            <button onClick={() => { setPickBatchId(r.batch_id ?? ""); setShowMatch(true); }}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">
              {r.batch_id ? "更换批次" : "匹配批次"}
            </button>
          )}
          {/* 准备派送不改收货单/批次状态，只是把批次内容同步进待派送列表，且有去重——
              到件确认后仍然可能需要补跑（比如确认前忘了点，或确认后批次内容有变动），
              所以不跟 isFinal 挂钩，一直可用。 */}
          <button onClick={onPrepare} disabled={busy || !r.batch_id}
            className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20 disabled:opacity-50">
            <Truck className="h-3.5 w-3.5" />准备派送
          </button>
          {!isFinal && (
            <button onClick={onConfirm} disabled={busy || !r.batch_id}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              <PackageCheck className="h-3.5 w-3.5" />确认到件
            </button>
          )}
        </div>
      </div>

      {/* Matched batch summary */}
      <Card title="匹配批次">
        {r.batches ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link to="/admin/batches/$batchId" params={{ batchId: r.batches.id }} className="font-mono text-brand hover:underline">{r.batches.batch_no}</Link>
            <StatusBadge map={BATCH_STATUS_LABEL} color={BATCH_STATUS_COLOR} value={r.batches.status} />
            <span className="text-xs text-slate-400">{METHOD_LABEL[r.batches.shipping_method] ?? r.batches.shipping_method} · 发货 {r.batches.planned_ship_date} · 目的地 {r.batches.destination_code ?? "—"}</span>
          </div>
        ) : (
          <div className="text-sm text-slate-400">尚未匹配批次（仅可匹配「已发货」状态的批次；扫描首个运单/箱号/托盘后会自动匹配）</div>
        )}
      </Card>

      {/* Scan input + summary */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="扫描确认 / 扫描加入（统一入口）">
          {isFinal ? (
            <div className="rounded-md bg-emerald-500/10 p-3 text-xs text-emerald-300">收货已确认，不能继续扫描</div>
          ) : (
            <>
              <form onSubmit={onScan} className="flex gap-2">
                <input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value)}
                  placeholder="扫描或输入运单号 / 箱号 (BOX...) / 托盘号 (PAL...) — 自动识别，或点击确认加入"
                  className="min-w-0 flex-1 rounded-md border border-brand/40 bg-white/5 px-3 py-2.5 text-sm text-slate-100 focus:border-brand focus:outline-none"
                  autoComplete="off" />
                <button type="submit" disabled={!code.trim() || busy}
                  className="shrink-0 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-40">
                  确认加入
                </button>
              </form>
              <p className="mt-1.5 text-[11px] text-slate-500">扫描箱号/托盘号仅确认外层；内部明细需进入下方「待二次扫描确认」逐件再次扫描。</p>
            </>
          )}
          <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-white/5 bg-white/[0.02] p-2">
            {log.length === 0 ? <div className="py-4 text-center text-xs text-slate-500">扫描记录将在这里实时显示</div> :
              <ul className="space-y-1">
                {log.map((l, i) => (
                  <li key={i} className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs ${!l.ok ? "bg-rose-500/10" : l.extra ? "bg-amber-500/10" : "bg-emerald-500/5"}`}>
                    {!l.ok ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                      : l.extra ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                        : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />}
                    <span className="font-mono text-[10px] text-slate-500">{l.time}</span>
                    <span className="font-mono text-slate-300">{l.code}</span>
                    <span className={`flex-1 ${!l.ok ? "text-rose-200" : l.extra ? "text-amber-200" : "text-emerald-200"}`}>{l.info}</span>
                  </li>
                ))}
              </ul>}
          </div>
        </Card>

        <Card title="发货 vs 收货差异（直挂层）">
          {!r.batch_id ? <div className="text-xs text-slate-500">匹配批次后将显示对比</div> : (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat label="直挂运单" sc={directWbScanned} ex={direct.waybills.length} />
                <Stat label="直挂箱号" sc={directCtScanned} ex={direct.cartons.length} />
                <Stat label="直挂托盘" sc={directPlScanned} ex={direct.pallets.length} />
              </div>
              {(diff.missing_waybills.length > 0 || diff.missing_cartons.length > 0 || diff.missing_pallets.length > 0) && (
                <DiffBlock title="未到 (Missing)" cls="text-rose-300 bg-rose-500/10"
                  items={[
                    ...diff.missing_waybills.map((w: any) => `运单 ${w.waybill_no}${w.customer_code ? ` (${w.customer_code})` : ""}`),
                    ...diff.missing_cartons.map((c: any) => `箱号 ${c.carton_no}`),
                    ...diff.missing_pallets.map((p: any) => `托盘 ${p.pallet_no}`),
                  ]} />
              )}
              {diff.extra_scans.length > 0 && (
                <DiffBlock title="多扫 / 差异 (Extra)" cls="text-amber-300 bg-amber-500/10"
                  items={diff.extra_scans.map((s: any) => `${s.kind === 'waybill' ? '运单' : s.kind === 'carton' ? '箱号' : '托盘'} ${s.code}`)} />
              )}
              {direct.waybills.length + direct.cartons.length + direct.pallets.length > 0
                && diff.missing_waybills.length === 0 && diff.missing_cartons.length === 0
                && diff.missing_pallets.length === 0 && diff.extra_scans.length === 0 && (
                  <div className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-300">✓ 直挂层全部匹配</div>
                )}
            </div>
          )}
        </Card>
      </div>

      {/* 待二次扫描确认 */}
      {r.batch_id && secondary.total_count > 0 && (
        <Card title={
          <span className="inline-flex items-center gap-2">
            待二次扫描确认
            <span className="text-xs text-slate-400">（{secondary.total_count - secondary.pending_count}/{secondary.total_count}）</span>
            {secondaryAllDone && (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />全部确认
              </span>
            )}
          </span> as any
        }>
          <p className="mb-3 text-[11px] text-slate-500">扫描箱号/托盘号后，需要在统一扫描入口逐件确认内部运单号/箱号。点击编号可一键复制。</p>
          <div className="grid gap-3 md:grid-cols-2">
            {secondary.inner_waybills.length > 0 && (
              <SecondaryList
                title={`箱内运单 (${secondary.inner_waybills.filter((x: any) => !x.scanned).length} 待扫)`}
                items={secondary.inner_waybills.map((w: any) => ({ id: w.id, label: w.waybill_no, sub: w.customer_code, scanned: w.scanned }))}
              />
            )}
            {secondary.inner_cartons.length > 0 && (
              <SecondaryList
                title={`托盘内箱号 (${secondary.inner_cartons.filter((x: any) => !x.scanned).length} 待扫)`}
                items={secondary.inner_cartons.map((c: any) => ({ id: c.id, label: c.carton_no, sub: null, scanned: c.scanned }))}
              />
            )}
          </div>
        </Card>
      )}

      {/* Scan detail — horizontal split */}
      <Card title={`扫描明细 (${scans.length})`}>
        <div className="grid gap-3 lg:grid-cols-3">
          <ScanCol kind="waybill" title="直挂运单" scans={scans} isFinal={isFinal} onRemove={onRemove} />
          <ScanCol kind="carton" title="直挂箱号" scans={scans} isFinal={isFinal} onRemove={onRemove} />
          <ScanCol kind="pallet" title="直挂托盘号" scans={scans} isFinal={isFinal} onRemove={onRemove} />
        </div>
      </Card>

      <Card title="备注">
        <NotesEditor initial={r.notes ?? ""} disabled={isFinal} onSave={onSaveNotes} />
      </Card>

      {showMatch && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold inline-flex items-center gap-2"><ScanLine className="h-4 w-4 text-brand" />匹配批次（仅已发货）</h2>
              <button onClick={() => setShowMatch(false)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <select value={pickBatchId} onChange={(e) => setPickBatchId(e.target.value)}
              className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 [&>option]:bg-[#0E1626]">
              <option value="">— 解除匹配 —</option>
              {batchesQ.data?.batches
                .filter((b: any) => b.status === "shipped")
                .map((b: any) => (
                  <option key={b.id} value={b.id}>{b.batch_no} · {METHOD_LABEL[b.shipping_method] ?? b.shipping_method} · {BATCH_STATUS_LABEL[b.status]}</option>
                ))}
            </select>
            <button onClick={onMatch} className="mt-3 w-full rounded-md bg-brand py-2 text-sm font-semibold text-white hover:bg-brand/90">保存</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScanCol({ kind, title, scans, isFinal, onRemove }: { kind: "waybill" | "carton" | "pallet"; title: string; scans: any[]; isFinal: boolean; onRemove: (id: string) => void }) {
  const items = scans.filter((s: any) => s.kind === kind);
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02]">
      <div className="border-b border-white/5 px-3 py-2 text-xs font-semibold text-slate-300">{title} <span className="text-slate-500">({items.length})</span></div>
      {items.length === 0 ? <div className="py-6 text-center text-[11px] text-slate-500">暂无</div> : (
        <ul className="max-h-80 divide-y divide-white/5 overflow-y-auto">
          {items.map((s: any) => (
            <li key={s.id} className="flex items-center justify-between px-3 py-1.5 text-xs hover:bg-white/[0.03]">
              <div className="min-w-0">
                <div className="truncate font-mono text-slate-200">{s.code}</div>
                <div className="text-[10px] text-slate-500">{fmtDate(s.scanned_at)}</div>
              </div>
              {!isFinal && <button onClick={() => onRemove(s.id)} className="text-rose-400 hover:text-rose-300"><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SecondaryList({ title, items }: { title: string; items: { id: string; label: string; sub?: string | null; scanned: boolean }[] }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02]">
      <div className="border-b border-white/5 px-3 py-2 text-xs font-semibold text-slate-300">{title}</div>
      <ul className="max-h-72 divide-y divide-white/5 overflow-y-auto">
        {items.map((it) => (
          <li key={it.id} className={`flex items-center justify-between px-3 py-1.5 text-xs ${it.scanned ? "bg-emerald-500/5" : ""}`}>
            <button onClick={() => navigator.clipboard?.writeText(it.label)} className="text-left">
              <div className="font-mono text-slate-200 hover:text-brand">{it.label}</div>
              {it.sub && <div className="text-[10px] text-slate-500">{it.sub}</div>}
            </button>
            {it.scanned
              ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300"><Check className="h-3 w-3" />已确认</span>
              : <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">待扫描</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({ label, sc, ex }: { label: string; sc: number; ex: number }) {
  const ok = sc === ex && ex > 0;
  return (
    <div className={`rounded-lg border p-2 ${ok ? "border-emerald-500/30 bg-emerald-500/5" : sc > ex ? "border-amber-500/30 bg-amber-500/5" : "border-white/10 bg-white/[0.02]"}`}>
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="font-mono text-lg font-bold text-slate-100">{sc}<span className="text-xs text-slate-500"> / {ex}</span></div>
    </div>
  );
}

function DiffBlock({ title, items, cls }: { title: string; items: string[]; cls: string }) {
  return (
    <div className={`rounded-md p-2 ${cls}`}>
      <div className="mb-1 flex items-center gap-1 text-xs font-semibold"><AlertTriangle className="h-3 w-3" />{title} ({items.length})</div>
      <ul className="space-y-0.5 text-[11px] font-mono">
        {items.slice(0, 20).map((i, k) => <li key={k}>· {i}</li>)}
        {items.length > 20 && <li className="text-slate-400">…还有 {items.length - 20} 项</li>}
      </ul>
    </div>
  );
}

function NotesEditor({ initial, disabled, onSave }: { initial: string; disabled: boolean; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  return (
    <div className="space-y-2">
      <textarea value={v} disabled={disabled} onChange={(e) => setV(e.target.value)} rows={3}
        className="w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100 disabled:opacity-60" />
      {!disabled && (
        <button onClick={async () => { setSaving(true); try { await onSave(v); } finally { setSaving(false); } }}
          disabled={saving || v === initial}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand/90 disabled:opacity-50">
          {saving ? "保存中…" : "保存备注"}
        </button>
      )}
    </div>
  );
}
