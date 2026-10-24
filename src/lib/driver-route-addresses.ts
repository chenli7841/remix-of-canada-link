// Resolve saved manifests against the same current groups as the delivery queue.
// Keep membership and order; a shared stop may split when one customer moves.
export function resolveDriverRouteAddresses(route: any, groups: any[]) {
  if (!route?.plans) return route;
  const byId = new Map<string, any>();
  for (const group of groups) for (const id of group.ids) byId.set(id, group);
  const stops: any[] = [];
  for (const plan of route.plans) for (const stop of plan.stops) {
    const resolved: any[] = [];
    for (const customer of stop.customers) {
      const partitions = new Map<string, {group: any; ids: string[]}>();
      for (const id of customer.ids || []) {
        const group = byId.get(id);
        const address = group?.address ?? customer.address;
        if (!partitions.has(address)) partitions.set(address, {group, ids: []});
        partitions.get(address)!.ids.push(id);
      }
      if (!partitions.size) partitions.set(customer.address, {group: null, ids: []});
      for (const {group, ids} of partitions.values()) {
      const current = {
        ...customer, ids, address: group?.address ?? customer.address,
        phone: group?.phone ?? customer.phone,
        groups: (customer.groups || []).filter((g: any) => !g.ids || g.ids.some((id: string) => ids.includes(id)))
          .map((g: any) => ({...g, ids: g.ids?.filter((id: string) => ids.includes(id)),
            ...(group ? {address: group.address, city: group.city, province: group.province,
              country: group.country, phone: group.phone} : {}),
          })),
      };
      let target = resolved.find(s => s.address === current.address);
      if (!target) { target = {...stop, address: current.address, customers: []}; resolved.push(target); }
      target.customers.push(current);
      }
    }
    stops.push(...resolved);
  }
  const plans = [];
  let origin = route.origin || route.plans[0]?.origin;
  for (let i = 0; i < stops.length; i += 21) {
    const chunk = stops.slice(i, i + 21);
    plans.push({origin, stops: chunk});
    origin = chunk[chunk.length - 1].address;
  }
  return {...route, plans};
}

export function driverRouteMapKey(trip: any) {
  return trip.id + ':' + JSON.stringify(trip.route?.plans?.map((p: any) =>
    [p.origin, ...p.stops.map((s: any) => s.address)]));
}

// Count saved route stops, not parcels or customers. A partially delivered stop remains open.
export function driverStopProgress(trip: any) {
  const delivered = new Set<string>(trip.dispatched_ids || []);
  const stops = trip.route?.plans?.flatMap((plan: any) => plan.stops || []) || [];
  const remaining = stops.filter((stop: any) => (stop.customers || []).some((customer: any) =>
    !customer.ids?.length || customer.ids.some((id: string) => !delivered.has(id)),
  )).length;
  return {total: stops.length, remaining};
}

export function pendingCustomerNeighbors(route: any, items: any[], current: any) {
  const pending = new Set(items.filter(item => item.unit?.status === 'pending').map(item => item.queue_id));
  const entries = (route?.plans || []).flatMap((plan: any, planIndex: number) =>
    (plan.stops || []).flatMap((stop: any, stopIndex: number) =>
      (stop.customers || []).map((customer: any) => ({customer, planIndex, stopIndex,
        pending: (customer.ids || []).some((id: string) => pending.has(id))})),
    ));
  const index = entries.findIndex((entry: any) => entry.customer.customer_code === current?.customer_code &&
    entry.customer.ids?.some((id: string) => current?.ids?.includes(id)));
  return {
    previous: index < 0 ? null : entries.slice(0, index).reverse().find((entry: any) => entry.pending) || null,
    next: index < 0 ? null : entries.slice(index + 1).find((entry: any) => entry.pending) || null,
  };
}
