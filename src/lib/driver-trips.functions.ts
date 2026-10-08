import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireDriver } from "./driver.functions";
import { loadDeliveryGroups } from "./delivery-queue.functions";
import { computeDeliveryRoute } from "./delivery-route.functions";
const tripInput = z.object({ tripId: z.string().uuid() });
export const saveDriverTripNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    tripInput.extend({
      batchId: z.string().uuid(),
      customerCode: z.string().regex(/^\d{5}$/),
      note: z.string().trim().max(2000),
    }),
  )
  .handler(async ({ data, context }) => {
    const admin = await db(context);
    await owned(admin, context.userId, data.tripId);
    const rows = await units(admin, data.tripId);
    if (
      !rows.some(
        (x) =>
          x.unit.source_batch_id === data.batchId && x.unit.customer_code === data.customerCode,
      )
    )
      throw new Error("客户批次不属于当前趟次");
    const r = await admin
      .from("batch_customer_notes")
      .upsert(
        {
          batch_id: data.batchId,
          customer_code: data.customerCode,
          note: data.note,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "batch_id,customer_code" },
      );
    if (r.error) throw new Error("备注保存失败");
    const { recordAdminLog } = await import("@/lib/admin-log");
    await recordAdminLog(admin, {
      entity_type: "batch",
      entity_id: data.batchId,
      action: "修改派送结算备注",
      operator_id: context.userId,
      note: `客户 ${data.customerCode}`,
      after: { note: data.note },
    });
    return { ok: true };
  });
async function db(context: any) {
  await requireDriver(context);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
async function owned(admin: any, actor: string, id: string) {
  const r = await admin
    .from("driver_trips")
    .select("*")
    .eq("id", id)
    .eq("driver_id", actor)
    .single();
  if (r.error || !r.data) throw new Error("清单不存在或不属于当前司机");
  return r.data;
}
async function units(admin: any, tripId: string) {
  const all: any[] = [];
  for (let offset = 0; ; offset += 500) {
    const r = await admin
      .from("driver_trip_items")
      .select("*,unit:delivery_queue(*,batch:batches!source_batch_id(batch_no,display_name))")
      .eq("trip_id", tripId)
      .order("sequence")
      .range(offset, offset + 499);
    if (r.error) throw new Error("上车清单读取失败：" + r.error.message);
    all.push(...r.data);
    if (r.data.length < 500) break;
  }
  return all;
}
export const listDriverTrips = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await db(context);
    const trips: any[] = [];
    for (let offset = 0; ; offset += 200) {
      const r = await admin
        .from("driver_trips")
        .select("*")
        .eq("driver_id", context.userId)
        .order("created_at")
        .order("id")
        .range(offset, offset + 199);
      if (r.error) throw new Error("趟次读取失败，请确认已执行司机趟次迁移");
      trips.push(...r.data);
      if (r.data.length < 200) break;
    }
    return Promise.all(
      trips.map(async (t) => {
        const rows = await units(admin, t.id);
        return {
          ...t,
          total: rows.length,
          completed: rows.filter((x) => x.unit?.status === "dispatched").length,
        };
      }),
    );
  });
export const createDriverTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const admin = await db(context);
    const p = await admin.from("profiles").select("full_name").eq("id", context.userId).single();
    if (p.error) throw new Error("司机资料读取失败");
    const r = await admin
      .from("driver_trips")
      .upsert(
        { id: data.id, driver_id: context.userId, driver_name: p.data.full_name || "司机" },
        { onConflict: "id", ignoreDuplicates: true },
      );
    if (r.error) throw new Error("新建趟次失败");
    return owned(admin, context.userId, data.id);
  });
export const getDriverTrip = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(tripInput)
  .handler(async ({ data, context }) => {
    const admin = await db(context);
    const trip = await owned(admin, context.userId, data.tripId);
    return { ...trip, items: await units(admin, trip.id) };
  });
export const scanDriverTrip = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(tripInput.extend({ code: z.string().trim().min(1).max(200) }))
  .handler(async ({ data, context }) => {
    const admin = await db(context);
    const r = await admin.rpc("driver_load_unit", {
      _actor: context.userId,
      _trip: data.tripId,
      _code: data.code,
    });
    if (r.error) throw new Error(r.error.message);
    return r.data as { sequence: number; duplicate: boolean };
  });
export const dispatchDriverUnits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(tripInput.extend({ ids: z.array(z.string().uuid()).min(1).max(1000) }))
  .handler(async ({ data, context }) => {
    const admin = await db(context);
    const r = await admin.rpc("driver_dispatch_units", {
      _actor: context.userId,
      _trip: data.tripId,
      _ids: data.ids,
    });
    if (r.error) throw new Error(r.error.message);
    return { ok: true };
  });
export const generateDriverRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(tripInput.extend({ originId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const admin = await db(context);
    const trip = await owned(admin, context.userId, data.tripId);
    const rows = await units(admin, trip.id);
    if (!rows.length) throw new Error("请先扫码上车");
    const origin = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "driver-origin:" + data.originId)
      .single();
    if (origin.error || !origin.data?.value?.active) throw new Error("请选择已启用的司机起始点");
    const groups: any[] = [];
    for (const code of new Set<string>(rows.map((x) => x.unit.customer_code))) {
      for (const status of ["pending", "dispatched"]) {
        const result = await loadDeliveryGroups(status, code);
        for (const g of result.groups)
          if (rows.some((x) => g.ids.includes(x.queue_id)) && !groups.some((x) => x.key === g.key))
            groups.push(g);
      }
    }
    const stops: any[] = [];
    for (const row of rows) {
      const g = groups.find(
        (g) =>
          g.ids.includes(row.queue_id) ||
          (g.batch_id === row.unit.source_batch_id && g.customer_code === row.unit.customer_code),
      );
      if (!g?.address?.trim()) throw new Error(`客户 ${row.unit.customer_code} 缺少地址，请先补全`);
      let stop = stops.find((s) => s.address.toLowerCase() === g.address.trim().toLowerCase());
      if (!stop) {
        stop = { address: g.address.trim(), customers: [] };
        stops.push(stop);
      }
      let customer = stop.customers.find((c: any) => c.customer_code === g.customer_code);
      if (!customer) {
        customer = {
          customer_code: g.customer_code,
          name: g.full_name,
          phone: g.phone,
          address: g.address,
          wallet: g.wallet_balance_cad,
          groups: [],
          ids: [],
        };
        stop.customers.push(customer);
      }
      customer.ids.push(row.queue_id);
      if (!customer.groups.some((x: any) => x.key === g.key)) customer.groups.push(g);
    }
    const plans: any[] = [];
    const maps: (string | null)[] = [];
    let departure = origin.data.value.address;
    for (let i = 0; i < stops.length; i += 21) {
      const chunk = stops.slice(i, i + 21);
      const result = await computeDeliveryRoute(
        {
          origin: departure,
          addresses: chunk.map((s) => s.address),
          roundTrip: false,
          optimize: true,
          keepFirst: i > 0,
        },
        context,
      );
      if (!result.map) throw new Error(result.warning || "地图未生成，请重试");
      const ordered = result.order.map((index) => chunk[index]);
      plans.push({ origin: departure, stops: ordered });
      maps.push(result.map);
      departure = ordered.at(-1).address;
    }
    // Persist our delivery manifest and chosen stop order, not Google map image data.
    const route = { origin: origin.data.value.address, plans };
    const saved = await admin
      .from("driver_trips")
      .update({ route, route_revision: trip.revision, generated_at: new Date().toISOString() })
      .eq("id", trip.id)
      .eq("driver_id", context.userId)
      .eq("revision", trip.revision)
      .select("id");
    if (saved.error || !saved.data?.length) throw new Error("上车清单已变化，请重新生成线路");
    return { route, maps };
  });
export const loadDriverRouteMaps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(tripInput)
  .handler(async ({ data, context }) => {
    const admin = await db(context);
    const t = await owned(admin, context.userId, data.tripId);
    if (!t.route || t.route_revision !== t.revision)
      throw new Error("上车清单已变化，请重新生成线路");
    const maps = [];
    for (const plan of t.route.plans) {
      const r = await computeDeliveryRoute(
        {
          origin: plan.origin,
          addresses: plan.stops.map((s: any) => s.address),
          roundTrip: false,
          optimize: false,
        },
        context,
      );
      if (!r.map) throw new Error(r.warning);
      maps.push(r.map);
    }
    return maps;
  });
