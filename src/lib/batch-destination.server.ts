// Shared helper: a batch may accept several destinations (destination_codes).
// A waybill / carton / pallet can join the batch when its destination matches
// ANY of them. Empty list on either side = no restriction.

export async function getBatchDestinations(admin: any, batchId: string): Promise<string[]> {
  const { data } = await admin
    .from("batches")
    .select("destination_code, destination_codes")
    .eq("id", batchId)
    .maybeSingle();
  if (!data) return [];
  const list: string[] = Array.isArray((data as any).destination_codes)
    ? ((data as any).destination_codes as string[])
    : [];
  const merged = list.filter(Boolean);
  if (!merged.length && (data as any).destination_code) merged.push((data as any).destination_code);
  return merged.map((c) => String(c).toUpperCase());
}

export async function getChildDestination(
  admin: any,
  kind: "waybill" | "carton" | "pallet",
  id: string,
): Promise<string | null> {
  if (kind === "carton" || kind === "pallet") {
    const { data } = await admin
      .from(kind === "carton" ? "cartons" : "pallets")
      .select("destination_code")
      .eq("id", id)
      .maybeSingle();
    return (data as any)?.destination_code ?? null;
  }
  const { data: wb } = await admin.from("waybills").select("order_id, forwarding_id").eq("id", id).maybeSingle();
  if (!wb) return null;
  if ((wb as any).order_id) {
    const { data: o } = await admin
      .from("orders")
      .select("destination_code, address_snapshot")
      .eq("id", (wb as any).order_id)
      .maybeSingle();
    return (o as any)?.address_snapshot?.destination_code ?? (o as any)?.destination_code ?? null;
  }
  if ((wb as any).forwarding_id) {
    const { data: f } = await admin
      .from("forwarding_orders")
      .select("destination_code")
      .eq("id", (wb as any).forwarding_id)
      .maybeSingle();
    return (f as any)?.destination_code ?? null;
  }
  return null;
}

/** Throws when the child's destination is set and matches none of the batch destinations. */
export async function assertBatchDestinationMatch(
  admin: any,
  batchId: string,
  kind: "waybill" | "carton" | "pallet",
  id: string,
  label: string,
) {
  const allowed = await getBatchDestinations(admin, batchId);
  if (!allowed.length) return;
  const dest = await getChildDestination(admin, kind, id);
  if (!dest) return;
  if (allowed.includes(String(dest).toUpperCase())) return;
  throw new Error(`${label} 目的地 ${dest} 不在本批次允许的目的地（${allowed.join(" / ")}）内`);
}
