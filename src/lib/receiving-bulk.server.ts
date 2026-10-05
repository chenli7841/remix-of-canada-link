// Read every page, including contents nested in boxes/pallets without a batch ID.
export async function loadReceivingContents(db: any, batchId: string) {
  async function read(table: string, fields: string, column: string, ids: string[]) {
    const found = new Map<string, any>();
    for (let start = 0; start < ids.length; start += 100) {
      for (let offset = 0; ; offset += 500) {
        const result = await db.from(table).select(fields).in(column, ids.slice(start, start + 100))
          .order('id').range(offset, offset + 499);
        if (result.error) throw new Error('批次明细读取失败，请重试');
        for (const row of result.data ?? []) found.set(row.id, row);
        if ((result.data ?? []).length < 500) break;
      }
    }
    return [...found.values()];
  }
  const pallets = await read('pallets', 'id,pallet_no', 'batch_id', [batchId]);
  const cartonFields = 'id,carton_no,pallet_id';
  const cartons = [...new Map([
    ...await read('cartons', cartonFields, 'batch_id', [batchId]),
    ...await read('cartons', cartonFields, 'pallet_id', pallets.map(p => p.id)),
  ].map(c => [c.id, c])).values()];
  // Customer numbers belong to parent orders, not the waybills table.
  const wbFields = 'id,waybill_no,status,carton_id,pallet_id,forwarding_orders:forwarding_id(customer_code),orders:order_id(customer_code)';
  const waybills = [...new Map([
    ...await read('waybills', wbFields, 'assigned_batch_id', [batchId]),
    ...await read('waybills', wbFields, 'carton_id', cartons.map(c => c.id)),
    ...await read('waybills', wbFields, 'pallet_id', pallets.map(p => p.id)),
  ].map(w => [w.id, w])).values()];
  return {
    waybills: waybills.map(w => ({
      ...w,
      customer_code: w.forwarding_orders?.customer_code ?? w.orders?.customer_code ?? null,
    })),
    cartons, pallets,
  };
}

export async function recordAllReceivingScans(db: any, receivingId: string, batchId: string, operatorId: string) {
  const contents = await loadReceivingContents(db, batchId);
  const scannedAt = new Date().toISOString();
  const rows = [
    ...contents.waybills.map(w => ({ kind: 'waybill', ref_id: w.id, code: w.waybill_no })),
    ...contents.cartons.map(c => ({ kind: 'carton', ref_id: c.id, code: c.carton_no })),
    ...contents.pallets.map(p => ({ kind: 'pallet', ref_id: p.id, code: p.pallet_no })),
  ].map(row => ({ ...row, receiving_id: receivingId, operator_id: operatorId, scanned_at: scannedAt }));
  if (!rows.length) throw new Error('当前批次没有可匹配的运单、箱号或托盘');
  if (rows.some(row => !row.code)) throw new Error('批次中存在缺少编号的记录，请先补全编号');
  // Recheck after loading: refuse stale pages and finalized receivings.
  const recv = await db.from('receivings').select('batch_id,status').eq('id', receivingId).single();
  if (recv.error || recv.data?.batch_id !== batchId || !['open', 'matched'].includes(recv.data?.status)) {
    throw new Error('收货单状态或匹配批次已变化，请刷新后重试');
  }
  // One atomic insert; repeat clicks never overwrite existing scan operators/times.
  const result = await db.from('receiving_scans').upsert(rows, {
    onConflict: 'receiving_id,kind,ref_id', ignoreDuplicates: true, count: 'exact',
  });
  if (result.error) throw new Error('一键匹配失败，请重试：' + result.error.message);
  return { waybills: contents.waybills.length, cartons: contents.cartons.length, pallets: contents.pallets.length };
}
