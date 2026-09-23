// Read the route itself: an obsolete freight rule must never enable sensitive insurance.
export async function routeInsuranceRate(admin: any, routeId: string, rate: unknown): Promise<number> {
  const { data, error } = await admin.from("shipping_routes").select("cargo_type").eq("id", routeId).maybeSingle();
  if (error || !data) throw new Error("无法核对线路保险规则，请重试");
  return data.cargo_type === "sensitive" ? 0 : Number(rate ?? 0);
}
