// Missing backend measurements must stay unknown, never use a guessed divisor.
export function savedVolumetricWeight(snapshot: any): number | null {
  const raw = snapshot?.volumetric_weight;
  if ((typeof raw !== "number" && typeof raw !== "string") ||
      (typeof raw === "string" && raw.trim() === "")) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function orderVolumetricWeight(snapshot: any, waybillSnapshots: any[]): number | null {
  const saved = savedVolumetricWeight(snapshot);
  if (saved !== null) return saved;
  if (!waybillSnapshots.length) return null;
  let total = 0;
  for (const snapshot of waybillSnapshots) {
    const value = savedVolumetricWeight(snapshot);
    if (value === null) return null;
    total += value;
  }
  return total;
}
