import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { saveDeliveryExtraFee } from '@/lib/batch-customer-notes.functions';

export function DeliveryExtraFeeEditor({group, onClose, onSaved}: {group:any; onClose:()=>void; onSaved:()=>Promise<unknown>}) {
  const save = useServerFn(saveDeliveryExtraFee);
  const [value,setValue] = useState(Number(group.fee_cny || 0).toFixed(2));
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  return <Dialog open onOpenChange={open=>{if(!open && !busy)onClose();}}><DialogContent className="w-[calc(100%-2rem)] rounded-xl border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
    <DialogTitle className="text-white">修改额外费用</DialogTitle><DialogDescription className="text-slate-300">客户 {group.customer_code} · 批次 {group.batch_no}。保存金额不会扣款。</DialogDescription>
    <form onSubmit={async e=>{e.preventDefault();if(busy)return;if(!/^\d+(\.\d{1,2})?$/.test(value.trim())){setError('请输入非负金额，最多两位小数');return;}setBusy(true);setError('');try{await save({data:{batchId:group.batch_id,customerCode:group.customer_code,amountCny:Number(value)}});await onSaved();onClose();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>
      <label className="text-slate-200">额外费用（人民币 CNY）<input autoFocus inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-950 px-3 py-2.5 text-base font-medium text-white caret-sky-400 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"/></label>
      {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
      <div className="mt-5 flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="min-h-11 rounded-lg border border-slate-600 bg-slate-800 px-4 text-slate-100 hover:bg-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-50">取消</button><button disabled={busy} className="min-h-11 rounded-lg bg-sky-600 px-5 font-medium text-white hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:opacity-50">{busy?'保存中…':'保存'}</button></div>
    </form>
  </DialogContent></Dialog>;
}
