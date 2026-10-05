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
