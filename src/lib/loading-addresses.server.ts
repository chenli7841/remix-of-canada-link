import {loadDeliveryGroups} from './delivery-queue.functions';
// Use the same resolved delivery address as the pending-delivery list.
export async function attachLoadingAddresses(items:any[]) {
 const statuses=[...new Set<string>(items.map(x=>x.unit?.status).filter(Boolean))];
 const byId=new Map<string,any>();
 for(const status of statuses){
  const result=await loadDeliveryGroups(status);
  for(const group of result.groups)for(const id of group.ids)byId.set(id,group);
 }
 return items.map(item=>{
  const group=byId.get(item.unit?.id ?? item.queue_id);
  return {...item,city:group?.city,province:group?.province,country:group?.country,address:group?.address,full_name:group?.full_name};
 });
}
