export type FreightLeaf = { id: string; freight_cad: number | null; carton_id?: string | null; pallet_id?: string | null };
export type FreightContainer = { id: string; billing_mode?: string; self_freight_cad?: number | null; pallet_id?: string | null };

/** Allocate integer cents deterministically; never charge both a container and its leaves. */
export function allocateContainerFreight(waybills: FreightLeaf[], cartons: FreightContainer[], pallets: FreightContainer[]) {
  const leaves = [...new Map(waybills.map(w => [w.id, w])).values()].sort((a,b) => a.id.localeCompare(b.id));
  const result = new Map<string, { freight_cad: number; source: string; kind: "waybill" | "carton" | "pallet" }>();
  const groups = new Map<string, { container: FreightContainer; kind: "carton" | "pallet"; leaves: FreightLeaf[] }>();
  for (const w of leaves) {
    const c = cartons.find(c => c.id === w.carton_id);
    const p = pallets.find(p => p.id === (c?.pallet_id ?? w.pallet_id));
    const owner = p?.billing_mode === "merged" ? p : c?.billing_mode === "merged" ? c : null;
    const kind = owner === p ? "pallet" : "carton";
    if (w.freight_cad == null || !Number.isFinite(Number(w.freight_cad)) || Number(w.freight_cad) < 0) throw new Error(`运单 ${w.id} 缺少有效运费，请先量尺称重`);
    if (!owner) { result.set(w.id, { freight_cad: Number(w.freight_cad), source: w.id, kind: "waybill" }); continue; }
    const key = `${kind}:${owner.id}`;
    if (!groups.has(key)) groups.set(key, { container: owner, kind, leaves: [] });
    groups.get(key)!.leaves.push(w);
  }
  for (const { container, kind, leaves: members } of groups.values()) {
    if (container.self_freight_cad == null || !Number.isFinite(Number(container.self_freight_cad)) || Number(container.self_freight_cad) < 0) throw new Error("合箱运费缺失，请先量尺称重");
    const cents = Math.round(Number(container.self_freight_cad) * 100);
    const basis = members.map(w => Math.round(Number(w.freight_cad) * 100));
    const total = basis.reduce((a,b) => a+b,0);
    if (!total && cents) throw new Error("合箱内部运单基础运费均为零，无法自动分摊，请补齐量尺费用");
    const shares = basis.map((b,i) => ({ i, cents: total ? Math.floor(cents*b/total) : 0, remainder: total ? (cents*b)%total : 0 }));
    let remainder = cents - shares.reduce((a,b) => a+b.cents,0);
    for (const share of [...shares].sort((a,b) => b.remainder-a.remainder || a.i-b.i)) { if (remainder-- > 0) share.cents++; }
    for (const share of shares) result.set(members[share.i].id, { freight_cad: share.cents/100, source: container.id, kind });
  }
  return result;
}
