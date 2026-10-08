import {useRef,useState} from 'react';
import {useServerFn} from '@tanstack/react-start';
import {useQuery} from '@tanstack/react-query';
import {Dialog,DialogContent,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {listAssignableDrivers,assignDeliveryTrip} from '@/lib/admin-driver-trips.functions';
import {listDriverOrigins} from '@/lib/delivery-route.functions';
export function AssignDriverTrip({keys,onClose,onDone}:{keys:string[];onClose:()=>void;onDone:()=>void}) {
 const list=useServerFn(listAssignableDrivers),originsFn=useServerFn(listDriverOrigins),assign=useServerFn(assignDeliveryTrip);
 const drivers=useQuery({queryKey:['assignable-drivers'],queryFn:()=>list()});
 const origins=useQuery({queryKey:['driver-origins'],queryFn:()=>originsFn()});
 const [driverId,setDriver]=useState(''),[originId,setOrigin]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef(crypto.randomUUID()),lock=useRef(false);
 const submit=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await assign({data:{id:request.current,driverId,originId,keys}});onDone();}catch(e:any){setError(e.message||'生成失败，请重试');}finally{lock.current=false;setBusy(false);}};
 const input='mt-2 min-h-11 w-full rounded-lg border border-border bg-background p-2';
 return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose();}}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogTitle>生成司机派送趟</DialogTitle><DialogDescription>已勾选 {keys.length} 个客户批次。保存到所选司机的“司机派送”，不分配上车序号，不会扣款或确认派送。</DialogDescription>
 <label>司机<select className={input} disabled={busy} value={driverId} onChange={e=>{setDriver(e.target.value);request.current=crypto.randomUUID();}}><option value="">请选择司机</option>{drivers.data?.map(d=><option key={d.id} value={d.id}>{d.full_name||d.id}</option>)}</select></label>
 <label>起始点<select className={input} disabled={busy} value={originId} onChange={e=>{setOrigin(e.target.value);request.current=crypto.randomUUID();}}><option value="">请选择起始点</option>{origins.data?.filter(o=>o.active).map(o=><option key={o.id} value={o.id}>{o.name} · {o.address}</option>)}</select></label>
 {drivers.isSuccess&&!drivers.data.length&&<p>暂无司机，请先在员工管理分配司机角色。</p>}
 {origins.isSuccess&&!origins.data.some(o=>o.active)&&<p>暂无启用的起始点，请先在仓库管理设置。</p>}
 <p className="text-xs text-muted-foreground">按当前列表顺序保存线路；同地址合并站点，超过 21 个地点分段连续派送。</p>
 {(error||drivers.error||origins.error)&&<p role="alert" className="text-red-400">{error||drivers.error?.message||origins.error?.message}</p>}
 <div className="flex justify-end gap-3"><button disabled={busy} onClick={onClose}>取消</button><button disabled={busy||!driverId||!originId} className="min-h-11 rounded-lg bg-brand px-4 text-white disabled:opacity-50" onClick={()=>void submit()}>{busy?'正在生成…':'确认生成'}</button></div>
 </DialogContent></Dialog>;
}
