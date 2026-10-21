import { LoadingUnitList } from "@/components/LoadingUnitList";
import { NewLoadedTrip, LoadedTripActions } from "./LoadedTripActions";
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useQuery } from '@tanstack/react-query';
import { listAdminLoadedTrips } from '@/lib/admin-driver-trips.functions';

export function LoadedDeliveryTrips({search}: {search:string}) {
  const fetchTrips = useServerFn(listAdminLoadedTrips);
  const [showCompleted,setShowCompleted] = useState(false);
  const q = useQuery({queryKey:['admin-loaded-trips'],queryFn:()=>fetchTrips(),staleTime:0,refetchOnWindowFocus:true});
  const trips = q.data ?? [];
  const completedCount = trips.filter(t=>t.total>0 && t.completed===t.total).length;
  const needle = search.trim().toLowerCase();
  const visible = trips.filter(t=>(showCompleted || t.total===0 || t.completed<t.total) && (!needle ||
    [t.driver_name,t.created_at,...t.items.flatMap((i:any)=>[i.unit.code,i.unit.customer_code,i.unit.batch?.batch_no,i.unit.batch?.display_name])].join(' ').toLowerCase().includes(needle)));
  return <section className="space-y-3">
    <NewLoadedTrip/>
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-300">
      <span>{visible.length} 趟 · 按创建时间从早到晚排列</span>
      <button type="button" onClick={()=>setShowCompleted(v=>!v)} className="rounded border border-white/20 px-3 py-2">{showCompleted?'隐藏已全部派送的趟':`显示已全部派送的趟（${completedCount}）`}</button>
    </div>
    {q.isLoading && <p className="text-slate-400">正在读取上车清单…</p>}
    {q.isError && <div role="alert" className="text-red-300">读取失败：{q.error.message} <button onClick={()=>void q.refetch()} className="underline">重试</button></div>}
    {!q.isLoading && !q.isError && !visible.length && <p className="py-8 text-center text-slate-400">暂无符合条件的派送趟</p>}
    {visible.map(trip=><details key={trip.id} className="overflow-hidden rounded-xl border border-white/10 bg-slate-900">
      <summary className="cursor-pointer p-4 text-slate-100">
        <span className="font-semibold">{trip.driver_name || '未命名司机'} · {new Date(trip.created_at).toLocaleString('zh-CN')}</span>
        <span className="ml-3 text-xs text-slate-400">{trip.source==='admin'?'后台分配':'扫码上车'}</span>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm"><span className="text-emerald-300">已派送 {trip.completed}</span><span className="text-amber-300">未派送 {trip.pending}</span><span>总单 {trip.total}</span>{trip.cancelled>0 && <span className="text-slate-400">已取消 {trip.cancelled}</span>}</div>
      </summary>
      <LoadedTripActions trip={trip}/>
    </details>)}
  </section>;
}
