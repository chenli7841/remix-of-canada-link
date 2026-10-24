import {groupLoadingUnits} from '@/lib/loading-unit-groups';
import {useDriverLanguage} from '@/lib/driver-language';
import {useState, type ReactNode} from 'react';
export function LoadingUnitList({items,footer,selected,onSelect,showAll=false}:{items:any[];footer?:(item:any)=>ReactNode;selected?:Set<string>;onSelect?:(ids:string[],checked:boolean)=>void;showAll?:boolean}){
 const {t:tr}=useDriverLanguage();
 const [collapsedCities,setCollapsedCities]=useState<Set<string>>(new Set());
 const toggleCity=(key:string)=>setCollapsedCities(old=>{const next=new Set(old);next.has(key)?next.delete(key):next.add(key);return next;});
 const checkbox=(rows:any[],label:string)=>{const ids=rows.filter(x=>x.unit.status==="pending"&&!x.delivery_run_id).map(x=>x.unit.id);return onSelect&&<input type="checkbox" aria-label={label} className="mr-2 h-5 w-5 accent-sky-400" disabled={!ids.length} checked={ids.length>0&&ids.every(id=>selected?.has(id))} onChange={e=>onSelect(ids,e.target.checked)}/>;};
 const selectableIds=[...new Set<string>(items.filter(x=>x.unit?.status==="pending"&&!x.delivery_run_id).map(x=>x.unit.id))];
 const selectedCount=selectableIds.filter(id=>selected?.has(id)).length;
 return <div className="overflow-hidden rounded-xl border border-white/10">
  {onSelect&&<div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-slate-900 p-3">
   <p role="status" aria-live="polite" aria-atomic="true" className="text-slate-200">{tr("已选包裹")} <strong className="mx-1 text-2xl font-bold tabular-nums text-amber-300">{selectedCount}</strong> / {selectableIds.length}</p>
   <button type="button" disabled={!selected?.size} onClick={()=>onSelect([...selected||[]],false)} className="min-h-11 rounded-lg border border-white/15 px-3 text-sm text-sky-200 disabled:opacity-40">{tr("清空勾选")}</button>
  </div>}
  <div role="region" aria-label={tr("包裹选择列表")} tabIndex={0} className="max-h-[50dvh] min-h-32 space-y-4 overflow-y-auto overscroll-contain p-3 [scrollbar-gutter:stable]">{groupLoadingUnits(items.filter(x=>showAll||x.unit?.status!=="dispatched")).map(city=><section key={city.key} className="overflow-hidden rounded-xl border border-white/10">
  <div className="flex items-center bg-sky-950 px-3 font-semibold text-sky-200">{checkbox(city.rows,`勾选城市 ${city.city}`)}<h3 className="min-w-0 flex-1"><button type="button" aria-expanded={!collapsedCities.has(city.key)} onClick={()=>toggleCity(city.key)} className="flex min-h-11 w-full items-center gap-2 py-2 text-left"><span aria-hidden="true">{collapsedCities.has(city.key)?'▶':'▼'}</span><span>{tr(city.city)} <span className="text-xs">{city.province} · {city.country} · {city.count}</span></span></button></h3></div>
  {!collapsedCities.has(city.key)&&city.customerGroups.map(customer=><div key={customer.key} className="border-t border-white/10 p-3"><h4 className="mb-2 font-semibold text-slate-200">{checkbox(customer.units,`勾选客户 ${customer.code} 地址 ${customer.address||''}`)}{tr('客户')} {customer.code||'—'} {customer.address&&<span className="ml-2 break-words font-normal text-slate-300">{customer.address}</span>}</h4><div className="flex flex-col gap-2">{customer.units.map(item=><div key={item.id} className="grid min-w-0 grid-cols-[auto_auto_minmax(0,1fr)] grid-rows-[auto_auto] gap-x-3 gap-y-1 rounded-lg bg-slate-800 p-3">
   <div className="row-span-2 self-center">{checkbox([item],`勾选箱子 ${item.unit.code}`)}</div>
   <div aria-label={tr('上车编号')} className="row-span-2 flex min-w-14 flex-col justify-center rounded-xl bg-amber-300 px-2 py-2 text-center text-slate-950"><div className="text-xs font-semibold">{tr('上车编号')}</div><strong className="text-3xl font-black tabular-nums">{item.sequence ?? '—'}</strong></div>
   <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><strong className="break-all">{item.unit.code}</strong><span className="text-sm text-amber-300">{tr(item.unit.status==='dispatched'?'已派送':item.unit.status==='cancelled'?'已取消':'待派送')}</span>{item.delivery_run_id&&<span className="text-xs text-sky-300">已生成派送趟</span>}</div>
   <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs"><span className="break-words text-slate-400">{item.unit.batch?.display_name} {item.unit.batch?.batch_no}</span>{item.unit.kind==='waybill'&&item.domestic_numbers?.map((number:string,index:number)=><span key={index} className="break-all text-sky-200">{tr("国内单号")}：{number}</span>)}<span className="text-slate-200">{tr("体积重")}：{item.volumetric_weight_kg == null ? tr("未记录") : `${Number(item.volumetric_weight_kg.toFixed(3))} kg`}</span>{footer?.(item)}</div>
  </div>)}</div></div>)}
 </section>)}</div></div>;
}
