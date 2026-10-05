// Surcharge entry and batch billing both use CAD. amount_cny is a legacy
// database column name, not a request to apply the CNY exchange rate.
export function sumSurchargesCad(rows: { amount_cny?: number | string | null }[]): number {
  return +rows.reduce((sum, row) => sum + Number(row.amount_cny ?? 0), 0).toFixed(2);
}
