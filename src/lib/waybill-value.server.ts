// Use the existing allocated item snapshot. Insurance must not redistribute order value.
export async function allocatedWaybillValueCad(admin: any, waybillId: string): Promise<number> {
  if (!waybillId) throw new Error("缺少运单编号，无法读取运单货值");
  const { data, error } = await admin.from("waybill_items")
    .select("declared_value_cad").eq("waybill_id", waybillId);
  if (error) throw new Error("读取运单货值失败，请重试");
  if (!data?.length) throw new Error("运单货值尚未分配，请先保存运单物品明细再计算保费");
  let total = 0;
  for (const item of data) {
    const value = Number(item.declared_value_cad);
    if (item.declared_value_cad == null || !Number.isFinite(value) || value < 0)
      throw new Error("运单物品货值不完整，请先检查物品明细");
    total += value;
  }
  return +total.toFixed(2);
}
