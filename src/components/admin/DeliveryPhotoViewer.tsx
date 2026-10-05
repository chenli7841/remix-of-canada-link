import { useState } from 'react';
export function DeliveryPhotoViewer({items}: {items: {id:string;code:string;delivery_photo_urls?: unknown}[]}) {
 const photos=items.flatMap(it=>(Array.isArray(it.delivery_photo_urls)?it.delivery_photo_urls:[])
   .filter((url):url is string=>typeof url==='string' && /^https?:\/\//i.test(url))
   .map(url=>({url,code:it.code,id:it.id})));
 const [selected,setSelected]=useState<number|null>(null);
 const photo=selected === null ? null : photos[selected];
 return <section className="mb-4 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
 <h2 className="mb-3 text-sm font-semibold">派送照片（{photos.length}）</h2>
 {!photos.length ? <p className="text-xs text-slate-400">暂无派送照片</p> : <div className="flex flex-wrap gap-3">{photos.map((p,i)=><button key={p.id+':'+i} onClick={()=>setSelected(i)} className="text-left"><img src={p.url} alt={p.code+' 派送照片 '+(i+1)} loading="lazy" referrerPolicy="no-referrer" className="h-24 w-24 rounded object-cover"/><span className="text-xs">{p.code}</span></button>)}</div>}
 {photo && <dialog ref={el=>{if(el&&!el.open)el.showModal();}} onCancel={()=>setSelected(null)} aria-label="查看派送照片" className="m-auto w-full max-w-4xl rounded-xl border border-white/20 bg-slate-950 p-4 text-white backdrop:bg-black/80">
 <div className="mb-3 flex items-center justify-between"><span>{photo.code} · {(selected??0)+1}/{photos.length}</span><button autoFocus onClick={()=>setSelected(null)}>关闭</button></div>
 <img src={photo.url} alt={photo.code+' 派送照片'} referrerPolicy="no-referrer" className="max-h-[75vh] w-full object-contain"/>
 <div className="mt-3 flex justify-between"><button disabled={selected===0} onClick={()=>setSelected(i=>Math.max(0,(i??0)-1))}>上一张</button><button disabled={selected===photos.length-1} onClick={()=>setSelected(i=>Math.min(photos.length-1,(i??0)+1))}>下一张</button></div>
 </dialog>}
 </section>;
}
