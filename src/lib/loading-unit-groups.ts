import {groupDeliveriesByCity} from './delivery-city-groups';
export function groupLoadingUnits(items:any[]) {
 const rows=items.filter(x=>x.unit).map(x=>({...x,customer_code:x.unit.customer_code,count:1}));
 return groupDeliveriesByCity(rows).map(city=>{
  const customers=new Map<string,any[]>();
  for(const row of city.rows){const key=JSON.stringify([row.customer_code||'',row.address||'']);const list=customers.get(key)||[];list.push(row);customers.set(key,list);}
  return {...city,customerGroups:[...customers].sort(([,a],[,b])=>String(a[0].customer_code||'').localeCompare(String(b[0].customer_code||''),undefined,{numeric:true})||String(a[0].address||'').localeCompare(String(b[0].address||''))).map(([key,units])=>({key,code:units[0].customer_code,address:units[0].address,units:units.sort((a,b)=>(a.sequence??Number.MAX_SAFE_INTEGER)-(b.sequence??Number.MAX_SAFE_INTEGER)||a.id.localeCompare(b.id))}))};
 });
}
