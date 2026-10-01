import { useEffect, useState } from 'react';
import { useServerFn } from '@tanstack/react-start';
import { saveReturnReminder } from '@/lib/intake-reminder.functions';

export function ReturnReminderEditor({row,onSaved}:{row:any;onSaved:()=>Promise<unknown>}) {
  const save=useServerFn(saveReturnReminder);
  const [enabled,setEnabled]=useState(!!row.return_reminder);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{setEnabled(!!row.return_reminder);setMessage('');},[row.id,row.return_reminder]);
  return <div className="mt-3 border-t border-white/10 pt-3">
    <label className="flex items-center gap-2 text-sm text-amber-300"><input type="checkbox" disabled={busy} checked={enabled} onChange={e=>{setEnabled(e.target.checked);setMessage('');}}/>退运提醒</label>
    <p className="my-2 text-xs text-slate-400">入库、加入箱号、托盘或批次时提示；包含此包裹的箱号、托盘继续流转时也会提示。说明使用已保存的订单备注。</p>
    <button type="button" disabled={busy} className="rounded bg-brand px-3 py-1.5 text-xs text-white disabled:opacity-50" onClick={async()=>{setBusy(true);setMessage('');try{await save({data:{id:row.id,enabled}});await onSaved();setMessage('退运提醒已保存');}catch(e){setMessage(e instanceof Error?e.message:'保存失败');}finally{setBusy(false);}}}>保存退运提醒</button>
    {message&&<p role="status" className="mt-2 text-xs text-amber-200">{message}</p>}
  </div>;
}
