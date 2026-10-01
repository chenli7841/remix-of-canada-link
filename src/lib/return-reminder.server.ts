import { createHash } from 'node:crypto';

type Targets = { forwardingIds?: string[]; orderIds?: string[]; waybillIds?: string[]; cartonIds?: string[]; palletIds?: string[]; batchIds?: string[]; code?: string };

// Paginate descendants: a whole pallet can contain more than PostgREST's row limit.
async function rows(db: any, table: string, column: string, ids: string[], select: string) {
  const result: any[] = [];
  const unique = [...new Set(ids.filter(Boolean))];
  for (let start = 0; start < unique.length; start += 100) {
    for (let offset = 0; ; offset += 500) {
      const r = await db.from(table).select(select).in(column, unique.slice(start, start + 100)).order('id').range(offset, offset + 499);
      if (r.error) throw new Error('退运提醒读取失败，请检查迁移或重试；操作尚未执行');
      result.push(...(r.data ?? []));
      if ((r.data ?? []).length < 500) break;
    }
  }
  return result;
}

export async function collectReturnReminders(db: any, targets: Targets) {
  const pallets = [...(targets.palletIds ?? [])], cartons = [...(targets.cartonIds ?? [])];
  const waybills = [...(targets.waybillIds ?? [])], forwardings = [...(targets.forwardingIds ?? [])];
  const batches = [...(targets.batchIds ?? [])];
  if (targets.code?.trim()) {
    for (const [table, column, dest] of [
      ['waybills', 'waybill_no', waybills], ['cartons', 'carton_no', cartons],
      ['pallets', 'pallet_no', pallets], ['forwarding_orders', 'request_no', forwardings],
      ['batches', 'batch_no', batches],
    ] as const) {
      const r = await db.from(table).select('id').eq(column, targets.code.trim());
      if (r.error) throw new Error('退运提醒读取失败，操作尚未执行');
      dest.push(...(r.data ?? []).map((v: any) => v.id));
    }
  }
  pallets.push(...(await rows(db, 'pallets', 'batch_id', batches, 'id')).map(v => v.id));
  cartons.push(...(await rows(db, 'cartons', 'batch_id', batches, 'id')).map(v => v.id));
  cartons.push(...(await rows(db, 'cartons', 'pallet_id', pallets, 'id')).map(v => v.id));
  const descendants = [
    ...await rows(db, 'waybills', 'id', waybills, 'id,forwarding_id'),
    ...await rows(db, 'waybills', 'carton_id', cartons, 'id,forwarding_id'),
    ...await rows(db, 'waybills', 'pallet_id', pallets, 'id,forwarding_id'),
    ...await rows(db, 'waybills', 'order_id', targets.orderIds ?? [], 'id,forwarding_id'),
    ...await rows(db, 'waybills', 'assigned_batch_id', batches, 'id,forwarding_id'),
  ];
  forwardings.push(...descendants.map(v => v.forwarding_id).filter(Boolean));
  // Whole orders may be attached to containers before child waybills exist.
  const fields = 'id,request_no,note,return_reminder';
  const orders = [
    ...await rows(db, 'forwarding_orders', 'id', forwardings, fields),
    ...await rows(db, 'forwarding_orders', 'carton_id', cartons, fields),
    ...await rows(db, 'forwarding_orders', 'pallet_id', pallets, fields),
  ];
  return [...new Map(orders.filter(v => v.return_reminder).map(v => [v.id, {
    id: v.id, number: v.request_no, note: v.note || '此订单已标记退运，请联系负责人核实退运安排。',
  }])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

// The acknowledgement is scoped to this exact operation and current reminders.
// Re-read on retry, so a changed note or newly flagged descendant asks again.
export async function assertReturnReminder(db: any, operation: string, data: any, targets: Targets) {
  const reminders = await collectReturnReminders(db, targets);
  if (!reminders.length) return;
  const { __returnReminderAck, ...payload } = data;
  const token = createHash('sha256').update(JSON.stringify({ operation, payload, reminders })).digest('hex');
  if (__returnReminderAck === token) return;
  throw new Error('RETURN_REMINDER:' + JSON.stringify({ token, reminders }));
}
