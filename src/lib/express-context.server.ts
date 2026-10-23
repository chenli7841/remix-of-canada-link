import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  mapAddress,
  sourceKey,
  sourceSchema,
  type ExpressSource,
  type ExpressAddress,
  type ExpressDraft,
} from "./express";
import { fingerprint } from "./verykship.server";

export const expressDb = supabaseAdmin as any;
const tables = {
  order: "orders",
  forwarding: "forwarding_orders",
  waybill: "waybills",
  carton: "cartons",
  pallet: "pallets",
  batch: "batches",
  dispatch: "express_dispatch_drafts",
};
export async function dbOne(table: string, id: string) {
  const { data, error } = await expressDb.from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("记录不存在或已删除");
  return data;
}
async function children(table: string, column: string, id: string) {
  const { data, error, count } = await expressDb
    .from(table)
    .select("*", { count: "exact" })
    .eq(column, id)
    .limit(1000);
  if (error) throw new Error(error.message);
  if (count > 1000) throw new Error("货物超过一次处理范围，请按箱或托盘分开处理");
  return data ?? [];
}
type ShippingContext = {
  source: ExpressSource;
  number: string;
  ownerId: string | null;
  links: string[];
  coverage: string[];
  contextHash: string;
  units: Array<{ source: ExpressSource; number: string }>;
  allowedToShip: boolean;
  destination: ExpressAddress;
  packageType: "parcel" | "pallet";
  packages: ExpressDraft["packages"];
};
export async function expressContext(
  source: ExpressSource,
  userId: string,
  staff: boolean,
): Promise<ShippingContext> {
  if (source.kind === "dispatch") {
    if (!staff) throw Error("仅员工可以管理合并派送单");
    const group = await dbOne("express_dispatch_drafts", source.id);
    const members = group.source?.members;
    if (!Array.isArray(members) || !members.length || members.length > 100)
      throw Error("合并派送单位无效");
    const children: ShippingContext[] = [];
    for (const value of members) {
      const member = sourceSchema.parse(value);
      if (["dispatch", "batch"].includes(member.kind)) throw Error("合并派送单不能嵌套");
      children.push(await expressContext(member, userId, staff));
    }
    const coverage = children.flatMap((c) => c.coverage);
    if (new Set(coverage).size !== coverage.length) throw Error("合并派送包含重复或相互包含的包裹");
    if (new Set(children.map((c) => c.packageType)).size !== 1) throw Error("包裹和托盘需分别出单");
    const owners = new Set(children.map((c) => c.ownerId));
    if (owners.size !== 1 || owners.has(null)) throw Error("合并派送必须属于同一客户");
    return {
      source,
      number: group.number,
      ownerId: children[0].ownerId,
      links: [...new Set([sourceKey(source), ...children.flatMap((c) => c.links)])].sort(),
      coverage: coverage.sort(),
      contextHash: fingerprint({
        members: children.map((c) => [sourceKey(c.source), c.contextHash]),
        draft: group.draft,
      }),
      units: [{ source, number: group.number }],
      allowedToShip: children.every((c) => c.allowedToShip),
      destination: mapAddress(group.draft.to),
      packageType: children[0].packageType,
      packages: group.draft.packages,
    };
  }
  const root = await dbOne(tables[source.kind], source.id);
  let address = root.address_snapshot;
  let owner = root.user_id ?? root.customer_user_id ?? null;
  if (!address && source.kind === "forwarding" && root.address_id)
    address = await dbOne("addresses", root.address_id);
  if (source.kind === "waybill") {
    const parent = root.order_id
      ? await dbOne("orders", root.order_id)
      : root.forwarding_id
        ? await dbOne("forwarding_orders", root.forwarding_id)
        : null;
    owner = parent?.user_id ?? null;
    address =
      parent?.address_snapshot ??
      (parent?.address_id ? await dbOne("addresses", parent.address_id) : null);
  }
  if (!staff && (!owner || owner !== userId || source.kind === "batch"))
    throw new Error("无权访问该货物");
  const nodes = new Map<string, { source: ExpressSource; row: any }>();
  async function walk(s: ExpressSource, row: any) {
    if (nodes.has(sourceKey(s))) return;
    nodes.set(sourceKey(s), { source: s, row });
    if (nodes.size > 1000) throw new Error("货物过多，请缩小处理范围");
    const edge: [ExpressSource["kind"], string][] =
      s.kind === "batch"
        ? [
            ["pallet", "batch_id"],
            ["carton", "batch_id"],
            ["waybill", "assigned_batch_id"],
          ]
        : s.kind === "pallet"
          ? [
              ["carton", "pallet_id"],
              ["waybill", "pallet_id"],
              ["order", "pallet_id"],
              ["forwarding", "pallet_id"],
            ]
          : s.kind === "carton"
            ? [
                ["waybill", "carton_id"],
                ["order", "carton_id"],
                ["forwarding", "carton_id"],
              ]
            : s.kind === "order"
              ? [["waybill", "order_id"]]
              : s.kind === "forwarding"
                ? [["waybill", "forwarding_id"]]
                : [];
    for (const [kind, col] of edge)
      for (const child of await children(tables[kind], col, s.id))
        await walk({ kind, id: child.id }, child);
  }
  await walk(source, root);
  const links = new Set(nodes.keys());
  const owners = new Set<string>();
  const known = new Map<string, any>();
  async function ancestor(kind: ExpressSource["kind"], id: string | null) {
    if (!id) return;
    const k = `${kind}:${id}`;
    links.add(k);
    if (known.has(k)) return known.get(k);
    const r = await dbOne(tables[kind], id);
    known.set(k, r);
    if (kind === "order" || kind === "forwarding") {
      owners.add(r.user_id ?? "unknown");
      await ancestor("carton", r.carton_id);
      await ancestor("pallet", r.pallet_id);
    }
    if (kind === "carton") await ancestor("pallet", r.pallet_id);
    if (r.batch_id) links.add(`batch:${r.batch_id}`);
    return r;
  }
  for (const { source: s, row } of nodes.values()) {
    if (s.kind === "waybill") {
      await ancestor("order", row.order_id);
      await ancestor("forwarding", row.forwarding_id);
      if (!row.order_id && !row.forwarding_id) owners.add("unknown");
    }
    if (s.kind === "order" || s.kind === "forwarding") owners.add(row.user_id ?? "unknown");
    if (s.kind === "carton" || s.kind === "pallet") owners.add(row.customer_user_id ?? "unknown");
    await ancestor("carton", row.carton_id);
    await ancestor("pallet", row.pallet_id);
    if (row.batch_id ?? row.assigned_batch_id)
      links.add(`batch:${row.batch_id ?? row.assigned_batch_id}`);
  }
  const sharedOwner = owners.size === 1 && !owners.has("unknown") ? [...owners][0] : null;
  if (!staff && (owners.size !== 1 || !owners.has(userId)))
    throw new Error("该集合包含无法确认归属的货物，请联系工作人员");
  const number = (s: ExpressSource, r: any) =>
    String(
      r.waybill_no ??
        r.carton_no ??
        r.pallet_no ??
        r.order_no ??
        r.request_no ??
        r.batch_no ??
        s.id,
    );
  const units = [...nodes.values()]
    .filter(({ source: s, row }) => {
      if (s.kind === "batch") return false;
      // Orders expand to their physical waybills rather than issuing duplicate aggregate labels.
      if (s.kind === "order" || s.kind === "forwarding")
        return ![...nodes.values()].some(
          (n) =>
            n.source.kind === "waybill" &&
            (n.row.order_id === row.id || n.row.forwarding_id === row.id),
        );
      return true;
    })
    .map(({ source: s, row }) => ({ source: s, number: number(s, row) }));
  const coverage = [...nodes.values()]
    .filter(({ source: s, row }) => {
      if (s.kind === "batch") return false;
      if (s.kind === "order" || s.kind === "forwarding")
        return ![...nodes.values()].some(
          (n) =>
            n.source.kind === "waybill" &&
            (n.row.order_id === row.id || n.row.forwarding_id === row.id),
        );
      return true;
    })
    .map((n) => sourceKey(n.source))
    .sort();
  const snapshot = [...nodes]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { row }]) => ({
      key,
      weight: row.weight_kg,
      l: row.length_cm,
      w: row.width_cm,
      h: row.height_cm,
      carton: row.carton_id,
      pallet: row.pallet_id,
      address: row.address_snapshot,
      status: row.status,
    }));
  return {
    source,
    number: number(source, root),
    ownerId: sharedOwner ?? (nodes.size === 1 ? owner : null),
    links: [...links].sort(),
    coverage,
    contextHash: fingerprint({
      snapshot,
      address,
      owners: [...owners].sort(),
      links: [...links].sort(),
    }),
    units,
    allowedToShip:
      source.kind !== "batch" &&
      !["cancelled", "delivered"].includes(root.status) &&
      units.some((u) => sourceKey(u.source) === sourceKey(source)),
    destination: mapAddress(address),
    packageType: source.kind === "pallet" ? ("pallet" as const) : ("parcel" as const),
    packages: [
      {
        weightKg: Number(root.weight_kg ?? 0),
        lengthCm: Number(root.length_cm ?? 0),
        widthCm: Number(root.width_cm ?? 0),
        heightCm: Number(root.height_cm ?? 0),
      },
    ],
  };
}
