import {createServerFn} from '@tanstack/react-start';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
import {z} from 'zod';
import {buildPickingList} from './picking-list';

// Page every query and chunk relationship filters so large batches remain complete.
export async function loadPickingSource(admin:any,batchId:string) {
  async function all(table:string,cols:string,filter:(q:any)=>any) {
    const result:any[]=[];
    for(let offset=0;;offset+=1000){const {data,error}=await filter(admin.from(table).select(cols)).order('id').range(offset,offset+999);if(error)throw new Error(error.message);result.push(...data);if(data.length<1000)return result;}
  }
  async function byIds(table:string,cols:string,key:string,ids:string[]) {
    const result:any[]=[];const distinct=[...new Set(ids.filter(Boolean))];
    for(let i=0;i<distinct.length;i+=50)result.push(...await all(table,cols,q=>q.in(key,distinct.slice(i,i+50))));return result;
  }
  const [batch,pallets,directCartons]=await Promise.all([
    all('batches','id,batch_no',q=>q.eq('id',batchId)),
    all('pallets','id,pallet_no,customer_user_id,customer_code,self_length_cm,self_width_cm,self_height_cm',q=>q.eq('batch_id',batchId)),
    all('cartons','id,carton_no,pallet_id,self_length_cm,self_width_cm,self_height_cm',q=>q.eq('batch_id',batchId)),
  ]);
  if(!batch.length)throw new Error('批次不存在');
  const nested=await byIds('cartons','id,carton_no,pallet_id,self_length_cm,self_width_cm,self_height_cm','pallet_id',pallets.map(p=>p.id));
  const cartons=[...new Map([...directCartons,...nested].map(c=>[c.id,c])).values()];
  const cols='id,waybill_no,forwarding_id,order_id,pallet_id,carton_id,items_summary,weight_kg,length_cm,width_cm,height_cm';
  const sets=await Promise.all([
    all('waybills',cols,q=>q.eq('assigned_batch_id',batchId).is('pallet_id',null).is('carton_id',null)),
    byIds('waybills',cols,'pallet_id',pallets.map(p=>p.id)),
    byIds('waybills',cols,'carton_id',cartons.map(c=>c.id)),
  ]);
  const wbs=[...new Map(sets.flat().map(w=>[w.id,w])).values()];
  const fitems=await byIds('forwarding_items','id,forwarding_id,name,hs_code,inner_qty,extras','forwarding_id',wbs.map(w=>w.forwarding_id));
  return {batch:batch[0],pallets,cartons,wbs,fitems};
}
export const getBatchPickingList=createServerFn({method:'POST'})
  .middleware([requireSupabaseAuth])
  .inputValidator((d:{batchId:string})=>z.object({batchId:z.string().uuid()}).parse(d))
  .handler(async({data,context})=>{
    const {data:staff,error}=await context.supabase.rpc('is_staff',{_user_id:context.userId});
    if(error||!staff)throw new Error('Forbidden');
    const {supabaseAdmin}=await import('@/integrations/supabase/client.server');
    return buildPickingList(await loadPickingSource(supabaseAdmin,data.batchId));
  });
