import { allocateContainerFreight } from "./freight-allocation";

/** Include all siblings before allocating; a single-order invoice must not receive the entire container fee. */
export async function effectiveFreightForWaybills(admin: any, waybills: any[]) {
  const ids = (values: any[]) => [...new Set(values.filter(Boolean))];
  async function read(table: string, column: string, keys: any[]) {
    const rows: any[] = [];
    for (let i=0;i<keys.length;i+=100) {
      for (let start=0;;start+=500) {
        const result = await admin.from(table).select("*").in(column, keys.slice(i,i+100)).order("id").range(start,start+499);
        if (result.error) throw new Error(result.error.message);
        rows.push(...result.data);
        if(result.data.length<500) break;
      }
    }
    return rows;
  }
  let cartons = await read("cartons", "id", ids(waybills.map(w=>w.carton_id)));
  const pallets = await read("pallets", "id", ids([...waybills.map(w=>w.pallet_id),...cartons.map(c=>c.pallet_id)]));
  const nested = await read("cartons", "pallet_id", pallets.filter(p=>p.billing_mode==="merged").map(p=>p.id));
  cartons = [...new Map([...cartons,...nested].map(c=>[c.id,c])).values()];
  const siblings = await read("waybills", "carton_id", cartons.map(c=>c.id));
  const direct = await read("waybills", "pallet_id", pallets.filter(p=>p.billing_mode==="merged").map(p=>p.id));
  return { allocations: allocateContainerFreight([...waybills,...siblings,...direct],cartons,pallets), cartons, pallets };
}
