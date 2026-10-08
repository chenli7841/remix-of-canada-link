import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { loadDeliveryGroups } from './delivery-queue.functions';
import { deliveryStops } from './delivery-sheet';

async function staff(context: any) {
  const r = await context.supabase.rpc('is_staff', {_user_id: context.userId});
  if (r.error || !r.data) throw new Error('没有分配司机派送趟的权限');
  const {supabaseAdmin} = await import('@/integrations/supabase/client.server');
  return supabaseAdmin as any;
}
export const listAssignableDrivers = createServerFn({method:'GET'}).middleware([requireSupabaseAuth])
  .handler(async ({context}) => {
    const admin = await staff(context);
    const roles = await admin.from('user_roles').select('user_id').eq('role','driver');
    if (roles.error) throw new Error('司机列表读取失败');
    const ids = [...new Set((roles.data || []).map((r:any)=>r.user_id))];
    if (!ids.length) return [] as {id:string; full_name:string}[];
    const result = await admin.from('profiles').select('id,full_name').in('id',ids).order('full_name');
    if (result.error) throw new Error('司机资料读取失败');
    return result.data as {id:string; full_name:string}[];
  });
export const assignDeliveryTrip = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
  .inputValidator(z.object({id:z.string().uuid(),driverId:z.string().uuid(),originId:z.string().uuid(),keys:z.array(z.string().min(1).max(300)).min(1).max(1000)}))
  .handler(async ({data,context})=>{
    const admin = await staff(context);
    const previous = await admin.from('driver_trips').select('id,created_by,driver_id,origin_id').eq('id',data.id).maybeSingle();
    if (previous.error) throw new Error('请先执行后台分配司机趟次迁移');
    if (previous.data) {
      if (previous.data.created_by !== context.userId || previous.data.driver_id !== data.driverId || previous.data.origin_id !== data.originId) throw new Error('该生成请求已使用，请重新打开窗口');
      return {id:data.id};
    }
    const origin = await admin.from('app_settings').select('value').eq('key','driver-origin:'+data.originId).single();
    if (origin.error || !origin.data?.value?.active || !origin.data.value.address?.trim()) throw new Error('请选择已启用且有地址的起始点');
    const latest = await loadDeliveryGroups('pending');
    const keys = new Set(data.keys);
    const groups = latest.groups.filter(g=>keys.has(g.key));
    if (groups.length !== keys.size) throw new Error('所选批次状态已变化，请刷新后重新勾选');
    const ids = [...new Set(groups.flatMap(g=>g.ids))];
    if (!ids.length || ids.length > 10000) throw new Error('请选择 1 至 10000 个派送单位');
    const stops = deliveryStops(groups).map(stop=>({address:stop.address,customers:[...new Set(stop.rows.map(g=>g.customer_code))].map(code=>{
      const rows = groups.filter(g=>stop.rows.some(s=>s.key===g.key)&&g.customer_code===code);
      const first = rows[0];
      return {customer_code:code,name:first.full_name,phone:first.phone,address:stop.address,wallet:first.wallet_balance_cad,groups:rows,ids:rows.flatMap(g=>g.ids)};
    })}));
    const plans = [];
    let departure = origin.data.value.address;
    for(let i=0;i<stops.length;i+=21){const chunk=stops.slice(i,i+21);plans.push({origin:departure,stops:chunk});departure=chunk.at(-1)!.address;}
    const result = await admin.rpc('admin_assign_delivery_trip',{
      _actor:context.userId,_id:data.id,_driver:data.driverId,_origin:data.originId,_ids:ids,
      _route:{origin:origin.data.value.address,plans},
    });
    if(result.error) throw new Error(result.error.message);
    return {id:data.id};
  });
