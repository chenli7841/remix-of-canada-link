// ensureUnpaidBatchInvoice 返回的账单跳过/失败原因码 → 后台可读文案
export function invoiceReasonText(reason: string): string {
  switch (reason) {
    case "no_orders_for_customer":
      return "该客户号查不到订单/集运单，请检查客户号是否填错或未绑定";
    case "no_matching_waybills_in_batch":
      return "该客户有订单，但这一柜里没有任何运单指向他，请检查装柜/客户号是否对应错误";
    case "customer_not_found":
      return "客户号不存在";
    case "already_paid":
      return "该客户本批运费已结清，且无未收的批次级费用";
    case "nothing_to_bill":
      return "费用合计为 0，无需出账单";
    default:
      return reason || "未知原因";
  }
}
