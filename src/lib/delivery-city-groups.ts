/** Group using the same structured address displayed on the delivery row. */
export function groupDeliveriesByCity<T extends { city?: string | null; province?: string | null; country?: string | null; customer_user_id?: string | null; customer_code?: string | null; key?: string; count: number }>(rows: T[]) {
  const clean = (value?: string | null) => (value || '').trim().replace(/\s+/g, ' ');
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const groups = new Map<string, { key: string; city: string; province: string; country: string; rows: T[]; customers: Set<string>; count: number }>();
  for (const row of rows) {
    const city = clean(row.city), province = clean(row.province), country = clean(row.country);
    const key = city ? JSON.stringify([normalize(country), normalize(province), normalize(city)]) : 'unknown';
    const group = groups.get(key) || { key, city: city || '未填写城市', province: city ? province : '', country: city ? country : '', rows: [], customers: new Set<string>(), count: 0 };
    group.rows.push(row);
    group.customers.add(row.customer_user_id || row.customer_code || row.key || 'unknown');
    group.count += Number(row.count || 0);
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === 'unknown') return 1;
    if (b.key === 'unknown') return -1;
    return a.city.localeCompare(b.city, 'zh-CN', { sensitivity: 'base' }) || a.key.localeCompare(b.key);
  });
}
