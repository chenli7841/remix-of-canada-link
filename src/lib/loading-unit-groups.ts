import {groupDeliveriesByCity} from './delivery-city-groups';
export function groupLoadingUnits(items:any[]) {
 const rows=items.filter(x=>x.unit).map(x=>({...x,customer_code:x.unit.customer_code,count:1}));
 return groupDeliveriesByCity(rows).map(city=>{
  const customers=new Map<string,any[]>();
  for(const row of city.rows){const key=row.customer_code||'';const list=customers.get(key)||[];list.push(row);customers.set(key,list);}
  return {...city,customerGroups:[...customers].sort(([a],[b])=>a&&b?a.localeCompare(b,undefined,{numeric:true}):a?-1:b?1:0).map(([code,units])=>({code,units:units.sort((a,b)=>(a.sequence??Number.MAX_SAFE_INTEGER)-(b.sequence??Number.MAX_SAFE_INTEGER)||a.id.localeCompare(b.id))}))};
 });
}
