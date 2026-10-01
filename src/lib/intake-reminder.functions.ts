import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
const target = z.object({kind:z.enum(['order','forwarding']),id:z.string().uuid()});
export const saveReturnReminder=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(z.object({id:z.string().uuid(),enabled:z.boolean()})).handler(async({data,context})=>{
 const db=await access(context);
 const r=await db.from('forwarding_orders').update({return_reminder:data.enabled}).eq('id',data.id).select('id').single();
 if(r.error)throw Error('退运提醒保存失败，请检查数据库迁移或重试');
 return {ok:true};
});
async function access(context:any){
 const r=await context.supabase.rpc('is_staff',{_user_id:context.userId});
 if(r.error || !r.data) throw Error('仅工作人员可查看或修改入库备注');
 const {supabaseAdmin}=await import('@/integrations/supabase/client.server');return supabaseAdmin as any;
}
export const readIntakeReminder=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(target).handler(async({data,context})=>{
 const db=await access(context);const r=await db.from(data.kind==='order'?'orders':'forwarding_orders').select('note,intake_reminder').eq('id',data.id).single();
 if(r.error)throw Error('入库提醒读取失败，请检查迁移或重试');return r.data as {note:string|null;intake_reminder:boolean};
});
export const saveIntakeReminder=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(target.extend({note:z.string().trim().max(4000),intake_reminder:z.boolean()}).refine(v=>!v.intake_reminder||!!v.note,'开启提醒前请填写备注')).handler(async({data,context})=>{
 const db=await access(context);const r=await db.from(data.kind==='order'?'orders':'forwarding_orders').update({note:data.note,intake_reminder:data.intake_reminder}).eq('id',data.id).select('id').single();
 if(r.error)throw Error('备注保存失败，请重试');return {ok:true};
});
export const saveOrderNoteOnly=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(target.extend({note:z.string().trim().max(4000)})).handler(async({data,context})=>{
 const db=await access(context);const table=data.kind==='order'?'orders':'forwarding_orders';
 const old=await db.from(table).select('intake_reminder').eq('id',data.id).single();
 if(old.error)throw Error('提醒设置读取失败');
 if(old.data.intake_reminder&&!data.note)throw Error('请先关闭特别提醒，再清空备注');
 const r=await db.from(table).update({note:data.note}).eq('id',data.id).select('id').single();
 if(r.error)throw Error('备注保存失败');return {ok:true};
});
export const saveOrderReminderOnly=createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(target.extend({intake_reminder:z.boolean()})).handler(async({data,context})=>{
 const db=await access(context);const table=data.kind==='order'?'orders':'forwarding_orders';
 const old=await db.from(table).select('note').eq('id',data.id).single();
 if(old.error)throw Error('备注读取失败');
 if(data.intake_reminder&&!old.data.note?.trim())throw Error('请先在客户卡片填写并保存备注，再开启特别提醒');
 const r=await db.from(table).update({intake_reminder:data.intake_reminder}).eq('id',data.id).select('id').single();
 if(r.error)throw Error('提醒保存失败');return {ok:true};
});
