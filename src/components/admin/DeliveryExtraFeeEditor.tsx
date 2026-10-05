import { useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { saveDeliveryExtraFee } from '@/lib/batch-customer-notes.functions';

export function DeliveryExtraFeeEditor({group, onClose, onSaved}: {group:any; onClose:()=>void; onSaved:()=>Promise<unknown>}) {
  const save = useServerFn(saveDeliveryExtraFee);
  const [value,setValue] = useState(Number(group.fee_cny || 0).toFixed(2));
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  return <Dialog open onOpenChange={open=>{if(!open && !busy)onClose();}}><DialogContent>
    <DialogTitle>修改额外费用</DialogTitle><DialogDescription>客户 {group.customer_code} · 批次 {group.batch_no}。保存金额不会扣款。</DialogDescription>
    <form onSubmit={async e=>{e.preventDefault();if(busy)return;if(!/^\d+(\.\d{1,2})?$/.test(value.trim())){setError('请输入非负金额，最多两位小数');return;}setBusy(true);setError('');try{await save({data:{batchId:group.batch_id,customerCode:group.customer_code,amountCny:Number(value)}});await onSaved();onClose();}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>
      <label>额外费用（人民币 CNY）<input autoFocus inputMode="decimal" value={value} onChange={e=>setValue(e.target.value)} className="mt-2 w-full rounded border border-white/20 bg-slate-900 p-2"/></label>
      {error && <p role="alert" className="mt-2 text-rose-300">{error}</p>}
      <div className="mt-4 flex justify-end gap-4"><button type="button" disabled={busy} onClick={onClose}>取消</button><button disabled={busy} className="text-brand">{busy?'保存中…':'保存'}</button></div>
    </form>
  </DialogContent></Dialog>;
}
