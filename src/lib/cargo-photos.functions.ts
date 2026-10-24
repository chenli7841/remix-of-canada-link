import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';

const scope=z.object({kind:z.enum(['carton','waybill','pallet']),refId:z.string().uuid()});
async function authorize(context:any,data:z.infer<typeof scope>){
 const roles=await Promise.all(['owner','manager','warehouse_ca','warehouse_cn','support'].map(role=>context.supabase.rpc('has_role',{_user_id:context.userId,_role:role})));
 const staff=roles.some(r=>!r.error&&r.data===true);
 const {supabaseAdmin:admin}=await import('@/integrations/supabase/client.server');
 if(!staff){
  const role=await context.supabase.rpc('has_role',{_user_id:context.userId,_role:'driver'});
  if(role.error||!role.data)throw new Error('没有货物照片访问权限');
  const queues=await admin.from('delivery_queue').select('id').eq('kind',data.kind).eq('ref_id',data.refId);
  if(queues.error||!queues.data?.length)throw new Error('货物不属于司机上车趟');
  const items=await admin.from('driver_trip_items').select('id,driver_trips!inner(driver_id)').in('queue_id',queues.data.map(q=>q.id)).eq('driver_trips.driver_id',context.userId).limit(1);
  if(items.error||!items.data?.length)throw new Error('货物不属于司机上车趟');
 }
 const table={carton:'cartons',waybill:'waybills',pallet:'pallets'}[data.kind];
 const entity=await (admin as any).from(table).select('id').eq('id',data.refId).maybeSingle();
 if(entity.error||!entity.data)throw new Error('货物记录不存在');
 return admin;
}
// Private storage, separate namespace from customer/batch delivery proofs. No public URLs.
const prefix=(data:z.infer<typeof scope>)=>`cargo/${data.kind}/${data.refId}`;
export const listCargoPhotos=createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).inputValidator(scope).handler(async({data,context})=>{
 const admin=await authorize(context,data),photos:any[]=[];
 for(let offset=0;;offset+=100){
  const r=await admin.storage.from('delivery-proofs').list(prefix(data),{limit:100,offset,sortBy:{column:'created_at',order:'desc'}});
  if(r.error)throw new Error('货物照片读取失败');
  for(const p of r.data||[]){if(!p.name.endsWith('.jpg'))continue;const signed=await admin.storage.from('delivery-proofs').createSignedUrl(`${prefix(data)}/${p.name}`,600);if(signed.error)throw new Error('照片链接生成失败');photos.push({id:p.id,url:signed.data.signedUrl});}
  if(r.data.length<100)break;
 }
 return photos as {id:string;url:string}[];
});
export const uploadCargoPhoto=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(scope.extend({photoId:z.string().uuid(),image:z.string().max(8400000)})).handler(async({data,context})=>{
 const admin=await authorize(context,data);
 const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data.image);
 if(!match)throw new Error('请上传有效的JPEG照片');
 const bytes=Uint8Array.from(atob(match[1]),c=>c.charCodeAt(0));
 if(bytes.length>6291456||bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new Error('照片无效或超过6MB');
 const path=`${prefix(data)}/${data.photoId}.jpg`;
 const put=await admin.storage.from('delivery-proofs').upload(path,bytes,{contentType:'image/jpeg',upsert:false});
 if(put.error)throw new Error('照片上传失败，请重试');
 const {recordAdminLog}=await import('@/lib/admin-log');
 await recordAdminLog(admin,{entity_type:data.kind,entity_id:data.refId,action:'上传货物照片',operator_id:context.userId,after:{storage_path:path}});
 return {ok:true};
});
