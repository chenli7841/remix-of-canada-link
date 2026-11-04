import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';

const scope=z.object({ownerKind:z.enum(['order','forwarding']),ownerId:z.string().uuid()});
async function authorize(context:any,data:z.infer<typeof scope>){
 const {supabaseAdmin:admin}=await import('@/integrations/supabase/client.server');
 const r=await admin.from(data.ownerKind==='order'?'orders':'forwarding_orders').select('id,user_id').eq('id',data.ownerId).maybeSingle();
 if(r.error||!r.data)throw new Error('订单不存在或无权访问');
 if(r.data.user_id!==context.userId){
  const roles=await Promise.all(['owner','manager','warehouse_ca','warehouse_cn','support'].map(role=>context.supabase.rpc('has_role',{_user_id:context.userId,_role:role})));
  if(!roles.some(r=>!r.error&&r.data===true))throw new Error('没有查看该订单附件的权限');
 }
 return admin;
}
export const listOrderAttachments=createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).inputValidator(scope).handler(async({data,context})=>{
 const admin=await authorize(context,data);
 const rows:any[]=[];
 for(let offset=0;;offset+=500){
  const r=await admin.from('order_attachments').select('id,user_id,file_name,file_path,file_size,content_type,created_at').eq('owner_kind',data.ownerKind).eq('owner_id',data.ownerId).order('created_at',{ascending:false}).order('id').range(offset,offset+499);
  if(r.error)throw new Error('附件读取失败');
  rows.push(...(r.data??[]));if((r.data??[]).length<500)break;
 }
 return rows;
});
export const getOrderAttachmentLink=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(scope.extend({attachmentId:z.string().uuid(),download:z.boolean().default(false)})).handler(async({data,context})=>{
 const admin=await authorize(context,data);
 const r=await admin.from('order_attachments').select('file_path,file_name,user_id').eq('id',data.attachmentId).eq('owner_kind',data.ownerKind).eq('owner_id',data.ownerId).maybeSingle();
 if(r.error||!r.data)throw new Error('附件不存在');
 if(!r.data.file_path.startsWith(`${r.data.user_id}/${data.ownerId}/`)||r.data.file_path.split('/').length!==3)throw new Error('附件路径无效');
 const link=await admin.storage.from('order-attachments').createSignedUrl(r.data.file_path,600,data.download?{download:r.data.file_name}:undefined);
 if(link.error)throw new Error('附件链接生成失败');
 return {url:link.data.signedUrl};
});
