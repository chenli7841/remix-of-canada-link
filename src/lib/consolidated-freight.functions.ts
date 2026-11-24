import { readAllFeeRows } from "./fee-query";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Resolve container coverage, not merely whether the order belongs to a carton.
// Legacy billing gives a customer-coded pallet precedence over its cartons.
export const getConsolidatedFreightNotice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; kind: "forwarding" | "order" }) => {
    if (!data.id || !["forwarding", "order"].includes(data.kind)) throw new Error("订单参数无效");
    return data;
  })
  .handler(async ({ data, context }) => {
    // Authorize against the caller's RLS before reading container billing metadata.
    const parent = await context.supabase.from(data.kind === "forwarding" ? "forwarding_orders" : "orders")
      .select("id").eq("id", data.id).maybeSingle();
    if (parent.error || !parent.data) throw new Error("无法读取订单");
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const wb = await readAllFeeRows(() => admin.from("waybills").select("id,carton_id,pallet_id")
      .eq(data.kind === "forwarding" ? "forwarding_id" : "order_id", data.id));
    if (wb.error) throw new Error("无法读取运单收费方式");
    const unique = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => !!v))];
    const cartonIds = unique((wb.data ?? []).map(w => w.carton_id));
    const cartons = cartonIds.length ? await admin.from("cartons").select("id,carton_no,pallet_id,billing_mode").in("id", cartonIds) : { data: [], error: null };
    if (cartons.error) throw new Error("无法读取箱号收费方式");
    const palletIds = unique([...(wb.data ?? []).map(w => w.pallet_id), ...(cartons.data ?? []).map(c => c.pallet_id)]);
    const pallets = palletIds.length ? await admin.from("pallets").select("id,pallet_no,billing_mode").in("id", palletIds) : { data: [], error: null };
    if (pallets.error) throw new Error("无法读取托盘收费方式");
    const references = new Set<string>();
    let covered = 0;
    for (const w of wb.data ?? []) {
      const carton = cartons.data?.find(c => c.id === w.carton_id);
      const pallet = pallets.data?.find(p => p.id === (carton?.pallet_id ?? w.pallet_id));
      const owner = pallet?.billing_mode === "merged" ? pallet : carton?.billing_mode === "merged" ? carton : null;
      if (!owner) continue;
      covered++;
      references.add("pallet_no" in owner ? `托盘 ${owner.pallet_no}` : `箱号 ${owner.carton_no}`);
    }
    return { covered, total: wb.data?.length ?? 0, references: [...references] };
  });
