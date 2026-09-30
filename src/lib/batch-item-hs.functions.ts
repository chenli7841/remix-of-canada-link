import {createServerFn} from '@tanstack/react-start';
import {z} from 'zod';
import {requireSupabaseAuth} from '@/integrations/supabase/auth-middleware';
import {normalizeHsCodeForStorage} from './hs-code-format';
import {loadPickingSource} from './picking-list.functions';
import {selectByIds,markBatchFeesDirtyMany,resolveWaybillBatchIds,refreshBatchSettlementsForCustomer} from './orders.functions';
import {persistWaybillItemsForParent} from './duty.server';
import {recordAdminLog} from './admin-log';

export const setBatchItemHs=createServerFn({method:'POST'}).middleware([requireSupabaseAuth])
 .inputValidator((d:{batchId:string;customerCode:string;name:string;hsCode:string})=>z.object({batchId:z.string().uuid(),customerCode:z.string().min(1),name:z.string().min(1),hsCode:z.string().min(1)}).parse(d))
 .handler(async({data,context})=>{
  const {data:staff,error:staffError}=await context.supabase.rpc('is_staff',{_user_id:context.userId});if(staffError||!staff)throw new Error('Forbidden');
  const {supabaseAdmin:admin}=await import('@/integrations/supabase/client.server');
  async function checked(q:any){const r=await q;if(r.error)throw new Error(r.error.message);return r.data;}
  const code=normalizeHsCodeForStorage(data.hsCode);if(!code)throw new Error('请输入有效HS编码');
  const hs=await checked(admin.from('hs_codes').select('hs_code,mfn_rate,gst_rate,anti_dumping_rate').eq('hs_code',code).single());
  if(![hs.mfn_rate,hs.gst_rate,hs.anti_dumping_rate].every(v=>v!=null&&Number.isFinite(Number(v))&&Number(v)>=0))throw new Error('该HS编码的税率缺失或无效，请先在编码库核对');
  const settlement=await checked(admin.from('batch_settlements').select('confirmed,is_paid').eq('batch_id',data.batchId).eq('customer_code',data.customerCode).maybeSingle());
  if(settlement?.is_paid||settlement?.confirmed)throw new Error('该客户账单已付款或确认价格，请先处理账单锁定状态');
  const source=await loadPickingSource(admin,data.batchId);
  const parents=[...await selectByIds(admin,'forwarding_orders','id,customer_code','id',[...new Set<string>(source.wbs.map(w=>w.forwarding_id).filter(Boolean))])].filter(p=>p.customer_code===data.customerCode);
  const orders=(await selectByIds(admin,'orders','id,customer_code','id',[...new Set<string>(source.wbs.map(w=>w.order_id).filter(Boolean))])).filter(p=>p.customer_code===data.customerCode);
  const fids=new Set(parents.map(p=>p.id));
  const fi=source.fitems.filter(i=>fids.has(i.forwarding_id)&&i.name===data.name);
  const oi=(await selectByIds(admin,'order_items','id,order_id,name_zh,name_en','order_id',orders.map(p=>p.id))).filter(i=>(i.name_zh||i.name_en)===data.name);
  if(!fi.length&&!oi.length)throw new Error('没有找到该客户在本批次内对应的商品，请刷新后重试');
  const affected=[...new Set(fi.map(i=>i.forwarding_id))].map(id=>({table:'forwarding_orders',field:'forwarding_id',id})).concat([...new Set(oi.map(i=>i.order_id))].map(id=>({table:'orders',field:'order_id',id})));
  const waybills:any[]=[];
  for(const p of affected)waybills.push(...await selectByIds(admin,'waybills','id,payment_status',p.field,[p.id]));
  if(waybills.some(w=>w.payment_status==='paid'))throw new Error('同订单中存在已付款运单，请先核对账单，不能直接重算');
  const batchIds=await resolveWaybillBatchIds(admin,waybills.map(w=>w.id));
  if(batchIds.length){const locks=await selectByIds(admin,'batch_settlements','confirmed,is_paid','batch_id',batchIds,q=>q.eq('customer_code',data.customerCode));if(locks.some(s=>s.confirmed||s.is_paid))throw new Error('同订单在其他批次有已确认或已付款账单，请先解除相应锁定');}
  // Mark snapshots stale before writes; any failure is surfaced and can be retried.
  await markBatchFeesDirtyMany(admin,batchIds);
  for(const [table,items] of [['forwarding_items',fi],['order_items',oi]] as const)if(items.length)await checked(admin.from(table).update({hs_code:code,hs_confirmed:true}).in('id',items.map(i=>i.id)));
  let count=0;
  try {
   for(const p of affected){
    count+=await persistWaybillItemsForParent(admin,{[p.field]:p.id});
    const totals=await checked(admin.from('waybills').select('duty_cad').eq(p.field,p.id));
    const duty=+totals.reduce((n:number,w:any)=>n+Number(w.duty_cad??0),0).toFixed(2);
    const parent=await checked((admin as any).from(p.table).select('freight_snapshot').eq('id',p.id).single());
    const snap=parent.freight_snapshot??{};const previous=Number(snap.duty_cad??0);
    const next={...snap,duty_cad:duty,computed_at:new Date().toISOString()};
    if(Number.isFinite(Number(snap.total_cad)))next.total_cad=+(Number(snap.total_cad)-previous+duty).toFixed(2);
    await checked((admin as any).from(p.table).update({freight_snapshot:next}).eq('id',p.id));
   }
   for(const bid of [...new Set([data.batchId,...batchIds])]){const result=await refreshBatchSettlementsForCustomer(admin,bid,data.customerCode);if(!result.ok)throw new Error(result.error??'批次快照刷新失败');}
  }catch(e:any){throw new Error(`HS编码已保存，但费用更新未完成：${e.message}。修正问题后可再次保存重算。`);}
  await recordAdminLog(admin,{entity_type:'batch',entity_id:data.batchId,action:'set_customer_item_hs',operator_id:context.userId,after:{customer_code:data.customerCode,name:data.name,hs_code:code,waybills:count},note:'修改本客户对应订单商品HS，重算并保存运单及批次费用快照'});
  return {ok:true,items:fi.length+oi.length,waybills:count};
 });
