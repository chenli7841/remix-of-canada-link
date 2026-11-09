// Read original batch ownership, including containers whose children have no direct batch.
export async function receivingDifferenceDetails(db:any, rows:any[]) {
 async function read(table:string,fields:string,ids:(string|null|undefined)[]) {
   const unique=[...new Set(ids.filter(Boolean))];const result:any[]=[];
   for(let i=0;i<unique.length;i+=100){const r=await db.from(table).select(fields).in('id',unique.slice(i,i+100));if(r.error)throw new Error(r.error.message);result.push(...(r.data ?? []));}
   return new Map(result.map(x=>[x.id,x]));
 }
 const ways=await read('waybills','id,waybill_no,assigned_batch_id,carton_id,pallet_id',rows.filter(r=>r.kind==='waybill').map(r=>r.ref_id));
 const cartons=await read('cartons','id,carton_no,batch_id,pallet_id',[...rows.filter(r=>r.kind==='carton').map(r=>r.ref_id),...[...ways.values()].map(w=>w.carton_id)]);
 const pallets=await read('pallets','id,pallet_no,batch_id',[...rows.filter(r=>r.kind==='pallet').map(r=>r.ref_id),...[...ways.values()].map(w=>w.pallet_id),...[...cartons.values()].map(c=>c.pallet_id)]);
 const mapped=rows.map(row=>{
   const w=row.kind==='waybill'?ways.get(row.ref_id):null;
   const c=cartons.get(row.kind==='carton'?row.ref_id:w?.carton_id);
   const p=pallets.get(row.kind==='pallet'?row.ref_id:w?.pallet_id ?? c?.pallet_id);
   return {...row,code:w?.waybill_no ?? c?.carton_no ?? p?.pallet_no ?? row.code,
     batch_id:w?.assigned_batch_id ?? c?.batch_id ?? p?.batch_id ?? null,
     carton_no:c?.carton_no ?? null,pallet_no:p?.pallet_no ?? null};
 });
 const batches=await read('batches','id,batch_no,display_name,planned_ship_date,shipping_method,status',mapped.map(r=>r.batch_id));
 return mapped.map(row=>({...row,batch:row.batch_id?batches.get(row.batch_id) ?? null:null}));
}
