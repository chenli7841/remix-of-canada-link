import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Waybill = Pick<Database["public"]["Tables"]["waybills"]["Row"], "carton_id" | "pallet_id" | "assigned_batch_id">;
export type LoadingReference = { id: string; name: string | null; number: string | null; missing: boolean };

const ids = (values: (string | null | undefined)[]) => [...new Set(values.filter((v): v is string => !!v))];

// Read actual container records, including indirect carton -> pallet -> batch membership.
// Do not use waybill.box_no: that can be the package sequence rather than the carton number.
export async function getForwardingLoading(client: SupabaseClient<Database>, waybills: Waybill[]) {
  async function load<T>(keys: string[], query: (part: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
    const rows: T[] = [];
    for (let i = 0; i < keys.length; i += 200) {
      const result = await query(keys.slice(i, i + 200));
      if (result.error) throw new Error("装载信息读取失败，请重试");
      rows.push(...(result.data ?? []));
    }
    return rows;
  }
  const cartonIds = ids(waybills.map(w => w.carton_id));
  const cartons = await load(cartonIds, part => client.from("cartons")
    .select("id,display_name,carton_no,pallet_id,batch_id").in("id", part));
  const palletIds = ids([...waybills.map(w => w.pallet_id), ...cartons.map(c => c.pallet_id)]);
  const pallets = await load(palletIds, part => client.from("pallets")
    .select("id,display_name,pallet_no,batch_id").in("id", part));
  const batchIds = ids([...waybills.map(w => w.assigned_batch_id), ...cartons.map(c => c.batch_id), ...pallets.map(p => p.batch_id)]);
  const batches = await load(batchIds, part => client.from("batches")
    .select("id,display_name,batch_no").in("id", part));

  function references<T extends { id: string; display_name: string | null }>(keys: string[], rows: T[], number: (row: T) => string | null): LoadingReference[] {
    const lookup = new Map(rows.map(row => [row.id, row]));
    return keys.map(id => {
      const row = lookup.get(id);
      return { id, name: row?.display_name?.trim() || null, number: row ? number(row)?.trim() || null : null, missing: !row };
    });
  }
  return {
    cartons: references(cartonIds, cartons, c => c.carton_no),
    pallets: references(palletIds, pallets, p => p.pallet_no),
    batches: references(batchIds, batches, b => b.batch_no),
    unassignedWaybills: waybills.filter(w => !w.carton_id && !w.pallet_id && !w.assigned_batch_id).length,
    totalWaybills: waybills.length,
  };
}
