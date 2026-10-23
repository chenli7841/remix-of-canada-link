import {readBatchRowsByIds} from "./batch-waybills.server";
import {loadUnitDomesticNumbers} from "./loading-domestic.server";
import {loadUnitVolumetricWeights} from "./loading-volumetric.server";
import {loadDeliveryGroups} from './delivery-queue.functions';
// Use the same resolved delivery address as the pending-delivery list.
export async function attachLoadingAddresses(items:any[]) {
 const {supabaseAdmin} = await import("@/integrations/supabase/client.server");
 const domestic=await loadUnitDomesticNumbers(supabaseAdmin,items.map(i=>i.unit).filter(Boolean));
 const volumetric=await loadUnitVolumetricWeights(supabaseAdmin,items.map(i=>i.unit).filter(Boolean));
 const runs=await readBatchRowsByIds(supabaseAdmin,"driver_trips","id,delivery_unit_ids","loading_trip_id",items.map(i=>i.trip_id).filter(Boolean));
 const allocated=new Map<string,string>();for(const r of runs)for(const id of r.delivery_unit_ids||[])allocated.set(id,r.id);
 const statuses=[...new Set<string>(items.map(x=>x.unit?.status).filter(Boolean))];
 const byId=new Map<string,any>();
 for(const status of statuses){
  const result=await loadDeliveryGroups(status);
  for(const group of result.groups)for(const id of group.ids)byId.set(id,group);
 }
 return items.map(item=>{
  const group=byId.get(item.unit?.id ?? item.queue_id);
  return {...item,volumetric_weight_kg:volumetric.get(item.unit?.id)??null,delivery_run_id:allocated.get(item.unit?.id),domestic_numbers:domestic.get(item.unit?.id)||[],city:group?.city,province:group?.province,country:group?.country,address:group?.address,full_name:group?.full_name};
 });
}
