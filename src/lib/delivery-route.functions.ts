import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
import {orderedIndexes, stopLabel} from '@/lib/delivery-sheet';
import {recordAdminLog} from '@/lib/admin-log';

const originSchema = z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),address:z.string().trim().min(1).max(500),active:z.boolean()});
export type DriverOrigin = z.infer<typeof originSchema>;
export const listDriverOrigins = createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async ({context})=>{
  await staff(context);
  const {supabaseAdmin:admin} = await import('@/integrations/supabase/client.server');
  const {data,error} = await admin.from('app_settings').select('value').like('key','driver-origin:%').order('key');
  if(error)throw new Error('司机起始点读取失败');
  return (data || []).map(row=>originSchema.parse(row.value)).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
});
export const saveDriverOrigin = createServerFn({method:'POST'}).middleware([requireSupabaseAuth]).inputValidator(originSchema).handler(async ({data,context})=>{
  const roles = await Promise.all(['owner','manager'].map(role=>context.supabase.rpc('has_role',{_user_id:context.userId,_role:role as 'owner' | 'manager'})));
  if(!roles.some(r=>!r.error&&r.data))throw new Error('仅负责人或经理可以设置司机起始点');
  const {supabaseAdmin:admin} = await import('@/integrations/supabase/client.server');
  const key = 'driver-origin:' + data.id;
  const {error} = await admin.from('app_settings').upsert({key,value:data,updated_at:new Date().toISOString()},{onConflict:'key'});
  if(error)throw new Error('司机起始点保存失败');
  await recordAdminLog(admin,{entity_type:'app_setting',entity_id:key,action:'设置司机起始点',after:data,operator_id:context.userId});
  return {ok:true};
});

async function staff(context: any) {
  const {data,error} = await context.supabase.rpc('is_staff',{_user_id:context.userId});
  if (error || !data) throw new Error('仅工作人员可以生成派送路线');
}
export const deliveryMapsReady = createServerFn({method:'GET'}).middleware([requireSupabaseAuth]).handler(async ({context})=>{
  await staff(context);
  const {supabaseAdmin:admin} = await import('@/integrations/supabase/client.server');
  const month = new Date().toISOString().slice(0,7) + '-01';
  const {data,error} = await (admin as any).from('delivery_maps_monthly_usage').select('used').eq('month',month).maybeSingle();
  return {configured:!!process.env.GOOGLE_MAPS_API_KEY?.trim(),quotaReady:!error,used:Number(data?.used || 0),limit:1000,month};
});

export const planDeliveryRoute = createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
  .inputValidator(z.object({origin:z.string().trim().min(1).max(500), addresses:z.array(z.string().trim().min(1).max(500)).min(1).max(21), roundTrip:z.boolean(), optimize:z.boolean(), keepFirst:z.boolean().optional(), returnAddress:z.string().trim().min(1).max(500).optional()}))
  .handler(async ({data,context})=>{
    await staff(context);
    const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
    if (!key) throw new Error('尚未配置 Google 地图，可先手动排序并打开导航');
    const {supabaseAdmin:admin} = await import('@/integrations/supabase/client.server');
    const reserve = async () => {
    const reservation = await (admin as any).rpc('reserve_delivery_maps_call');
    if (reservation.error) {
      if (reservation.error.message?.includes('DELIVERY_MAPS_MONTHLY_LIMIT')) throw new Error('本月 Google 查询已达到 1,000 次试用上限，已停止调用；仍可手动排序和打印');
      throw new Error('每月限量保护尚未就绪，已阻止 Google 调用，请先执行限量迁移');
    }
    };
    // A continuation sheet must visit its first listed address before optimizing
    // the remaining stops. Query the connecting leg separately so it is not lost.
    const fixedFirst = !!data.keepFirst && data.optimize && data.addresses.length > 1;
    const addresses = fixedFirst ? data.addresses.slice(1) : data.addresses;
    const intermediate = data.roundTrip ? addresses : addresses.slice(0,-1);
    const optimize = data.optimize && intermediate.length > 1;
    const query = async (body:unknown) => {
    await reserve();
    let response: Response;
    try {
      response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{
        method:'POST',signal:AbortSignal.timeout(30000),
        headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.optimizedIntermediateWaypointIndex,routes.legs.endLocation,routes.polyline.encodedPolyline'},
        body:JSON.stringify(body),
      });
    } catch { throw new Error('Google 路线查询超时或网络异常，请稍后重试'); }
    if (!response.ok) throw new Error(`Google 路线查询失败（${response.status}），请检查 API 开通、配额与地址`);
    const route = (await response.json()).routes?.[0];
    if (!route) throw new Error('Google 未找到可行的驾车路线，请检查地址');
    return route;
    };
    const approach = fixedFirst ? await query({origin:{address:data.origin},destination:{address:data.addresses[0]},travelMode:'DRIVE'}) : null;
    const route = await query({origin:{address:fixedFirst?data.addresses[0]:data.origin},destination:{address:data.roundTrip?(data.returnAddress || data.origin):addresses.at(-1)},intermediates:intermediate.map(address=>({address})),travelMode:'DRIVE',optimizeWaypointOrder:optimize});
    const order = optimize ? orderedIndexes(route.optimizedIntermediateWaypointIndex, intermediate.length) : intermediate.map((_,i)=>i);
    if (!data.roundTrip) order.push(addresses.length-1);
    if (fixedFirst) { for(let i=0;i<order.length;i++)order[i]++; order.unshift(0); }
    orderedIndexes(order,data.addresses.length);
    const params = new URLSearchParams({size:'640x380',scale:'2',format:'png',key});
    const polyline = route.polyline?.encodedPolyline;
    if (polyline) params.set('path','color:0x1266ccff|weight:4|enc:' + polyline);
    if (approach?.polyline?.encodedPolyline) params.append('path','color:0x1266ccff|weight:4|enc:' + approach.polyline.encodedPolyline);
    const legs = [...(approach?.legs || []),...(route.legs || [])];
    for (let i=0;i<order.length;i++) {
      const point = legs[i]?.endLocation?.latLng;
      if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) throw new Error('Google 未返回完整站点位置，请核对地址');
      params.append('markers',`label:${stopLabel(i)}|${point.latitude},${point.longitude}`);
    }
    let map: string | null = null;
    try {
      const image = await fetch('https://maps.googleapis.com/maps/api/staticmap?' + params,{signal:AbortSignal.timeout(20000)});
      if (image.ok && image.headers.get('content-type')?.startsWith('image/png') && !image.headers.get('x-staticmap-api-warning')) {
        const bytes = new Uint8Array(await image.arrayBuffer());
        // Do not return the API key or persist Google map data in the database.
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        map = 'data:image/png;base64,' + btoa(binary);
      }
    } catch { /* Route order remains usable if the map request fails. */ }
    return {order,map,optimized:optimize,warning:map?'':'路线已生成，但地图图片加载失败，请检查 Maps Static API 后重试'};
  });
