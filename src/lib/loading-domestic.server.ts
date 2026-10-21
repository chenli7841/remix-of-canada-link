import {readBatchRowsByIds} from './batch-waybills.server';
// Resolve every physical unit independently; the same domestic number may appear on several boxes.
export async function loadUnitDomesticNumbers(admin:any, units:any[]) {
 const ids=(kind:string)=>units.filter(u=>u.kind===kind).map(u=>u.ref_id).filter(Boolean);
 const nested=await readBatchRowsByIds(admin,'cartons','id,pallet_id','pallet_id',ids('pallet'));
 const columns='id,carton_id,pallet_id,forwarding_id,order_id';
 const [direct,boxed,palletized]=await Promise.all([
  readBatchRowsByIds(admin,'waybills',columns,'id',ids('waybill')),
  readBatchRowsByIds(admin,'waybills',columns,'carton_id',[...ids('carton'),...nested.map(c=>c.id)]),
  readBatchRowsByIds(admin,'waybills',columns,'pallet_id',ids('pallet')),
 ]);
 const waybills=[...new Map([...direct,...boxed,...palletized].map(w=>[w.id,w])).values()];
 const [forwardings,orders]=await Promise.all([
  readBatchRowsByIds(admin,'forwarding_orders','id,domestic_tracking_no','id',waybills.map(w=>w.forwarding_id).filter(Boolean)),
  readBatchRowsByIds(admin,'orders','id,domestic_tracking_no','id',waybills.map(w=>w.order_id).filter(Boolean)),
 ]);
 const f=new Map(forwardings.map(r=>[r.id,r.domestic_tracking_no]));
 const o=new Map(orders.map(r=>[r.id,r.domestic_tracking_no]));
 const cartons=new Map(nested.map(c=>[c.id,c.pallet_id]));
 return new Map(units.map(unit=>[unit.id,waybills.filter(w=>unit.kind==='waybill'?w.id===unit.ref_id:unit.kind==='carton'?w.carton_id===unit.ref_id:w.pallet_id===unit.ref_id||cartons.get(w.carton_id)===unit.ref_id).map(w=>f.get(w.forwarding_id)||o.get(w.order_id)).filter((n):n is string=>typeof n==='string'&&!!n.trim()).map(n=>n.trim())]));
}
