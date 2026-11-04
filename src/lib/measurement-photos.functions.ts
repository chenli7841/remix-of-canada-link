import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
const input=z.object({waybillId:z.string().uuid()});
const targetKind=z.enum(['waybill','carton','pallet','inspection']);
type Target={kind:z.infer<typeof targetKind>;refId:string;label:string;ownerKind?:'order'|'forwarding'};
async function resolve(context:any,waybillId:string){
 const roles=await Promise.all(['owner','manager','warehouse_ca','warehouse_cn','support'].map(role=>context.supabase.rpc('has_role',{_user_id:context.userId,_role:role})));
 if(!roles.some(r=>!r.error&&r.data===true))throw new Error('仅工作人员可以使用量尺照片管理');
 const {supabaseAdmin:admin}=await import('@/integrations/supabase/client.server');
 const r=await admin.from('waybills').select('id,waybill_no,carton_id,pallet_id,order_id,forwarding_id').eq('id',waybillId).maybeSingle();
 if(r.error||!r.data)throw new Error('运单不存在');
 const w=r.data,targets:Target[]=[{kind:'waybill',refId:w.id,label:`包裹照片 · ${w.waybill_no}（内部）`}];
 let palletId=w.pallet_id;
 if(w.carton_id){
  const c=await admin.from('cartons').select('id,pallet_id').eq('id',w.carton_id).maybeSingle();
  if(c.error||!c.data)throw new Error('关联箱号读取失败');
  targets.push({kind:'carton',refId:c.data.id,label:'关联箱号照片（内部）'});palletId=palletId||c.data.pallet_id;
 }
 if(palletId){
  const p=await admin.from('pallets').select('id').eq('id',palletId).maybeSingle();
  if(p.error||!p.data)throw new Error('关联托盘读取失败');
  targets.push({kind:'pallet',refId:p.data.id,label:'关联托盘照片（内部）'});
 }
 const ownerId=w.forwarding_id||w.order_id;
 if(ownerId)targets.push({kind:'inspection',refId:ownerId,ownerKind:w.forwarding_id?'forwarding':'order',label:'内件核对照片（订单客户可见）'});
 return {admin,targets};
}
export const getMeasurementPhotoTargets=createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).inputValidator(input).handler(async({data,context})=>(await resolve(context,data.waybillId)).targets);
export const saveMeasurementPhotos=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(input.extend({photoId:z.string().uuid(),image:z.string().max(8400000),targets:z.array(targetKind).min(1).max(4)})).handler(async({data,context})=>{
 const {admin,targets}=await resolve(context,data.waybillId);
 const chosen=[...new Set(data.targets)];
 if(chosen.some(kind=>!targets.some(t=>t.kind===kind)))throw new Error('照片位置不属于此运单，请刷新后重试');
 const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data.image);
 if(!match)throw new Error('请上传JPEG照片');
 const bytes=Uint8Array.from(atob(match[1]),c=>c.charCodeAt(0));
 if(bytes.length>6291456||bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new Error('照片无效或超过6MB');
 const results:{kind:string;label:string;ok:boolean;error?:string}[]=[];
 for(const kind of chosen){
  const target=targets.find(t=>t.kind===kind)!;
  try{
   const inspection=kind==='inspection';
   const bucket=inspection?'order-attachments':'delivery-proofs';
   const path=inspection?`${context.userId}/${target.refId}/${data.photoId}.jpg`:`cargo/${kind}/${target.refId}/${data.photoId}.jpg`;
   const put=await admin.storage.from(bucket).upload(path,bytes,{contentType:'image/jpeg',upsert:false});
   if(put.error){
    // A retry reuses the photo id. Never overwrite a different image.
    const existing=await admin.storage.from(bucket).download(path);
    if(existing.error||!existing.data)throw new Error('照片保存失败，请重试');
    const previous=new Uint8Array(await existing.data.arrayBuffer());
    if(previous.length!==bytes.length||previous.some((v,i)=>v!==bytes[i]))throw new Error('照片标识冲突，请重新选择照片');
   }
   if(inspection){
    const prior=await admin.from('order_attachments').select('id,file_path').eq('id',data.photoId).maybeSingle();
    if(prior.error)throw new Error('照片记录读取失败');
    if(prior.data&&prior.data.file_path!==path)throw new Error('照片标识冲突');
    if(!prior.data){
     const ins=await admin.from('order_attachments').insert({id:data.photoId,owner_kind:target.ownerKind,owner_id:target.refId,user_id:context.userId,file_name:`内件核对_${data.photoId}.jpg`,file_path:path,file_size:bytes.length,content_type:'image/jpeg'});
     if(ins.error)throw new Error('照片已上传，登记失败，请重试');
    }
   }
   results.push({kind,label:target.label,ok:true});
  }catch(e:any){results.push({kind,label:target.label,ok:false,error:e.message||'保存失败'});}
 }
 const {recordAdminLog}=await import('@/lib/admin-log');
 await recordAdminLog(admin,{entity_type:'waybill',entity_id:data.waybillId,action:'一次拍摄多位置保存',operator_id:context.userId,after:{photo_id:data.photoId,results}});
 return results;
});
