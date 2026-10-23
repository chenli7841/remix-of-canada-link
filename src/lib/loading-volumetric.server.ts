import {readBatchRowsByIds} from './batch-waybills.server';
import {savedVolumetricWeight} from './saved-volumetric-weight';

export function containerVolumetricWeight(row: any, divisor: unknown): number | null {
  const d = Number(divisor);
  if (!Number.isFinite(d) || d <= 0) return null;
  const dims = [row.self_length_cm ?? row.length_cm, row.self_width_cm ?? row.width_cm, row.self_height_cm ?? row.height_cm].map(Number);
  const volume = Number(row.self_volume_m3);
  const cm3 = Number.isFinite(volume) && volume > 0 ? volume * 1_000_000
    : dims.every(v => Number.isFinite(v) && v > 0) ? dims.reduce((a, b) => a * b, 1) : null;
  return cm3 === null ? null : cm3 / d;
}

export async function loadUnitVolumetricWeights(admin: any, units: any[]) {
  const ids = (kind: string) => units.filter(u => u.kind === kind).map(u => u.ref_id).filter(Boolean);
  const columns = 'id,route_id,self_volume_m3,self_length_cm,self_width_cm,self_height_cm,length_cm,width_cm,height_cm';
  const [waybills, cartons, pallets] = await Promise.all([
    readBatchRowsByIds(admin, 'waybills', 'id,weight_snapshot', 'id', ids('waybill')),
    readBatchRowsByIds(admin, 'cartons', columns, 'id', ids('carton')),
    readBatchRowsByIds(admin, 'pallets', columns, 'id', ids('pallet')),
  ]);
  const rules = await readBatchRowsByIds(admin, 'freight_rules', 'route_id,volumetric_divisor,is_active,created_at', 'route_id', [...cartons, ...pallets].map(r => r.route_id).filter(Boolean));
  const divisors = new Map<string, number>();
  for (const rule of rules.filter(r => r.is_active).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))) {
    if (!divisors.has(rule.route_id)) divisors.set(rule.route_id, rule.volumetric_divisor);
  }
  const weights = new Map<string, number | null>();
  for (const w of waybills) weights.set('waybill:' + w.id, savedVolumetricWeight(w.weight_snapshot));
  for (const [kind, rows] of [['carton', cartons], ['pallet', pallets]] as const) {
    for (const row of rows) weights.set(kind + ':' + row.id, containerVolumetricWeight(row, divisors.get(row.route_id)));
  }
  return new Map(units.map(u => [u.id, weights.get(u.kind + ':' + u.ref_id) ?? null]));
}
