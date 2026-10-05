import { createServerFn } from '@tanstack/react-start';
import { requireSupabaseAuth } from '@/integrations/supabase/auth-middleware';
import { recordAdminLog } from '@/lib/admin-log';
async function staff(context: any) {
  const r = await context.supabase.rpc('is_staff', { _user_id: context.userId });
  if (r.error || !r.data) throw new Error('仅工作人员可以查看和修改结算备注');
}
export const listBatchCustomerNotes = createServerFn({ method: 'GET' }).middleware([requireSupabaseAuth])
 .inputValidator((d: { batchId: string }) => d).handler(async ({ data, context }) => {
  await staff(context);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { data: rows, error } = await (supabaseAdmin as any).from('batch_customer_notes').select('customer_code,note').eq('batch_id', data.batchId);
  if (error) throw new Error('结算备注读取失败，请确认已执行结算备注迁移');
  return (rows ?? []) as { customer_code: string; note: string }[];
 });
export const saveBatchCustomerNote = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
 .inputValidator((d: { batchId: string; customerCode: string; note: string }) => d).handler(async ({ data, context }) => {
  await staff(context);
  if (!data.batchId || !data.customerCode.trim() || data.note.length > 2000) throw new Error('请指定批次、客户号，备注不超过2000字');
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const { error } = await (supabaseAdmin as any).from('batch_customer_notes').upsert({ batch_id: data.batchId,
    customer_code: data.customerCode.trim(), note: data.note.trim(), updated_at: new Date().toISOString(), updated_by: context.userId });
  if (error) throw new Error('备注保存失败，请确认已执行结算备注迁移');
  await recordAdminLog(supabaseAdmin, { entity_type: 'batch', entity_id: data.batchId, action: 'update_note',
    operator_id: context.userId, note: '修改客户结算备注', after: { customer_code: data.customerCode, note: data.note.trim() } });
  return { ok: true };
 });

export const saveDeliveryExtraFee = createServerFn({ method: 'POST' }).middleware([requireSupabaseAuth])
 .inputValidator((d: { batchId: string; customerCode: string; amountCny: number }) => {
  if (!d.batchId || !d.customerCode?.trim() || typeof d.amountCny !== 'number' || !Number.isFinite(d.amountCny) || d.amountCny < 0 || d.amountCny > 9999999999.99 || Math.abs(d.amountCny * 100 - Math.round(d.amountCny * 100)) > 0.0001) throw new Error('请输入有效金额，不能为负数，最多两位小数');
  return d;
 }).handler(async ({ data, context }) => {
  await staff(context);
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server');
  const {data: payment,error: paymentError} = await supabaseAdmin.from('wallet_transactions').select('id').eq('ref_no','delivery-extra:' + data.batchId + ':' + data.customerCode.trim()).limit(1);
  if (paymentError) throw new Error('付款状态读取失败');
  if (payment?.length) throw new Error('此额外费用已有扣款记录，不能修改金额');
  const { error } = await (supabaseAdmin as any).from('batch_customer_notes').upsert({ batch_id: data.batchId,
    customer_code: data.customerCode.trim(), extra_fee_cny: data.amountCny, updated_at: new Date().toISOString(), updated_by: context.userId });
  if (error) throw new Error('额外费用保存失败，请确认已执行额外费用迁移');
  await recordAdminLog(supabaseAdmin, {entity_type:'batch',entity_id:data.batchId,action:'update_delivery_extra_fee',operator_id:context.userId,
    note:'修改客户批次的派送额外费用（人民币）',after:{customer_code:data.customerCode,extra_fee_cny:data.amountCny}});
  return {ok:true};
 });
