export function insuranceCad(declared: number | null, rate: number, insured: boolean): number {
  if (insured !== true || !Number.isFinite(declared) || !Number.isFinite(rate) || !declared || declared <= 0 || rate <= 0) return 0;
  return +(declared * rate / 100).toFixed(2);
}

export function uniqueWaybills<T extends { id: string }>(rows: T[]): T[] {
  return [...new Map(rows.map(row => [row.id, row])).values()];
}
