import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { sourceSchema, mapAddress, draftSchema, addressSchema, packageSchema } from "./express";

// Drafts may be incomplete; the existing quote/purchase API validates every required field.
const draftAddress = addressSchema.extend(
  Object.fromEntries(
    ["name", "mobile_phone", "province", "city", "postalcode", "address"].map((k) => [
      k,
      z.string().max(200),
    ]),
  ),
);
const editableDraft = draftSchema.extend({
  from: draftAddress,
  to: draftAddress,
  packages: z
    .array(
      packageSchema.extend({
        weightKg: z.number().finite().min(0).max(100000),
        lengthCm: z.number().finite().min(0).max(10000),
        widthCm: z.number().finite().min(0).max(10000),
        heightCm: z.number().finite().min(0).max(10000),
      }),
    )
    .min(1)
    .max(100),
});

export const expressDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("list") }),
      z.object({
        action: z.literal("prepare"),
        keys: z.array(z.string().max(200)).min(1).max(100),
      }),
      z.object({ action: z.literal("scan"), code: z.string().trim().min(1).max(100) }),
      z.object({ action: z.literal("printScan"), code: z.string().trim().min(1).max(100) }),
      z.object({ action: z.literal("save"), source: sourceSchema, draft: editableDraft }),
    ]),
  )
  .handler(async ({ data, context }) => {
    const { expressDb: db, expressContext } = await import("./express-context.server");
    const { getExpressWorkspace } = await import("./express-service.server");
    const { data: staff, error } = await context.supabase.rpc("is_staff", {
      _user_id: context.userId,
    });
    if (error || !staff) throw Error("仅员工可以管理快递派送单");
    if (data.action === "list") {
      const r = await db
        .from("express_dispatch_drafts")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (r.error) throw Error("请先执行快递派送草稿数据库迁移：" + r.error.message);
      return { drafts: r.data ?? [] };
    }
    if (data.action === "save") {
      if (data.source.kind !== data.draft.source.kind || data.source.id !== data.draft.source.id)
        throw Error("派送单位不一致");
      await expressContext(data.source, context.userId, true);
      const r = await db
        .from("express_dispatch_drafts")
        .update({
          draft: data.draft,
          updated_at: new Date().toISOString(),
          updated_by: context.userId,
        })
        .eq("source_key", `${data.source.kind}:${data.source.id}`)
        .select("id")
        .single();
      if (r.error) throw Error(r.error.message);
      return { saved: true };
    }
    let sources: Array<{
      source: z.infer<typeof sourceSchema>;
      destination?: any;
      customer?: string;
    }> = [];
    if (data.action === "scan" || data.action === "printScan") {
      for (const [kind, table, column] of [
        ["carton", "cartons", "carton_no"],
        ["pallet", "pallets", "pallet_no"],
        ["waybill", "waybills", "waybill_no"],
        ["order", "orders", "order_no"],
        ["forwarding", "forwarding_orders", "request_no"],
      ] as const) {
        const r = await db.from(table).select("id").eq(column, data.code).limit(2);
        if (r.error) throw Error(r.error.message);
        for (const row of r.data ?? []) sources.push({ source: { kind, id: row.id } });
      }
      if (sources.length !== 1)
        throw Error(
          sources.length ? "单号匹配多个对象，请使用箱号或运单号" : "未找到该箱号／订单号／运单号",
        );
      if (data.action === "printScan") {
        const ws = await getExpressWorkspace(sources[0].source, context);
        const records = ws.records.filter((r: any) => r.status === "created");
        if (!records.length)
          throw Error("该货物尚无已生成的快递面单，请先从列表行内打开资料卡片确认出单");
        return { records };
      }
    } else {
      const { loadDeliveryGroups } = await import("./delivery-queue.functions");
      const { groups } = await loadDeliveryGroups("pending");
      const selected = groups.filter((g) => data.keys.includes(g.key));
      if (selected.length !== new Set(data.keys).size)
        throw Error("勾选记录已变化，请刷新重新选择");
      for (const g of selected) {
        const r = await db
          .from("delivery_queue")
          .select("kind,ref_id")
          .in("id", g.ids)
          .eq("status", "pending");
        if (r.error) throw Error(r.error.message);
        let recipient = g.full_name;
        if (g.editable_address?.addressId) {
          const a = await db
            .from("addresses")
            .select("recipient")
            .eq("id", g.editable_address.addressId)
            .single();
          if (a.error) throw Error(a.error.message);
          recipient = a.data.recipient || recipient;
        }
        for (const row of r.data ?? [])
          sources.push({
            source: sourceSchema.parse({ kind: row.kind, id: row.ref_id }),
            customer: g.customer_code,
            destination: mapAddress({ ...g.editable_address, recipient, phone: g.phone }),
          });
      }
    }
    // Physical containers cover their children; do not create a second label for a contained waybill.
    const expanded: typeof sources = [];
    for (const item of sources) {
      const ctx = await expressContext(item.source, context.userId, true);
      if (["order", "forwarding"].includes(item.source.kind) && !ctx.allowedToShip) {
        for (const unit of ctx.units) expanded.push({ ...item, source: unit.source });
      } else expanded.push(item);
    }
    if (expanded.length > 200) throw Error("一次最多准备200个派送单位，请分批勾选");
    const contexts = await Promise.all(
      expanded.map((i) => expressContext(i.source, context.userId, true)),
    );
    const kept = expanded.filter(
      (item, index) =>
        !expanded.some(
          (other, j) =>
            j !== index &&
            ["carton", "pallet"].includes(other.source.kind) &&
            contexts[j].coverage.includes(`${item.source.kind}:${item.source.id}`) &&
            (other.source.kind !== item.source.kind || j < index),
        ),
    );
    const ids: string[] = [];
    for (const item of kept) {
      const key = `${item.source.kind}:${item.source.id}`;
      const existing = await db
        .from("express_dispatch_drafts")
        .select("id")
        .eq("source_key", key)
        .maybeSingle();
      if (existing.error) throw Error(existing.error.message);
      if (existing.data) {
        ids.push(key);
        continue;
      }
      const ws = await getExpressWorkspace(item.source, context);
      if (!ws.allowedToShip && !ws.records.length)
        throw Error(`${ws.number} 已完成或不能作为派送单位`);
      let destination = item.destination ?? ws.destination;
      if (!destination.address && !item.destination) {
        const ctx = await expressContext(item.source, context.userId, true);
        if (ctx.ownerId) {
          const [a, p] = await Promise.all([
            db
              .from("addresses")
              .select("*")
              .eq("user_id", ctx.ownerId)
              .order("is_default", { ascending: false })
              .limit(1),
            db
              .from("profiles")
              .select(
                "customer_code,full_name,phone,reg_phone,reg_address,reg_city,reg_province,reg_country,reg_postal_code",
              )
              .eq("id", ctx.ownerId)
              .single(),
          ]);
          if (a.error || p.error) throw Error("收件资料读取失败");
          item.customer = p.data.customer_code;
          destination = mapAddress(
            a.data?.[0] ?? {
              recipient: p.data.full_name,
              phone: p.data.phone || p.data.reg_phone,
              line1: p.data.reg_address,
              city: p.data.reg_city,
              province: p.data.reg_province,
              country: p.data.reg_country,
              postal_code: p.data.reg_postal_code,
            },
          );
        }
      }
      const draft = {
        source: item.source,
        leg: "last_mile",
        from: ws.settings.origin,
        to: destination,
        packageType: ws.packageType,
        packages: ws.packages,
        description: ws.number,
        printSize: "thermal",
        signature: false,
        liftgate: false,
        pickupDate: "",
        pickupStart: "09:00",
        pickupEnd: "17:00",
      };
      // Repeated scans must never overwrite manual edits.
      const r = await db.from("express_dispatch_drafts").upsert(
        {
          source_key: key,
          source: item.source,
          number: ws.number,
          customer_code: item.customer ?? "",
          draft,
          updated_by: context.userId,
        },
        { onConflict: "source_key", ignoreDuplicates: true },
      );
      if (r.error) throw Error(r.error.message);
      ids.push(key);
    }
    const result = await db
      .from("express_dispatch_drafts")
      .select("*")
      .in("source_key", [...new Set(ids)]);
    if (result.error) throw Error(result.error.message);
    return { keys: [...new Set(ids)], drafts: result.data ?? [] };
  });
