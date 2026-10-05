import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useServerFn } from '@tanstack/react-start';
import { listBatchCustomerNotes, saveBatchCustomerNote } from '@/lib/batch-customer-notes.functions';
export function BatchCustomerNote({batchId, customerCode, readOnly = false}: {batchId: string; customerCode: string; readOnly?: boolean}) {
 const read = useServerFn(listBatchCustomerNotes), save = useServerFn(saveBatchCustomerNote), qc = useQueryClient();
 const key = ['batch-customer-notes',batchId];
 const q = useQuery({queryKey:key,queryFn:()=>read({data:{batchId}}),staleTime:30000});
 const [draft,setDraft] = useState<string|null>(null), [busy,setBusy] = useState(false), [error,setError]=useState('');
 const value=q.data?.find(r=>r.customer_code===customerCode)?.note || '';
 return <div className="min-w-40 max-w-64 text-xs" onClick={e=>e.stopPropagation()}>
 {draft === null ? <><p className="whitespace-pre-wrap text-slate-300">{q.isError ? '备注读取失败' : q.isLoading ? '加载备注…' : value || '—'}</p>
 {!readOnly && <button disabled={!q.isSuccess} className="mt-1 text-brand disabled:opacity-40" onClick={()=>setDraft(value)}>编辑备注</button>}</> : <>
 <textarea aria-label="结算备注" maxLength={2000} rows={2} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="例如：现金结算" className="w-full rounded border border-white/10 bg-slate-900 p-2" />
 <button disabled={busy} className="mr-2 text-brand" onClick={async()=>{setBusy(true);setError('');try{await save({data:{batchId,customerCode,note:draft}});await qc.invalidateQueries({queryKey:key});setDraft(null);}catch(e:any){setError(e.message);}finally{setBusy(false);}}}>{busy?'保存中…':'保存'}</button>
 <button disabled={busy} onClick={()=>{setDraft(null);setError('');}}>取消</button></>}
 {error && <p className="text-rose-300">{error}</p>}</div>;
}
