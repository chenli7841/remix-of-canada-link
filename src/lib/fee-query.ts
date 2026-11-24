/** Read every fee source row; PostgREST otherwise caps large containers/batches. */
export async function readAllFeeRows(query: () => any) {
  const data: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const page = await query().order("id", { ascending: true }).range(offset, offset + 499);
    if (page.error) throw new Error(page.error.message);
    data.push(...(page.data ?? []));
    if ((page.data?.length ?? 0) < 500) return { data, error: null };
  }
}
export function billingContainerRouteIds(cartons: any[], pallets: any[]) {
  return [...new Set([...cartons, ...pallets].filter(c => c.billing_mode === "merged" && c.route_id).map(c => c.route_id))];
}
