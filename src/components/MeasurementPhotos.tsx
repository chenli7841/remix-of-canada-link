import {useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useServerFn} from '@tanstack/react-start';
import {getMeasurementPhotoTargets,saveMeasurementPhotos} from '@/lib/measurement-photos.functions';
import {preparePhoto} from '@/lib/prepare-photo';
import {CargoPhotos} from './CargoPhotos';
import {OrderAttachments} from './order-attachments';
import {useAuth} from '@/lib/auth';
type Kind='waybill'|'carton'|'pallet'|'inspection';
export function MeasurementPhotos({waybillId}:{waybillId:string}){
 const [open,setOpen]=useState(false);
 return <div className="my-2"><button type="button" className="rounded border border-sky-400/40 px-2 py-1 text-xs text-sky-300" onClick={()=>setOpen(true)}>照片分类 / 拍照上传</button>{open&&<dialog ref={el=>{if(el&&!el.open)el.showModal();}} onCancel={e=>e.preventDefault()} className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-xl bg-slate-900 p-4 text-slate-100 backdrop:bg-black/70"><PhotoManager waybillId={waybillId} onClose={()=>setOpen(false)}/></dialog>}</div>;
}
function PhotoManager({waybillId,onClose}:{waybillId:string;onClose:()=>void}){
 const {user}=useAuth(),cache=useQueryClient();
 const read=useServerFn(getMeasurementPhotoTargets),save=useServerFn(saveMeasurementPhotos);
 const q=useQuery({queryKey:['measurement-photo-targets',user?.id,waybillId],queryFn:()=>read({data:{waybillId}})});
 const [selected,setSelected]=useState<Kind[]>(['waybill']),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [draft,setDraft]=useState<{photoId:string;image:string;targets:Kind[]}|null>(null);
 const [results,setResults]=useState<{kind:string;label:string;ok:boolean;error?:string}[]>([]),[version,setVersion]=useState(0);
 const lock=useRef(false);
 async function submit(photo:NonNullable<typeof draft>,targets:Kind[]){
  const rows=await save({data:{waybillId,...photo,targets}});
  setResults(previous=>[...previous.filter(x=>!rows.some(y=>y.kind===x.kind)),...rows]);
  await cache.invalidateQueries({queryKey:['cargo-photos']});setVersion(v=>v+1);
  return rows;
 }
 async function take(file?:File){
  if(!file||lock.current)return;
  lock.current=true;setBusy(true);setError('');setResults([]);setDraft(null);
  try{const photo={photoId:crypto.randomUUID(),image:await preparePhoto(file),targets:[...selected]};setDraft(photo);await submit(photo,photo.targets);}
  catch(e:any){setError(e.message||'保存失败');}finally{lock.current=false;setBusy(false);}
 }
 async function retry(){
  if(!draft||lock.current)return;lock.current=true;setBusy(true);setError('');
  try{await submit(draft,draft.targets.filter(k=>!results.some(r=>r.kind===k&&r.ok)));}
  catch(e:any){setError(e.message||'保存失败');}finally{lock.current=false;setBusy(false);}
 }
 return <div className="space-y-3 text-sm">
  <div className="flex justify-between gap-3"><h2 className="font-bold">照片分类 · 一次拍摄，多位置保存</h2><button type="button" disabled={busy} onClick={onClose} className="rounded border px-3 py-2">关闭</button></div>
  <p>勾选照片保存的位置。每次拍摄新增一张，不覆盖已有照片。</p>
  {q.isLoading&&<p>正在读取关联包裹…</p>}{q.isError&&<p role="alert">{q.error.message}</p>}
  {q.data?.map(t=><label key={t.kind} className="flex items-center gap-2"><input type="checkbox" disabled={busy} checked={selected.includes(t.kind)} onChange={e=>setSelected(old=>e.target.checked?[...old,t.kind]:old.filter(k=>k!==t.kind))}/>{t.label}</label>)}
  {selected.includes('inspection')&&<p className="text-amber-300">内件核对照片将显示在客户订单下方。</p>}
  <div className="flex flex-wrap gap-3">{[true,false].map(camera=><label key={String(camera)} className="rounded border border-blue-400 px-3 py-2 text-blue-300">{camera?'拍照并保存到勾选位置':'选择照片并保存到勾选位置'}<input className="sr-only" type="file" accept="image/*" capture={camera?'environment':undefined} disabled={busy||!selected.length||!q.data} onChange={e=>{const file=e.target.files?.[0];e.target.value='';void take(file);}}/></label>)}</div>
  {busy&&<p role="status">正在保存，请勿关闭…</p>}{error&&<p role="alert" className="text-rose-300">{error}</p>}
  {results.map(r=><p key={r.kind} className={r.ok?'text-emerald-300':'text-rose-300'}>{r.label}：{r.ok?'已保存':r.error}</p>)}
  {draft&&!busy&&(error||results.some(r=>!r.ok))&&<button type="button" className="rounded border px-3 py-2" onClick={()=>void retry()}>重试未成功的位置</button>}
  {q.data?.map(t=><details key={t.kind} className="rounded border border-white/15 p-3"><summary className="cursor-pointer">{t.label} · 查看 / 单独上传</summary>{t.kind==='inspection'?<OrderAttachments key={version} ownerKind={t.ownerKind!} ownerId={t.refId} lang="zh"/>:<CargoPhotos kind={t.kind} refId={t.refId} canUpload disabled={busy}/>}</details>)}
 </div>;
}
