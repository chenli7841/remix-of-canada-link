import type { ReactNode } from 'react';
import { receivingBatchLabel } from '@/lib/receiving-labels';
import { fmtDate } from '@/lib/admin-shared';

type Node = { kind:string; id:string; code:string; batchId:string|null; children:Node[] };
export function ReceivingHierarchy({batches,expected,scans,disabled,onConfirm,onRemove}: {
  batches:any[]; expected:{waybills:any[];cartons:any[];pallets:any[]}; scans:any[]; disabled:boolean;
  onConfirm:(code:string)=>Promise<void>; onRemove:(id:string)=>Promise<void>;
}) {
  const pallets = new Map<string,Node>(expected.pallets.map(p => [p.id,{kind:'pallet',id:p.id,code:p.pallet_no,batchId:p.batch_id,children:[]}]));
  const cartons = new Map<string,Node>();
  const roots:Node[]=[...pallets.values()];
  for (const c of expected.cartons) {
    const parent=pallets.get(c.pallet_id);
    const node:Node={kind:'carton',id:c.id,code:c.carton_no,batchId:parent?.batchId ?? c.batch_id,children:[]};
    cartons.set(c.id,node);
    if(parent)parent.children.push(node);else roots.push(node);
  }
  for (const w of expected.waybills) {
    const parent=cartons.get(w.carton_id) ?? pallets.get(w.pallet_id);
    const node:Node={kind:'waybill',id:w.id,code:w.waybill_no,batchId:parent?.batchId ?? w.assigned_batch_id,children:[]};
    if(parent)parent.children.push(node);else roots.push(node);
  }
  const scansByKey=new Map(scans.map(s=>[s.kind+':'+s.ref_id,s]));
  const labels:Record<string,string>={pallet:'托盘',carton:'箱号',waybill:'运单'};
  function progress(nodes:Node[]):{done:number;total:number} {
    return nodes.reduce((sum,node)=>{const child=progress(node.children);return {done:sum.done+child.done+(scansByKey.has(node.kind+':'+node.id)?1:0),total:sum.total+child.total+1}}, {done:0,total:0});
  }
  function render(node:Node,batchLabel:string):ReactNode {
    const scan=scansByKey.get(node.kind+':'+node.id);
    const counts=progress(node.children);
    const heading=<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-2 text-xs">
      <span className="text-slate-400">{labels[node.kind]}</span><span className="break-all font-mono text-slate-100">{node.code}</span>
      <span className={scan?'text-emerald-300':'text-amber-300'}>{scan?'已确认':'待确认'}</span>
      {counts.total>0 && <span className="text-slate-400">内部 {counts.done}/{counts.total}</span>}
      <span className="ml-auto max-w-52 break-words text-sky-300" title="所属批次">{batchLabel}</span>
      {scan && <span className="text-slate-500">{fmtDate(scan.scanned_at)}</span>}
      {!disabled && <button type="button" onClick={e=>{e.preventDefault();e.stopPropagation();void (scan?onRemove(scan.id):onConfirm(node.code));}}
        className={'rounded border px-2 py-1 '+(scan?'border-rose-500/30 text-rose-300':'border-emerald-500/40 bg-emerald-500/10 text-emerald-200')}>
        {scan?'撤销':'手动确认'}
      </button>}
    </div>;
    return node.children.length ? <details key={node.kind+node.id} className="rounded border border-white/10 px-2">
      <summary className="flex cursor-pointer items-center gap-2"><span className="text-slate-400">▸</span>{heading}</summary>
      <div className="ml-2 space-y-1 border-l border-white/10 pl-2 pb-2">{node.children.map(child=>render(child,batchLabel))}</div>
    </details> : <div key={node.kind+node.id} className="rounded border border-white/5 px-2">{heading}</div>;
  }
  return <div className="space-y-3">
    <div className="flex justify-between text-xs text-slate-400"><span>托盘 / 箱号 / 运单 · 确认状态</span><span>所属批次 / 确认时间 / 操作</span></div>
    {[...batches,...[...new Set(roots.map(n=>n.batchId).filter(id=>!batches.some(b=>b.id===id)))].map(id=>({id,batch_no:'额外合并',display_name:'额外合并（保留原批次）'}))].map(batch=>{const nodes=roots.filter(n=>n.batchId===batch.id);const counts=progress(nodes);const label=receivingBatchLabel(batch);
      return <details key={batch.id} open className="rounded-xl border border-sky-500/20 bg-sky-500/5 p-3">
        <summary className="cursor-pointer text-sm font-semibold text-sky-200">{label} · 已确认 {counts.done}/{counts.total}</summary>
        <div className="mt-2 max-h-[36rem] space-y-2 overflow-y-auto">{nodes.map(node=>render(node,label))}</div>
      </details>;
    })}
    {!batches.length && <p className="text-xs text-slate-400">匹配批次后显示分级清单。</p>}
  </div>;
}
