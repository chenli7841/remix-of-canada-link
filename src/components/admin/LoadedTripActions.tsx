import {LoadingUnitList} from "@/components/LoadingUnitList";
import {useRef,useState} from 'react';
import {useServerFn} from '@tanstack/react-start';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {createDriverTrip,scanDriverTrip,generateDriverRoute,deleteEmptyDriverTrip} from '@/lib/driver-trips.functions';
import {listAssignableDrivers} from '@/lib/admin-driver-trips.functions';
import {listDriverOrigins} from '@/lib/delivery-route.functions';
import {CameraScanButton} from './CameraScanButton';
const field='min-h-11 rounded-lg border border-white/20 bg-slate-900 p-2 text-white';
export function NewLoadedTrip(){
 const create=useServerFn(createDriverTrip),list=useServerFn(listAssignableDrivers),qc=useQueryClient();
 const drivers=useQuery({queryKey:['assignable-drivers'],queryFn:()=>list()});
 const [driverId,setDriver]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const id=useRef(crypto.randomUUID()),lock=useRef(false);
 return <div className="mb-4 rounded-xl border border-white/10 p-3"><div className="flex flex-wrap gap-2"><select aria-label="新趟司机" className={field} value={driverId} disabled={busy} onChange={e=>{setDriver(e.target.value);id.current=crypto.randomUUID();}}><option value="">选择司机</option>{drivers.data?.map(d=><option key={d.id} value={d.id}>{d.full_name}</option>)}</select><button disabled={!driverId||busy} className={field+' bg-blue-600 disabled:opacity-40'} onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await create({data:{id:id.current,driverId}});id.current=crypto.randomUUID();await qc.invalidateQueries({queryKey:['admin-loaded-trips']});}catch(e:any){setError(e.message);}finally{lock.current=false;setBusy(false);}}}>新建上车趟次</button></div>{(error||drivers.error)&&<p role="alert" className="text-red-300">{error||drivers.error?.message}</p>}</div>;
}
export function LoadedTripActions({trip}:{trip:any}){
 const [selected,setSelected]=useState<Set<string>>(new Set());const request=useRef(crypto.randomUUID());
 const choose=(ids:string[],checked:boolean)=>{request.current=crypto.randomUUID();setSelected(old=>{const n=new Set(old);ids.forEach(id=>checked?n.add(id):n.delete(id));return n;});};
 const scan=useServerFn(scanDriverTrip),generate=useServerFn(generateDriverRoute),remove=useServerFn(deleteEmptyDriverTrip),originsFn=useServerFn(listDriverOrigins),qc=useQueryClient();
 const origins=useQuery({queryKey:['driver-origins'],queryFn:()=>originsFn()});
 const [code,setCode]=useState(''),[originId,setOrigin]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[maps,setMaps]=useState<string[]>([]);
 const lock=useRef(false);
 const refresh=()=>qc.invalidateQueries({queryKey:['admin-loaded-trips']});
 const add=async(value:string)=>{if(lock.current)throw Error('正在保存，请稍后重扫');lock.current=true;setBusy(true);setError('');try{const r=await scan({data:{tripId:trip.id,code:value.trim()}});setMessage(r.duplicate?'该单位已在此趟':`${r.transferred?'已从原趟转入，序号':'上车成功，序号'} ${r.sequence}`);setCode('');setMaps([]);await refresh();}catch(e:any){setError(e.message);throw e;}finally{lock.current=false;setBusy(false);}};
 return <div className="space-y-3 border-t border-white/10 p-3">
 <form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();void add(code).catch(()=>{});}}><input className={field+' min-w-0 flex-1'} aria-label="上车条码" placeholder="箱号 / 运单号 / 订单号 / 国内单号" value={code} onChange={e=>setCode(e.target.value)}/><button className={field} disabled={busy||!code.trim()}>加入</button></form>
 <CameraScanButton continuous onScan={add}/>

 <div className="flex flex-wrap gap-2"><select aria-label="司机起始点" className={field+' max-w-full'} value={originId} onChange={e=>setOrigin(e.target.value)}><option value="">选择司机起始点</option>{origins.data?.filter(o=>o.active).map(o=><option key={o.id} value={o.id}>{o.name} · {o.address}</option>)}</select><button className={field} disabled={busy||!originId||!selected.size} onClick={async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{const r=await generate({data:{tripId:trip.id,originId,ids:[...selected],runId:request.current}});setMaps(r.maps.filter((m):m is string=>!!m));setMessage('司机派送趟已生成');setSelected(new Set());request.current=crypto.randomUUID();await refresh();}catch(e:any){setError(e.message);}finally{lock.current=false;setBusy(false);}}}>生成司机派送趟</button>
 {trip.total===0&&<button className={field+' text-red-300'} disabled={busy} onClick={async()=>{if(!confirm('确认删除这个空趟？')||lock.current)return;lock.current=true;setBusy(true);try{await remove({data:{tripId:trip.id}});await refresh();}catch(e:any){setError(e.message);}finally{lock.current=false;setBusy(false);}}}>删除空趟</button>}</div>
 {message&&<p role="status" className="text-emerald-300">{message}</p>}{(error||origins.error)&&<p role="alert" className="text-red-300">{error||origins.error?.message}</p>}
 <LoadingUnitList items={trip.items} selected={selected} onSelect={choose}/>
 {maps.map((map,i)=><img key={i} src={map} alt={`第 ${i+1} 段派送线路`} className="w-full rounded-lg"/>)}
 </div>;
}
