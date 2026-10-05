export function groupDeliveryUnits(items: any[]) {
  const scope = (i: any) => i.source_batch_id || 'unassigned';
  const units = new Map(items.map(i => [scope(i) + ':' + i.kind + ':' + i.ref_id, i]));
  const groups = new Map<string, any>();
  for (const it of items) {
    if (it.kind !== 'waybill' && !it.customer_code?.trim()) continue;
    const pallet = it.pallet_id && units.get(scope(it) + ':pallet:' + it.pallet_id);
    const parentPallet = pallet?.customer_code?.trim() ? pallet : null;
    const carton = it.kind === 'waybill' && it.carton_id && units.get(scope(it) + ':carton:' + it.carton_id);
    const parentCarton = carton?.customer_code?.trim() ? carton : null;
    const owner = parentPallet || parentCarton || it;
    const customerKey = owner.customer_user_id || 'code:' + (owner.customer_code || 'unknown');
    const key = customerKey + ':' + scope(owner);
    if (!groups.has(key)) groups.set(key, { key, customer_user_id: owner.customer_user_id ?? null,
      customer_code: owner.customer_code ?? null, batch_id: owner.source_batch_id ?? null,
      count: 0, waybill_count: 0, carton_count: 0, pallet_count: 0, weight_kg: 0, fee_cny: 0,
      ids: [], earliest_at: owner.created_at, latest_at: owner.created_at });
    const g = groups.get(key);
    g.ids.push(it.id);
    // Covered descendants stay in the operation scope but do not count twice.
    if (owner !== it || units.get(scope(it) + ':' + it.kind + ':' + it.ref_id) !== it) continue;
    g.count++; g[it.kind + '_count']++;
    g.weight_kg += Number(it.weight_kg || 0); g.fee_cny += Number(it.fee_cny || 0);
    if (it.created_at < g.earliest_at) g.earliest_at = it.created_at;
  }
  return groups;
}

export function deliverySettlementSummary(settlement: any, batch: any) {
  if (!settlement) return { payment_label: '未确认价格', total_cad: null, chargeable_weight_kg: null };
  const breakdown = settlement.fee_breakdown;
  const fresh = settlement.confirmed || breakdown?.billing_version === 2 || (settlement.snapshot_at && (!batch?.fees_dirty_at || settlement.snapshot_at >= batch.fees_dirty_at));
  return { payment_label: settlement.is_paid ? '已付款' : settlement.confirmed ? '未付款' : '未确认价格',
    total_cad: fresh ? settlement.subtotal_cad : null,
    chargeable_weight_kg: fresh && breakdown?.weight_version === 1 ? breakdown.chargeable_weight_kg ?? null : null };
}
