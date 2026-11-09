import { ReceivingHierarchy } from "@/components/admin/ReceivingHierarchy";
import { EntityActionLogs } from "@/components/admin/EntityActionLogs";
import { CameraScanButton } from "@/components/admin/CameraScanButton";
import { useReturnReminder } from '@/components/admin/useReturnReminder';
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import {
  getReceivingDetail, scanReceive, removeReceivingScan,
  confirmReceiving, matchReceivingBatch, updateReceiving, matchAllReceiving, mergeReceivingScanBatch, mergeReceivingScan, dismissReceivingIssue,
} from "@/lib/receivings.functions";
import { prepareDelivery } from "@/lib/delivery-queue.functions";
import { listBatches } from "@/lib/orders.functions";
import { listWarehouses } from "@/lib/settings.functions";
import { receivingBatchLabel, receivingWarehouseLabel } from "@/lib/receiving-labels";
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
  const scan = useReturnReminder(scanReceive);
  const matchAll = useReturnReminder(matchAllReceiving);
  const removeScan = useServerFn(removeReceivingScan);
  const mergeBatch = useReturnReminder(mergeReceivingScanBatch);
  const mergeScan = useReturnReminder(mergeReceivingScan);
  const dismissIssue = useServerFn(dismissReceivingIssue);
  const confirm = useReturnReminder(confirmReceiving);
  const match = useServerFn(matchReceivingBatch);
  const update = useServerFn(updateReceiving);
  const prepare = useServerFn(prepareDelivery);
  const fetchBatches = useServerFn(listBatches);
  const fetchWarehouses = useServerFn(listWarehouses);
  const warehousesQ = useQuery({ queryKey: ["receiving-warehouses"], queryFn: () => fetchWarehouses(), staleTime: 60_000 });

  const q = useQuery({ queryKey: ["receiving", receivingId], queryFn: () => fetchDetail({ data: { receivingId } }) });
  const batchesQ = useQuery({ queryKey: ["batches-for-recv-detail"], queryFn: () => fetchBatches(), staleTime: 30_000 });

  const [code, setCode] = useState("");
  const [log, setLog] = useState<{ time: string; code: string; ok: boolean; info: string; extra?: boolean }[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmPhase, setConfirmPhase] = useState<'idle' | 'processing' | 'refreshing' | 'success' | 'error'>('idle');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmSeconds, setConfirmSeconds] = useState(0);
  const confirmInFlight = useRef(false);
  const confirming = confirmPhase === 'processing' || confirmPhase === 'refreshing';
  useEffect(() => {
    if (!confirming) return;
    const started = Date.now();
    setConfirmSeconds(0);
    const timer = window.setInterval(() => setConfirmSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [confirming]);
  const [showMatch, setShowMatch] = useState(false);
  const [pickBatchIds, setPickBatchIds] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["receiving", receivingId] });

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 200); }, []);

  if (q.isLoading) return <div className="grid place-items-center p-20"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>;
  if (q.isError) return <div className="p-6 text-rose-400">{(q.error as Error).message}</div>;

  const { receiving: r, scans, expected, direct, secondary, diff, issues } = q.data!;
  const isFinal = r.status === "confirmed" || r.status === "closed";

  const onScan = async (e?: React.FormEvent, manualCode?: string) => {
    e?.preventDefault();
    const c = (manualCode ?? code).trim(); if (!c || busy) return;
    setBusy(true);
    const time = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    try {
      const res: any = await scan({ data: { receivingId, code: c } });
      setLog(l => [{ time, code: c, ok: true, info: res.info, extra: res.extra }, ...l].slice(0, 50));
      if (res.extra) playAlertBeep();
      if (res.needsSelection) window.alert(res.info);
      await refresh();
    } catch (err: any) {
      playAlertBeep();
      setLog(l => [{ time, code: c, ok: false, info: err.message }, ...l].slice(0, 50));
    } finally {
      setCode(""); setBusy(false); inputRef.current?.focus();
    }
  };

  const onMatchAll = async () => {
    if (busy || isFinal || !r.batch_id) return;
    const label = r.matched_batches.map(receivingBatchLabel).join('、');
    if (!window.confirm('第一次确认：将“' + label + '”的全部运单、箱号和托盘视为到货，包括箱内及托盘内明细。是否继续？')) return;
    if (!window.confirm('第二次确认：请确认整批货物确实全部到齐。执行后将自动补齐收货匹配记录，无需逐件扫描。确定执行一键匹配？')) return;
    setBusy(true);
    try {
      const res = await matchAll({ data: { receivingId } });
      const info = '全部到货已匹配：' + res.counts.waybills + ' 单 / ' + res.counts.cartons + ' 箱 / ' + res.counts.pallets + ' 托；已有记录保留。';
      setLog(l => [{ time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), code: '一键匹配', ok: true, info }, ...l].slice(0, 50));
      await refresh();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  const onConfirm = async () => {
    if (busy || isFinal || confirmInFlight.current) return;
    if (!r.batch_id) { alert("请先匹配批次"); return; }
    const hasMissing = diff.missing_waybills.length || diff.missing_cartons.length || diff.missing_pallets.length;
    const hasPendingSecondary = secondary.pending_count > 0;
    if (hasMissing || hasPendingSecondary) {
      const parts: string[] = [];
      if (hasMissing) parts.push(`直挂未到 ${diff.missing_waybills.length} 单 / ${diff.missing_cartons.length} 箱 / ${diff.missing_pallets.length} 托`);
      if (hasPendingSecondary) parts.push(`内部尚未确认 ${secondary.pending_count} 项`);
      playAlertBeep();
      if (!window.confirm(`⚠ 仍有差异：\n${parts.join("\n")}\n\n仍确认到件？`)) return;
    } else {
      if (!window.confirm("确认完成收货？将匹配批次及已扫描收货的运单标记为已到件，同步已收齐的订单，并记录操作人、时间和轨迹。")) return;
    }
    confirmInFlight.current = true;
    setBusy(true);
    setConfirmPhase('processing');
    setConfirmMessage('正在确认到件并更新运单轨迹，请勿重复操作或关闭页面。');
    try {
      const res = await confirm({ data: { receivingId } });
      setConfirmPhase('refreshing');
      setConfirmMessage('到件处理已完成，正在刷新收货状态…');
      await refresh();
      setConfirmMessage('已确认收货：匹配批次已到件，更新 ' + res.waybills_updated + ' 张运单、' + res.orders_updated + ' 张订单，操作记录已保存。');
      setConfirmPhase('success');
    } catch (e: any) {
      setConfirmMessage('未能确认处理结果：' + (e.message || '请求失败') + '。请先刷新核实收货状态，再决定是否重试。');
      setConfirmPhase('error');
    } finally {
      confirmInFlight.current = false;
      setBusy(false);
    }
  };

  const onMatch = async () => {
    setBusy(true);
    try {
      await match({ data: { receivingId, batchIds: pickBatchIds } });
      setShowMatch(false);
      await refresh();
    } catch (e: any) { alert(e.message); } finally { setBusy(false); }
  };

  const onRemove = async (id: string) => {
    if (!window.confirm("撤销此项确认？容器内的确认会同时撤销，所属箱号和托盘也会恢复为待确认。")) return;
    setBusy(true);
    try {await removeScan({ data: { scanId: id } });await refresh();}
    catch(e:any){alert(e.message);}finally{setBusy(false);}
  };

  const onSaveNotes = async (notes: string) => {
    await update({ data: { receivingId, patch: { notes } } });
    await refresh();
  };
  const onPrepare = async () => {
    if (!r.batch_id) { alert("请先匹配批次"); return; }
    if (!window.confirm("将按规则把匹配的全部批次的运单 / 有客户号箱号 / 有客户号托盘 添加到「待派送列表」？")) return;
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



  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <BackLink to="/admin/receivings">返回收货列表</BackLink>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold font-mono">{r.receiving_no}</h1>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <StatusBadge map={RECV_LABEL} color={RECV_COLOR} value={r.status} />
            {r.warehouse_code && <span>· 仓库 {receivingWarehouseLabel(r.warehouse_code, warehousesQ.data?.warehouses)}</span>}
            {r.confirmed_at && <span>· 确认 {fmtDate(r.confirmed_at)}</span>}
          </div>
        </div>
        <div className="flex gap-2">
          {!isFinal && (
            <button disabled={busy} onClick={() => { setPickBatchIds(r.batch_ids); setShowMatch(true); }}
              className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10">
              {r.batch_id ? "管理匹配批次" : "匹配批次"}
            </button>
          )}
          {/* 确认到件后可重复同步批次内容；已进入队列或已派送的项目会跳过。 */}
          <button onClick={onPrepare} disabled={busy || !r.batch_id || r.status !== 'confirmed'} title={r.status !== 'confirmed' ? '请先确认到件' : '将匹配的全部批次加入待派送列表，已加入的项目不会重复添加'}
            className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand/20 disabled:opacity-50">
            <Truck className="h-3.5 w-3.5" />准备派送
          </button>
          {!isFinal && (
            <button onClick={onConfirm} disabled={busy || !r.batch_id}
              className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
              {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageCheck className="h-3.5 w-3.5" />}
              {confirming ? '正在确认到件…' : '确认到件'}
            </button>
          )}
        </div>
      </div>

      {confirmPhase !== 'idle' && (
        <div role={confirmPhase === 'error' ? 'alert' : 'status'} aria-live="polite" aria-busy={confirming}
          className={`rounded-xl border p-4 ${confirmPhase === 'error' ? 'border-rose-500/30 bg-rose-500/10 text-rose-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'}`}>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : confirmPhase === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {confirmMessage}
          </div>
          {confirming && <>
            <progress aria-label="确认到件处理中" className="mt-3 h-2 w-full overflow-hidden rounded-full accent-emerald-500" />
            <p className="mt-2 text-xs text-slate-300">已等待 {confirmSeconds} 秒 · 运单较多时需要更长时间，请耐心等待。</p>
          </>}
        </div>
      )}

      {/* Matched batch summary */}
      <Card title="匹配批次">
        {r.matched_batches.length ? r.matched_batches.map((batch: any) => (
          <div key={batch.id} className="flex flex-wrap items-center gap-3 py-1 text-sm">
            <Link to="/admin/batches/$batchId" params={{batchId:batch.id}} className="font-mono text-brand hover:underline">{receivingBatchLabel(batch)}</Link>
            <StatusBadge map={BATCH_STATUS_LABEL} color={BATCH_STATUS_COLOR} value={batch.status} />
          </div>
        )) : <p className="text-sm text-slate-400">尚未匹配批次，扫描首件会自动匹配所属批次。</p>}
        <p className="mt-2 text-xs text-slate-400">可勾选多个已发货或已到件批次，也可扫描批次号追加匹配。扫描订单号仅在订单下恰有一个运单时有效，与扫描该运单号等效。多个运单的订单请逐单扫描。</p>
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
                  placeholder="运单号 / 单运单订单号 / 国内单号 / 箱号 / 托盘号"
                  className="min-w-0 flex-1 rounded-md border border-brand/40 bg-white/5 px-3 py-2.5 text-sm text-slate-100 focus:border-brand focus:outline-none"
                  autoComplete="off" />
                <button type="submit" disabled={!code.trim() || busy}
                  className="shrink-0 rounded-md bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-40">
                  确认加入
                </button>
              </form>
        <CameraScanButton disabled={busy} onScan={setCode} />
              <p className="mt-1.5 text-[11px] text-slate-500">扫描或手动确认托盘/箱号会同步确认内部明细；逐单扫描时，内部全部收齐后自动确认所属箱号/托盘。</p>
              <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                <button type="button" onClick={onMatchAll} disabled={busy || !r.batch_id}
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/20 disabled:opacity-40">
                  一键匹配全部到货
                </button>
                <p className="mt-2 text-[11px] text-slate-400">整批全部到齐时使用，包含内部明细，需连续确认两次。匹配后请点击上方「确认到件」完成收货。</p>
              </div>
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
              {(diff.extra_scans.length + issues.length) > 0 && (
                <a href="#receiving-differences" className="block rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200 hover:bg-amber-500/20">
                  <div className="font-semibold">多扫 / 差异（{diff.extra_scans.length + issues.length}）</div>
                  <div className="mt-1 text-xs">已识别多扫 {diff.extra_scans.length} 条 · 扫描错误 / 待核对 {issues.length} 条</div>
                  <div className="mt-2 text-xs underline">查看全部差异及操作 ↓</div>
                </a>
              )}
              {direct.waybills.length + direct.cartons.length + direct.pallets.length > 0
                && diff.missing_waybills.length === 0 && diff.missing_cartons.length === 0
                && diff.missing_pallets.length === 0 && diff.extra_scans.length === 0 && issues.length === 0 && (
                  <div className="rounded-md bg-emerald-500/10 p-2 text-xs text-emerald-300">✓ 直挂层全部匹配</div>
                )}
            </div>
          )}
        </Card>
      </div>

<div id="receiving-differences" className="scroll-mt-24">
      {(diff.extra_scans.length>0 || issues.length>0) && <Card title={`多扫 / 差异（${diff.extra_scans.length + issues.length}）`}>
        <p className="mb-3 text-xs text-amber-300">以下项目不属于当前匹配清单，暂不计入收货。单箱/单件合并仅纳入当前项及内部明细；整批次合并会加入所属批次并匹配整批到货。上方统计与未到清单同步更新，最后仍需确认到件。</p>
        <div className="mt-2 space-y-2">{diff.extra_scans.map((item:any)=><div key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/20 p-3 text-xs">
          <span className="break-all font-mono">{item.code}</span><span className="text-amber-300">不在本次匹配范围</span>
          <span className="text-sky-200">所属批次：{item.batch ? <Link to="/admin/batches/$batchId" params={{batchId:item.batch.id}} className="underline">{receivingBatchLabel(item.batch)}</Link> : '未分配批次'}</span>
          {item.carton_no && <span className="text-slate-300">箱号 {item.carton_no}</span>}
          {item.pallet_no && <span className="text-slate-300">托盘 {item.pallet_no}</span>}
          <span className="text-slate-400">{fmtDate(item.scanned_at)}</span>
          {!isFinal && <>
            <button disabled={busy} className="ml-auto rounded bg-emerald-600 px-3 py-2 disabled:opacity-50" onClick={async()=>{
              if(!window.confirm('合并 '+item.code+' 及内部明细到本次收货？原所属批次保持不变。'))return;
              setBusy(true);try{await mergeScan({data:{scanId:item.id}});await refresh();}catch(e:any){alert(e.message);}finally{setBusy(false);}
            }}>{item.kind==='carton'?'单箱合并':item.kind==='pallet'?'单托合并':'单件合并'}</button>
            <button disabled={busy || !item.batch} title={!item.batch?'未分配批次，不能整批合并':undefined} className="rounded bg-blue-600 px-3 py-2 disabled:opacity-40" onClick={async()=>{
              if(!item.batch || !window.confirm('整批次合并：将 '+receivingBatchLabel(item.batch)+' 加入本收货单，并将该批次全部托盘、箱号及运单匹配到货。其他批次保持不变。确认整批已到齐？'))return;
              setBusy(true);try{await mergeBatch({data:{scanId:item.id,batchId:item.batch.id}});await refresh();}catch(e:any){alert(e.message);await refresh();}finally{setBusy(false);}
            }}>整批次合并</button>
            <button disabled={busy} className="rounded border border-rose-500/40 px-3 py-2 text-rose-300 disabled:opacity-50" onClick={()=>onRemove(item.id)}>踢出去</button>
          </>}
        </div>)}</div>
        <div className="space-y-2">{[...issues].sort((a:any,b:any)=>Number(Boolean(b.matches?.length))-Number(Boolean(a.matches?.length))).map((item:any)=><div key={item.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-500/20 p-3 text-xs">
          <span className="break-all font-mono">{item.code}</span><span className="text-rose-300">{item.reason}</span>
          {item.matches?.map((match:any)=><div key={match.kind+match.ref_id} className="w-full rounded bg-white/5 p-2 text-sky-200">
            运单 {match.code} {match.carton_no && ' · 箱号 '+match.carton_no} {match.pallet_no && ' · 托盘 '+match.pallet_no}
            <span className="ml-2">所属批次：{match.batch ? <Link to="/admin/batches/$batchId" params={{batchId:match.batch.id}} className="underline">{receivingBatchLabel(match.batch)}</Link> : '未分配批次'}</span>
          </div>)}
          <span className="text-slate-400">{fmtDate(item.scanned_at)}</span>
          {!isFinal && <>
            <button disabled={busy} className="rounded bg-sky-600 px-3 py-2 disabled:opacity-50" onClick={()=>onScan(undefined,item.code)}>重新识别</button>
            <button disabled={busy} className="rounded border border-rose-500/40 px-3 py-2 text-rose-300" onClick={async()=>{
              if(!window.confirm('从差异中踢出 '+item.code+'？'))return;
              setBusy(true);try{await dismissIssue({data:{receivingId,code:item.code}});await refresh();}catch(e:any){alert(e.message);}finally{setBusy(false);}
            }}>踢出去</button>
          </>}
        </div>)}</div>
      </Card>}

</div>

      <Card title={`分级确认 / 扫描明细（已记录 ${scans.length} 项）`}>
        <p className="mb-3 text-xs text-slate-400">按批次展开托盘、箱号和运单。确认容器会同步内部全部明细，逐单收齐后自动确认上层。撤销容器会撤销内部确认。</p>
        <ReceivingHierarchy batches={r.hierarchy_batches} expected={expected} scans={scans} disabled={isFinal || busy}
          onConfirm={value => onScan(undefined,value)} onRemove={onRemove} />
      </Card>

      <Card title="备注">
        <NotesEditor initial={r.notes ?? ""} disabled={isFinal || busy} onSave={onSaveNotes} />
      </Card>

      {showMatch && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0A0F1A] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold inline-flex items-center gap-2"><ScanLine className="h-4 w-4 text-brand" />匹配多个批次</h2>
              <button onClick={() => setShowMatch(false)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {batchesQ.data?.batches.filter((b: any) => ['shipped','arrived'].includes(b.status) || r.batch_ids.includes(b.id)).map((b: any) => (
                <label key={b.id} className="flex items-start gap-2 rounded-md border border-white/10 p-2 text-sm">
                  <input type="checkbox" checked={pickBatchIds.includes(b.id)} onChange={e => setPickBatchIds(ids => e.target.checked ? [...ids,b.id] : ids.filter(id => id !== b.id))} />
                  <span>{receivingBatchLabel(b)} · {BATCH_STATUS_LABEL[b.status]}</span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">已选择 {pickBatchIds.length} 个批次，取消全部勾选可解除匹配。</p>
            <button disabled={busy} onClick={onMatch} className="mt-3 w-full rounded-md bg-brand py-2 text-sm font-semibold text-white hover:bg-brand/90">保存</button>
          </div>
        </div>
      )}

<EntityActionLogs entityType="receiving" entityId={receivingId} />
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
