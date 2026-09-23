export function insuranceCad(declared: number | null, rate: number, insured: boolean): number {
  if (insured !== true || !Number.isFinite(declared) || !Number.isFinite(rate) || !declared || declared <= 0 || rate <= 0) return 0;
  return +(declared * rate / 100).toFixed(2);
}

export function uniqueWaybills<T extends { id: string }>(rows: T[]): T[] {
  return [...new Map(rows.map(row => [row.id, row])).values()];
}
export const SENSITIVE_INSURANCE_NOTICE = "敏感线路 不支持购买保险，若丢失按照最高每kg7刀赔付。";

export function supportsInsurance(route: { cargo_type?: string | null } | null | undefined): boolean {
  return !!route && route.cargo_type !== "sensitive";
}
