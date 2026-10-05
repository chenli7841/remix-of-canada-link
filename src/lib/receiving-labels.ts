export function receivingBatchLabel(batch: { display_name?: string | null; batch_no: string | null }) {
  const name = batch.display_name?.trim();
  const number = batch.batch_no?.trim();
  return name && number ? `${name}（${number}）` : name || number || "未命名批次";
}

export function receivingWarehouseLabel(
  code: string | null | undefined,
  warehouses: ReadonlyArray<{ code: string; name_zh?: string | null }> = [],
) {
  if (!code?.trim()) return "—";
  const warehouse = warehouses.find((w) => w.code.trim().toUpperCase() === code.trim().toUpperCase());
  return warehouse?.name_zh?.trim() || code;
}
