import {useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useServerFn} from '@tanstack/react-start';
import {listDriverOrigins,saveDriverOrigin,type DriverOrigin} from '@/lib/delivery-route.functions';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';

export function DriverOriginSettings({canEdit}:{canEdit:boolean}) {
  const list=useServerFn(listDriverOrigins),save=useServerFn(saveDriverOrigin),qc=useQueryClient();
  const q=useQuery({queryKey:['driver-origins'],queryFn:()=>list()});
  const [draft,setDraft]=useState<DriverOrigin|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <section className="mt-6 rounded-2xl border border-white/10 p-5">
    <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">司机起始点</h2>{canEdit&&<button className="rounded bg-brand px-3 py-2 text-sm text-white" onClick={()=>{setError('');setDraft({id:crypto.randomUUID(),name:'',address:'',active:true});}}>新增起始点</button>}</div>
    <p className="my-2 text-sm text-slate-400">专供派送路线选择的出发地址，可设置多个。请填写街道、城市、省份和邮编。</p>
    {q.isLoading&&<p>读取中…</p>}{q.isError&&<p role="alert">{q.error.message}</p>}
    {q.isSuccess&&!q.data.length&&<p className="text-sm text-slate-400">尚未设置司机起始点</p>}
    <div className="space-y-2">{q.data?.map(point=><div className="flex justify-between gap-4 rounded border border-white/10 p-3" key={point.id}><div><b>{point.name}</b><span className="ml-3 text-xs">{point.active?'启用':'停用'}</span><p className="text-sm text-slate-400">{point.address}</p></div>{canEdit&&<button className="text-sm text-sky-400" onClick={()=>{setError('');setDraft(point);}}>编辑</button>}</div>)}</div>
    <Dialog open={!!draft} onOpenChange={open=>{if(!open&&!busy)setDraft(null);}}><DialogContent><DialogTitle>司机起始点设置</DialogTitle><DialogDescription>保存后可在“生成派送单”中选择，停用后不再出现在新派送单的选择列表。</DialogDescription>{draft&&<form className="space-y-3" onSubmit={async e=>{e.preventDefault();if(busy)return;setBusy(true);setError('');try{await save({data:draft});await qc.invalidateQueries({queryKey:['driver-origins']});setDraft(null);}catch(e:any){setError(e.message||'保存失败');}finally{setBusy(false);}}}>
      <fieldset disabled={busy} className="space-y-3"><label className="block">名称<input required maxLength={100} className="mt-1 w-full rounded border bg-background p-2" value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})}/></label><label className="block">完整起始地址<textarea required maxLength={500} rows={3} className="mt-1 w-full rounded border bg-background p-2" value={draft.address} onChange={e=>setDraft({...draft,address:e.target.value})}/></label><label className="flex items-center gap-2"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>启用</label></fieldset>
      {error&&<p role="alert" className="text-red-500">{error}</p>}<button disabled={busy} type="submit" className="rounded bg-brand px-4 py-2 text-white">{busy?'保存中…':'保存起始点'}</button></form>}</DialogContent></Dialog>
  </section>;
}
