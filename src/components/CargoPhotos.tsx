import {preparePhoto} from '@/lib/prepare-photo';
import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useServerFn} from '@tanstack/react-start';
import {listCargoPhotos,uploadCargoPhoto} from '@/lib/cargo-photos.functions';
import {useDriverLanguage} from '@/lib/driver-language';
import {useAuth} from '@/lib/auth';

export function CargoPhotos({kind,refId,canUpload=false}:{kind:'carton'|'waybill'|'pallet';refId:string;canUpload?:boolean}){
 const {t:tr}=useDriverLanguage(),{user}=useAuth();
 const list=useServerFn(listCargoPhotos),upload=useServerFn(uploadCargoPhoto);
 const q=useQuery({queryKey:['cargo-photos',user?.id,kind,refId],queryFn:()=>list({data:{kind,refId}}),staleTime:60000,refetchInterval:300000});
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[zoom,setZoom]=useState<string|null>(null);const lock=useRef(false);
 const photo=async(file?:File)=>{
  if(!file||lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   await upload({data:{kind,refId,photoId:crypto.randomUUID(),image:await preparePhoto(file)}});await q.refetch();
  }catch(e:any){setError(tr(e.message));}finally{lock.current=false;setBusy(false);}
 };
 return <div className="my-2 space-y-2 text-xs">
  <p className="font-semibold text-slate-300">{tr('货物照片')}</p>
  <div className="space-y-1">{q.data?.map(p=><button type="button" key={p.id} onClick={()=>setZoom(p.url)} className="block max-w-full break-all text-left text-sky-400 underline">{p.name || `${tr("货物照片")}.jpg`}</button>)}</div>
  {q.isLoading?<p>{tr('读取中…')}</p>:!q.isError&&!q.data?.length&&<p className="text-slate-400">{tr('暂无货物照片')}</p>}
  {canUpload&&<div className="flex flex-wrap gap-2">{[true,false].map(camera=><label key={String(camera)} className="cursor-pointer rounded-lg border border-sky-400/40 px-3 py-2 text-sky-300">{tr(camera?'拍照上传':'选择照片')}<input type="file" accept="image/*" capture={camera?'environment':undefined} className="sr-only" disabled={busy} onChange={e=>{void photo(e.target.files?.[0]);e.target.value='';}}/></label>)}</div>}
  {busy&&<p role="status">{tr('正在保存…')}</p>}{(error||q.isError)&&<p role="alert" className="text-rose-300">{error||tr('货物照片读取失败')}</p>}
  {zoom&&<dialog ref={el=>{if(el&&!el.open)el.showModal();}} onCancel={()=>setZoom(null)} aria-label={tr('放大货物照片')} className="m-auto w-full max-w-4xl rounded-xl bg-slate-950 p-4 text-white backdrop:bg-black/80"><button type="button" autoFocus onClick={()=>setZoom(null)} className="mb-3 rounded border border-white/20 px-4 py-2">{tr('关闭')}</button><img src={zoom} alt={tr('货物照片')} className="max-h-[80dvh] w-full object-contain"/></dialog>}
 </div>;
}
