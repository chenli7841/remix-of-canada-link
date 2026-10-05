const actions: Record<string, string> = {
  "delivery_queue.dispatched": "确认派送",
  update_delivery_extra_fee: "修改派送额外费用",
  create: "创建", update: "修改", delete: "删除", save: "保存", set: "设置", add: "添加", cancel: "取消",
  confirm: "确认", lock: "锁定", unlock: "解锁", split: "拆分", merge: "合并", refund: "退款",
  create_forwarding: "创建集运单", admin_create_forwarding: "代客户创建集运单", create_from_forwarding: "从集运单创建运单",
  intake: "入库计费", intake_received: "扫码入库", inventory_intake: "库存入库", intake_overwrite_rebuild: "重新入库并更新包裹",
  change_route: "变更线路及目的地", update_dims: "修改尺寸及重量", measure_dims: "测量尺寸及重量",
  add_waybills: "新增运单", set_insured: "修改保险状态", update_domestic_tracking_no: "修改国内单号", update_basic_info: "修改基础信息",
  set_status: "修改状态", update_status: "更新状态", set_status_batch: "批量修改状态", ship_shop_order: "商城订单发货",
  add_tracking_event: "添加物流动态", add_tracking_batch: "批量添加物流动态", recalc_freight: "重新计算运费",
  wallet_deduct_paid: "钱包扣款支付", wallet_deduct_bulk: "钱包批量扣款", invoice_pay: "支付账单",
  "wallet.set": "设置钱包余额", "wallet.adjust": "调整钱包余额", set_roles: "设置员工角色",
  admin_edit_profile: "修改客户资料", assign_sales_rep: "分配销售负责人", generate_login_link: "生成登录链接", reset_password: "重置密码",
  admin_edit_address: "修改客户地址", admin_add_address: "添加客户地址", admin_delete_address: "删除客户地址",
  admin_edit_item: "修改客户物品", admin_add_item: "添加客户物品", admin_delete_item: "删除客户物品",
  set_vip_points: "修改客户等级及积分", set_fee_scheme: "设置计费方案", blacklist: "加入黑名单", unblacklist: "移出黑名单",
  update_customs_party: "修改报关信息", bulk_import: "批量导入", bind_name: "关联品名", set_hs_code: "设置海关编码",
  generate_for_waybill: "生成运单账单", generate_for_batch: "生成批次账单", adjust_stock: "调整库存",
  match_all_receiving: "一键匹配全部到货",
  scan: "扫码登记", remove_scan: "移除扫码记录", scan_match_batch: "扫码匹配批次", create_assign: "创建并分配容器",
  fee_auto_error: "自动计费失败", fee_auto_skip: "跳过自动计费", fee_auto_snapshot: "保存费用快照", freight_auto_compute: "自动计算运费",
  mark_detained: "标记扣留", recompute_waybill_fees: "重新计算运单费用", measure_assign_to_pallet: "测量后加入托盘", measure_waybill_assign_to_pallet: "测量运单后加入托盘",
  disable: "停用", bind: "绑定", unbind: "解除绑定", preview_only: "预览", send: "发送", sync: "同步",
  update_note: "修改备注", set_intake_reminder: "设置入库提醒", set_return_reminder: "设置退运提醒",
};
const entities: Record<string, string> = {
  order: "订单", forwarding: "集运单", customer_forwarding: "客户集运单", waybill: "运单", batch: "批次", carton: "箱号", pallet: "托盘",
  profile: "客户资料", customer: "客户", invoice: "账单", surcharge: "附加费", tracking_event: "物流动态", receiving: "收货单",
  settings: "系统设置", route: "线路", shop_cart: "购物车", product: "商品", inventory: "库存", address: "地址", hs_code: "海关编码",
};
export function logActionLabel(action: string): string {
  if (actions[action]) return actions[action];
  const match = /^(waybill_)?(assign|remove|scan_add)(?:_to)?_(waybill|carton|pallet|batch)$/.exec(action);
  if (match) return `${match[1] ? "运单" : ""}${match[2] === "remove" ? "移出" : match[2] === "scan_add" ? "扫码加入" : "加入"}${entities[match[3]]}`;
  return /[\u4e00-\u9fff]/.test(action) ? action : "其他操作";
}
export function logEntityLabel(entity: string): string {
  return entities[entity] || (/[\u4e00-\u9fff]/.test(entity) ? entity : "其他记录");
}

const fields: Record<string,string> = { dispatched_by_name: "派送人员", dispatched_at: "派送时间", code: "编号", extra_fee_cny: "额外费用（人民币）", before: "修改前", after: "修改后", status: "状态", note: "备注", request_no: "集运单号", waybill_no: "运单号", order_no: "订单号", domestic_tracking_no: "国内单号", weight_kg: "重量（公斤）", length_cm: "长度（厘米）", width_cm: "宽度（厘米）", height_cm: "高度（厘米）", amount_cny: "金额（人民币）", amount_cad: "金额（加元）", total_cad: "合计（加元）", fee_cny: "费用（人民币）", insured: "购买保险", creation_source: "创建来源", created_by: "创建人", owner_user_id: "归属客户", count: "数量", quantity: "数量", route_code: "线路编号", warehouse: "仓库", payment_status: "付款状态", id: "记录编号", forwarding_id: "集运单编号", waybill_id: "运单编号", batch_id: "批次编号", carton_id: "箱号编号", pallet_id: "托盘编号" };
const values: Record<string,string> = { pending: "待处理", received: "已入库", packed: "已打包", shipped: "已发出", delivered: "已送达", cancelled: "已取消", paid: "已付款", unpaid: "未付款", customer: "客户", staff: "工作人员", system_api: "系统接口" };
export function logDetailsText(value: unknown): string {
  if (value == null) return "未设置";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.map(logDetailsText).join("；");
  if (typeof value === "object") return Object.entries(value).map(([key,v]) => `${fields[key] || (/[\u4e00-\u9fff]/.test(key) ? key : "其他信息")}：${logDetailsText(v)}`).join("\n");
  return values[String(value)] || String(value);
}
