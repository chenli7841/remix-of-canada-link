// Permanent operational batch. Customer billing is intentionally not enabled yet.
export const SPECIAL_HANDLING_BATCH_ID = 'c5ec1a10-1111-4111-8111-000000000001';
export function assertRegularBillingBatch(id: string) {
  if (id === SPECIAL_HANDLING_BATCH_ID) throw new Error('特殊处理订单目前仅开放后台管理和派送；逐次生成新账单功能尚未启用，不可使用普通批次结算。');
}
