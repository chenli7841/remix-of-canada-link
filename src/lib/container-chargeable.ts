/** Preserve saved leaf weights and replace merged carton contents exactly once. */
export function containerChildChargeable(waybills: any[], cartons: any[] = []): number | null {
  const leaves = [...new Map(waybills.map(w => [w.id, w])).values()];
  const merged = new Map(cartons.filter(c => c.billing_mode === "merged").map(c => [c.id, c]));
  const weights: any[] = leaves.filter(w => !merged.has(w.carton_id)).map(w => w.weight_snapshot?.chargeable_weight);
  for (const c of merged.values()) weights.push(c.chargeable_weight_kg);
  if (weights.some(w => w == null || !Number.isFinite(Number(w)) || Number(w) < 0)) return null;
  return Math.round(weights.reduce((sum, w) => sum + Number(w), 0) * 1000) / 1000;
}
