import {readBatchRowsByIds} from './batch-waybills.server';
// Only standalone waybills expose their parent domestic number; containers do not expose their contents.
export async function loadUnitDomesticNumbers(admin:any, units:any[]) {
 const waybills=await readBatchRowsByIds(admin,'waybills','id,forwarding_id,order_id','id',units.filter(u=>u.kind==='waybill').map(u=>u.ref_id).filter(Boolean));
 const [forwardings,orders]=await Promise.all([
  readBatchRowsByIds(admin,'forwarding_orders','id,domestic_tracking_no','id',waybills.map(w=>w.forwarding_id).filter(Boolean)),
  readBatchRowsByIds(admin,'orders','id,domestic_tracking_no','id',waybills.map(w=>w.order_id).filter(Boolean)),
 ]);
 const f=new Map(forwardings.map(r=>[r.id,r.domestic_tracking_no]));
 const o=new Map(orders.map(r=>[r.id,r.domestic_tracking_no]));
 const byId=new Map(waybills.map(w=>[w.id,w]));
 return new Map(units.map(unit=>{
  const wb=unit.kind==='waybill'?byId.get(unit.ref_id):null;
  const number=wb?(f.get(wb.forwarding_id)||o.get(wb.order_id)):null;
  return [unit.id,typeof number==='string'&&number.trim()?[number.trim()]:[]];
 }));
}
