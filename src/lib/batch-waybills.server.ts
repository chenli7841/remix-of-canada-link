// Payment and invoice generation must include cartons nested in pallets.
// Page both container and waybill queries; never treat a failed query as an empty batch.
export async function readBatchRows(admin: any, table: string, columns: string, filter: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await filter(admin.from(table).select(columns)).order("id").range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function readBatchRowsByIds(admin: any, table: string, columns: string, key: string, ids: string[]): Promise<any[]> {
  const out: any[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    out.push(...await readBatchRows(admin, table, columns, q => q.in(key, unique.slice(i, i + 100))));
  }
  return out;
}

export async function loadBatchWaybills(admin: any, batchId: string): Promise<any[]> {
  const [direct, cartons, pallets] = await Promise.all([
    readBatchRows(admin, "waybills", "*", q => q.eq("assigned_batch_id", batchId).is("carton_id", null).is("pallet_id", null)),
    readBatchRows(admin, "cartons", "id", q => q.eq("batch_id", batchId)),
    readBatchRows(admin, "pallets", "id", q => q.eq("batch_id", batchId)),
  ]);
  const palletIds = pallets.map(p => p.id);
  const nestedCartons = await readBatchRowsByIds(admin, "cartons", "id", "pallet_id", palletIds);
  const [cartonWbs, palletWbs] = await Promise.all([
    readBatchRowsByIds(admin, "waybills", "*", "carton_id", [...cartons, ...nestedCartons].map(c => c.id)),
    readBatchRowsByIds(admin, "waybills", "*", "pallet_id", palletIds),
  ]);
  // For a waybill inside a carton, the carton determines membership.
  return [...new Map([...direct, ...cartonWbs, ...palletWbs.filter(w => !w.carton_id)].map(w => [w.id, w])).values()];
}

/** Resolve only this customer's leaves, including containers, without exposing other customers. */
export async function loadCustomerBatchWaybills(admin: any, userId: string): Promise<any[]> {
  const waybills = await readBatchRows(admin, "waybills",
    "id,user_id,assigned_batch_id,carton_id,pallet_id,order_id,forwarding_id,waybill_no,status,payment_status,intl_tracking_no",
    q => q.eq("user_id", userId));
  const cartons = await readBatchRowsByIds(admin, "cartons", "id,batch_id,pallet_id", "id",
    waybills.map(w => w.carton_id).filter(Boolean));
  const pallets = await readBatchRowsByIds(admin, "pallets", "id,batch_id", "id",
    [...cartons.map(c => c.pallet_id), ...waybills.filter(w => !w.carton_id).map(w => w.pallet_id)].filter(Boolean));
  const cartonMap = new Map(cartons.map(c => [c.id,c]));
  const palletMap = new Map(pallets.map(p => [p.id,p]));
  return waybills.map(w => {
    const carton = cartonMap.get(w.carton_id);
    // Current outer container wins; do not resurrect an old direct assignment after a move.
    const batchId = w.carton_id
      ? (carton?.pallet_id ? palletMap.get(carton.pallet_id)?.batch_id : carton?.batch_id)
      : w.pallet_id ? palletMap.get(w.pallet_id)?.batch_id : w.assigned_batch_id;
    return { ...w, assigned_batch_id: batchId ?? null };
  }).filter(w => w.assigned_batch_id);
}
