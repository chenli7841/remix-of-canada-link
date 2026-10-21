import {groupLoadingUnits} from '@/lib/loading-unit-groups';
import {useDriverLanguage} from '@/lib/driver-language';
import type {ReactNode} from 'react';
export function LoadingUnitList({items,footer}:{items:any[];footer?:(item:any)=>ReactNode}){
 const {t:tr}=useDriverLanguage();
 return <div className="space-y-4">{groupLoadingUnits(items).map(city=><section key={city.key} className="overflow-hidden rounded-xl border border-white/10">
  <h3 className="bg-sky-950 px-3 py-2 font-semibold text-sky-200">{tr(city.city)} <span className="text-xs">{city.province} · {city.country} · {city.count}</span></h3>
  {city.customerGroups.map(customer=><div key={customer.code} className="border-t border-white/10 p-3"><h4 className="mb-2 font-semibold text-slate-200">{tr('客户')} {customer.code||'—'}</h4><div className="grid gap-3 lg:grid-cols-2">{customer.units.map(item=><div key={item.id} className="flex min-w-0 items-start gap-3 rounded-lg bg-slate-800 p-3">
   <div aria-label={tr('上车编号')} className="shrink-0 rounded-xl bg-amber-300 px-3 py-2 text-center text-slate-950"><div className="text-xs font-semibold">{tr('上车编号')}</div><strong className="text-3xl font-black tabular-nums">{item.sequence ?? '—'}</strong></div>
   <div className="min-w-0 flex-1"><p className="break-all font-semibold">{item.unit.code}</p><p className="text-xs text-slate-400">{item.unit.batch?.display_name} {item.unit.batch?.batch_no}</p>{item.address&&<p className="mt-1 break-words text-xs text-slate-300">{item.full_name} · {item.address}</p>}<p className={item.unit.status==='dispatched'?'mt-2 text-emerald-300':'mt-2 text-amber-300'}>{tr(item.unit.status==='dispatched'?'已派送':item.unit.status==='cancelled'?'已取消':'待派送')}</p>{footer?.(item)}</div>
  </div>)}</div></div>)}
 </section>)}</div>;
}
