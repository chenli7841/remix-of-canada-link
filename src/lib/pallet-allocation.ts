export type AllocatableWaybill = { id: string; mark_no?: string | null; waybill_no: string; pallet_id?: string | null; carton_id?: string | null; weight_kg: number | null; length_cm?: number | null; width_cm?: number | null; height_cm?: number | null; items_summary?: {name?: string | null}[] | null };
function productKey(row: AllocatableWaybill) {
  const names = (row.items_summary ?? []).map(i => (i.name ?? '').trim().replace(/\s+/g,' ').toLowerCase()).filter(Boolean);
  return names.length ? JSON.stringify([...new Set(names)].sort()) : '';
}
export function planPallets<T extends AllocatableWaybill>(rows: T[], selected: Set<string>, counts: string[]) {
  const available = rows.filter(r => !r.pallet_id && !r.carton_id);
  const ordered = available.filter(r => !selected.size || selected.has(r.id)).sort((a,b) => (a.mark_no || a.waybill_no).localeCompare(b.mark_no || b.waybill_no, undefined, {numeric:true}) || a.id.localeCompare(b.id));
  // Keep each exact product combination together, with box order inside each group.
  // Unknown products remain separate; do not pretend they are the same commodity.
  const groups = new Map<string,T[]>();
  for (const row of ordered) { const key=productKey(row)||`unknown:${row.id}`; const group=groups.get(key)??[]; group.push(row); groups.set(key,group); }
  const pool = [...groups.values()].flatMap(group => {
    const measurements = new Map<string,T[]>();
    for (const row of group) {
      const values=[row.weight_kg,row.length_cm,row.width_cm,row.height_cm];
      const key=values.every(v=>v!=null&&Number.isFinite(Number(v))&&Number(v)>0)
        ? JSON.stringify(values.map(Number)) : `unknown:${row.id}`;
      const matches=measurements.get(key)??[]; matches.push(row); measurements.set(key,matches);
    }
    return [...measurements.values()].flat();
  });
  let offset=0;
  const cards=counts.map(raw=>{const n=Number(raw);const valid=/^\d+$/.test(raw)&&Number.isSafeInteger(n)&&n>0;const items=valid?pool.slice(offset,offset+n):[];if(valid)offset+=n;return {count:valid?n:0,valid,items,weight:items.reduce((s,r)=>s+(Number(r.weight_kg)>0?Number(r.weight_kg):0),0),missingWeight:items.filter(r=>!(Number(r.weight_kg)>0)).length};});
  return {available:available.length,pool,cards,total:offset,remaining:pool.length-offset,valid:cards.length>0&&cards.every(c=>c.valid)&&offset<=pool.length&&offset>0};
}
