// Resolve actual records rather than guessing from prefixes (legacy box numbers are numeric).
export async function resolveReceivingCode(db: any, raw: string) {
  const code = raw.trim().toUpperCase();
  async function one(table: string, fields: string, column: string, value: string) {
    const result = await db.from(table).select(fields).eq(column,value).maybeSingle();
    if (result.error) throw new Error(result.error.message);
    return result.data;
  }
  for (const [table,field,kind] of [['cartons','carton_no','carton'],['pallets','pallet_no','pallet'],['batches','batch_no','batch']] as const) {
    const row = await one(table,kind === 'batch' ? 'id,batch_no' : '*',field,code);
    if (row) {
      let batchId = row.batch_id;
      if (!batchId && row.pallet_id) batchId = (await one('pallets','batch_id','id',row.pallet_id))?.batch_id;
      return {kind,ref_id:row.id,label:row[field],batchId:batchId ?? null};
    }
  }
  // Orders are checked first so an order with multiple parcels is never silently resolved to one.
  let parent: {kind:string;id:string} | null = null;
  for (const [table,field,kind] of [['forwarding_orders','request_no','forwarding'],['orders','order_no','order']]) {
    const row = await one(table,'id',field,code);
    if (row) { parent={kind,id:row.id}; break; }
  }
  const hitResult = parent ? {data:parent,error:null} : await db.rpc('find_by_any_no',{_input:code});
  if (hitResult.error) throw new Error(hitResult.error.message);
  const hit = hitResult.data;
  let w: any;
  if (hit?.kind === 'order' || hit?.kind === 'forwarding') {
    const result = await db.from('waybills').select('id,waybill_no,assigned_batch_id,carton_id,pallet_id')
      .eq(hit.kind === 'order' ? 'order_id' : 'forwarding_id',hit.id).limit(2);
    if (result.error) throw new Error(result.error.message);
    if (!result.data?.length) throw new Error('该订单尚无运单，不能扫描确认');
    if (result.data.length > 1) throw new Error('该订单下有多个运单，不能扫描订单号，请逐个扫描具体运单号');
    w=result.data[0];
  } else if (hit?.kind === 'waybill') {
    w=await one('waybills','id,waybill_no,assigned_batch_id,carton_id,pallet_id','id',hit.id);
  }
  if (!w) throw new Error('未找到对应的运单、订单、箱号或托盘');
  let batchId=w.assigned_batch_id;
  const carton=w.carton_id ? await one('cartons','batch_id,pallet_id','id',w.carton_id) : null;
  batchId ||= carton?.batch_id;
  const palletId=w.pallet_id || carton?.pallet_id;
  if (!batchId && palletId) batchId=(await one('pallets','batch_id','id',palletId))?.batch_id;
  return {kind:'waybill' as const,ref_id:w.id,label:w.waybill_no,batchId:batchId ?? null};
}
