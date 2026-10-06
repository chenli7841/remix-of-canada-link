import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
import {loadDeliveryGroups} from '@/lib/delivery-queue.functions';

const customer = z.string().trim().regex(/^\d{1,5}$/, '请输入1至5位客户号').transform(s=>s.padStart(5,'0'));
const scope = z.object({customerCode:customer,batchId:z.string().uuid()});
export async function requireDriver(context:any) {
  const r=await context.supabase.rpc('has_role',{_user_id:context.userId,_role:'driver'});
  if(r.error||r.data!==true)throw new Error('仅派送司机可以使用此页面，请联系管理员分配司机角色');
}
export const driverAccess = createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async({context})=>{
  await requireDriver(context);return {ok:true};
});
export const searchDriverDeliveries = createServerFn({method:'GET'}).middleware([requireSupabaseAuth])
  .inputValidator(z.object({customerCode:customer})).handler(async({data,context})=>{
    await requireDriver(context);
    const result=await loadDeliveryGroups('pending',data.customerCode);
    return result.groups.map(g=>({
      batch_id:g.batch_id,batch_no:g.batch_no,batch_name:g.batch_name,customer_code:g.customer_code,
      full_name:g.full_name,address:g.address,phone:g.phone,wallet_balance_cad:g.wallet_balance_cad,
      payment_label:g.payment_label,total_cad:g.total_cad,chargeable_weight_kg:g.chargeable_weight_kg,
      count:g.count,waybill_count:g.waybill_count,carton_count:g.carton_count,pallet_count:g.pallet_count,
      extra_fee_cny:g.explicit_extra_fee_cny,extra_fee_cad:+(g.explicit_extra_fee_cny*result.fx).toFixed(2),
      extra_fee_paid:g.extra_fee_paid,settlement_note:g.settlement_note,
    }));
  });
export const actOnDriverDelivery = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
  .inputValidator(scope.extend({action:z.enum(['deduct','dispatch','note']),note:z.string().max(2000).default(''),expectedCad:z.number().finite().nonnegative().optional()}))
  .handler(async({data,context})=>{
    await requireDriver(context);
    const {supabaseAdmin:admin}=await import('@/integrations/supabase/client.server');
    const r=await (admin as any).rpc('driver_delivery_action',{_actor:context.userId,_batch:data.batchId,_customer:data.customerCode,
      _action:data.action,_note:data.note,_expected_cad:data.expectedCad??null});
    if(r.error)throw new Error(r.error.message);return r.data as {ok:boolean;alreadyPaid:boolean};
  });

async function requirePhotoScope(context:any,data:{batchId:string;customerCode:string},upload=false) {
  if(upload)await requireDriver(context);
  else {
    const roles=await Promise.all(['driver','owner','manager','warehouse_ca','warehouse_cn','support'].map(role=>context.supabase.rpc('has_role',{_user_id:context.userId,_role:role})));
    if(!roles.some(r=>!r.error&&r.data===true))throw new Error('没有查看派送照片的权限');
  }
  const {supabaseAdmin:admin}=await import('@/integrations/supabase/client.server');
  const r=await admin.from('delivery_queue').select('id').eq('source_batch_id',data.batchId).eq('customer_code',data.customerCode).in('status',['pending','dispatched']).limit(1);
  if(r.error||!r.data?.length)throw new Error('未找到该客户批次的派送记录');
  return admin;
}
export const listDeliveryProofs=createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).inputValidator(scope)
  .handler(async({data,context})=>{
    const admin=await requirePhotoScope(context,data);
    const r=await (admin as any).from('delivery_proof_photos').select('id,storage_path,created_at').eq('batch_id',data.batchId).eq('customer_code',data.customerCode).order('created_at');
    if(r.error)throw new Error('照片读取失败，请确认已执行司机页面迁移');
    return Promise.all((r.data??[]).map(async(p:any)=>{
      const signed=await admin.storage.from('delivery-proofs').createSignedUrl(p.storage_path,600);
      if(signed.error)throw new Error('照片链接生成失败');
      return {id:p.id,url:signed.data.signedUrl,created_at:p.created_at};
    }));
  });
export const uploadDeliveryProof=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
  .inputValidator(scope.extend({photoId:z.string().uuid(),image:z.string().max(8400000)}))
  .handler(async({data,context})=>{
    const admin=await requirePhotoScope(context,data,true);
    const match=/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data.image);
    if(!match)throw new Error('请上传有效的JPEG照片');
    const bytes=Uint8Array.from(atob(match[1]),c=>c.charCodeAt(0));
    if(bytes.length>6291456||bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw new Error('照片无效或超过6MB');
    const path=`${data.batchId}/${data.customerCode}/${context.userId}/${data.photoId}.jpg`;
    const prior=await (admin as any).from('delivery_proof_photos').select('id,storage_path').eq('id',data.photoId).maybeSingle();
    if(prior.error)throw new Error('照片记录读取失败');
    if(prior.data){if(prior.data.storage_path!==path)throw new Error('照片标识冲突');return {ok:true};}
    const put=await admin.storage.from('delivery-proofs').upload(path,bytes,{contentType:'image/jpeg',upsert:false});
    if(put.error)throw new Error('照片上传失败，请重试');
    const insert=await (admin as any).from('delivery_proof_photos').insert({id:data.photoId,batch_id:data.batchId,customer_code:data.customerCode,storage_path:path,uploaded_by:context.userId});
    if(insert.error){await admin.storage.from('delivery-proofs').remove([path]);throw new Error('照片登记失败，请重试');}
    const {recordAdminLog}=await import('@/lib/admin-log');
    await recordAdminLog(admin,{entity_type:'batch',entity_id:data.batchId,action:'司机上传派送照片',operator_id:context.userId,note:`客户 ${data.customerCode}`,after:{photo_id:data.photoId}});
    return {ok:true};
  });
