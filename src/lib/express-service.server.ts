import { z } from "zod";
import {
  addressSchema,
  chooseRate,
  defaultRule,
  draftSchema,
  emptyAddress,
  normalizeRates,
  ruleSchema,
  sourceKey,
  sourceSchema,
  type ExpressDraft,
  type ExpressRate,
  type ExpressSource,
} from "./express";
import {
  accountKey,
  accountUnits,
  providerConfig,
  providerPayload,
  verykRequest,
} from "./verykship.server";
import { dbOne, expressContext, expressDb as db } from "./express-context.server";

export type ExpressAuth = { userId: string; supabase: any };
async function isStaff(c: ExpressAuth) {
  const { data, error } = await c.supabase.rpc("is_staff", { _user_id: c.userId });
  if (error) throw new Error("无法验证员工权限");
  return data === true;
}
async function staffOnly(c: ExpressAuth) {
  if (!(await isStaff(c))) throw new Error("仅员工可购买或管理快递面单");
}
async function settings() {
  const { data, error } = await db
    .from("express_settings")
    .select("origin,rule")
    .eq("id", true)
    .single();
  if (error) throw new Error("快递模块数据库尚未就绪，请先应用 express_shipping 迁移");
  return {
    origin: data.origin ?? emptyAddress,
    rule: ruleSchema.parse({ ...defaultRule, ...data.rule }),
  };
}
const summaryColumns =
  "id,source,leg,rate,reference,provider_id,status,tracking_numbers,provider_state,actual_price,last_error,created_at,updated_at,account_key,owner_id,user_id";
export async function getExpressWorkspace(input: unknown, c: ExpressAuth) {
  const source = sourceSchema.parse(input),
    staff = await isStaff(c);
  const ctx = await expressContext(source, c.userId, staff);
  const config = providerConfig();
  const cfg = await settings();
  let q = db
    .from("express_shipments")
    .select(summaryColumns)
    .contains("links", [sourceKey(source)])
    .eq("account_key", accountKey())
    .order("created_at", { ascending: false })
    .limit(100);
  if (!staff) q = q.eq("owner_id", c.userId);
  const { data: records, error } = await q;
  if (error) throw new Error(error.message);
  return {
    number: ctx.number,
    source,
    units: ctx.units,
    allowedToShip: ctx.allowedToShip,
    staff,
    destination: ctx.destination,
    packages: ctx.packages,
    packageType: ctx.packageType,
    settings: cfg,
    connection: {
      configured: config.configured,
      environment: config.environment,
      purchasing: config.purchasing && staff,
    },
    records: records ?? [],
  };
}
export async function saveExpressSettings(input: unknown, c: ExpressAuth) {
  await staffOnly(c);
  const value = z.object({ origin: addressSchema, rule: ruleSchema }).parse(input);
  const { error } = await db
    .from("express_settings")
    .update({ ...value, updated_by: c.userId, updated_at: new Date().toISOString() })
    .eq("id", true);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function quoteFor(
  draft: ExpressDraft,
  rate?: ExpressRate,
  units?: Awaited<ReturnType<typeof accountUnits>>,
) {
  const payload = providerPayload(draft, units ?? (await accountUnits()), rate);
  return normalizeRates(
    await verykRequest("shipment/quote", {
      ...payload,
      ...(rate ? { carrier_ids: [rate.carrierId] } : {}),
    }),
  );
}
export async function quoteExpress(input: unknown, c: ExpressAuth) {
  const { draft, rule } = z.object({ draft: draftSchema, rule: ruleSchema }).parse(input);
  const ctx = await expressContext(draft.source, c.userId, await isStaff(c));
  if (!ctx.allowedToShip)
    throw new Error("请选择实际发货的运单、箱号或托盘；已完成或取消的货物不可出单");
  if (draft.packageType !== ctx.packageType)
    throw new Error("包装类型与发货单位不符，请从相应箱号或托盘进入");
  const units = await accountUnits();
  let rates = await quoteFor(draft, undefined, units);
  // Different carriers use different signature/tailgate fields. Requote each candidate
  // with its mapped options so automatic selection includes those charges.
  if (
    draft.signature ||
    draft.liftgate ||
    draft.packageType === "pallet" ||
    rates.some((r) => r.carrier.toLowerCase() === "purolator")
  ) {
    const enriched: ExpressRate[] = [];
    const rejected: string[] = [];
    if (rates.length > 40) throw new Error("可用服务过多，请先缩小货运范围");
    for (const rate of rates) {
      try {
        const refreshed = (await quoteFor(draft, rate, units)).find((r) => r.key === rate.key);
        if (refreshed) enriched.push(refreshed);
      } catch {
        rejected.push(rate.service);
      }
    }
    rates = enriched;
    if (!rates.length && rejected.length)
      throw new Error("当前附加服务或托盘取货资料没有获得有效报价，请检查日期、时间和服务要求");
  }
  const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
  const { data, error } = await db
    .from("express_quotes")
    .insert({
      user_id: c.userId,
      account_key: accountKey(),
      source: draft.source,
      draft,
      rule,
      rates,
      coverage: ctx.coverage,
      links: ctx.links,
      owner_id: ctx.ownerId,
      context_hash: ctx.contextHash,
      expires_at: expiresAt,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, rates, recommendation: chooseRate(rates, rule), expiresAt };
}
async function record(id: string, c: ExpressAuth) {
  const r = await dbOne("express_shipments", id);
  if (!(await isStaff(c)) && r.owner_id !== c.userId) throw new Error("无权读取该面单");
  if (r.account_key !== accountKey()) throw new Error("该面单属于其他环境或账号，请切换到对应配置");
  return r;
}
async function updateRecord(id: string, patch: Record<string, unknown>) {
  const { error } = await db
    .from("express_shipments")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error("快递记录保存失败，请核对平台订单，勿重复下单");
}
function detailPatch(detail: any) {
  const ids = [
    detail.waybill_number,
    ...(detail.package?.packages ?? []).map((p: any) => p.waybill_number),
  ]
    .filter(Boolean)
    .map(String);
  return {
    provider_id: String(detail.id),
    tracking_numbers: [...new Set(ids)],
    provider_state: String(detail.state?.code ?? "unknown"),
    actual_price: detail.price?.charges ?? null,
    status: ["void", "voided", "cancelled"].includes(detail.state?.code) ? "voided" : "created",
    last_error: null,
  };
}
export async function buyExpress(input: unknown, c: ExpressAuth) {
  await staffOnly(c);
  const data = z
    .object({
      quoteId: z.string().uuid(),
      rateKey: z.string().max(100),
      confirmed: z.literal(true),
    })
    .parse(input);
  if (!providerConfig().purchasing)
    throw new Error("面单购买尚未启用，请由管理员完成测试和服务端配置");
  const q = await dbOne("express_quotes", data.quoteId);
  if (
    q.user_id !== c.userId ||
    q.account_key !== accountKey() ||
    Date.parse(q.expires_at) <= Date.now()
  )
    throw new Error("报价已过期或不属于当前账号，请重新询价");
  const draft = draftSchema.parse(q.draft),
    rate: ExpressRate | undefined = q.rates.find((r: ExpressRate) => r.key === data.rateKey);
  if (!rate) throw new Error("无效服务");
  const ctx = await expressContext(draft.source, c.userId, true);
  if (
    !ctx.allowedToShip ||
    ctx.contextHash !== q.context_hash ||
    JSON.stringify(ctx.coverage) !== JSON.stringify(q.coverage)
  )
    throw new Error("货物、地址或装箱结构已变化，请重新询价");
  const units = await accountUnits();
  const current = (await quoteFor(draft, rate, units)).find((r) => r.key === rate.key);
  if (
    !current ||
    current.currency !== rate.currency ||
    Math.round(current.price * 100) !== Math.round(rate.price * 100) ||
    current.eta !== rate.eta
  )
    throw new Error("服务价格或时效已变化，请重新询价并确认");
  const payload = providerPayload(draft, units, rate);
  const { data: shipmentId, error } = await db.rpc("reserve_express_shipment", {
    p_quote: q.id,
    p_user: c.userId,
    p_rate: rate.key,
  });
  if (error) throw new Error(error.message);
  const s = await dbOne("express_shipments", shipmentId);
  // Never retry this request: a timeout may occur after the carrier charged the account.
  try {
    const response = await verykRequest("shipment/create", {
      ...payload,
      payment_method: "account",
      state: "order",
      option: { ...payload.option, reference_number: s.reference },
    });
    if (!response.id) throw new Error("平台未返回订单号");
    await updateRecord(s.id, detailPatch(response));
  } catch (e) {
    const message = e instanceof Error ? e.message : "提交结果待核对";
    await updateRecord(s.id, { status: "unknown", last_error: message });
  }
  return { id: s.id as string };
}
export async function refreshExpress(input: unknown, c: ExpressAuth) {
  const { id, providerId } = z
    .object({ id: z.string().uuid(), providerId: z.string().trim().max(100).optional() })
    .parse(input);
  const s = await record(id, c);
  if (providerId) await staffOnly(c);
  const remoteId = s.provider_id || providerId;
  if (!remoteId)
    throw new Error(
      `请先在 VerykShip 用参考号 ${s.reference} 核对订单，再填写平台订单号关联；不要重新下单`,
    );
  const detail = await verykRequest("shipment/detail", { id: remoteId });
  if (
    String(detail.id) !== String(remoteId) ||
    detail.reference_number !== s.reference ||
    String(detail.service?.id) !== String(s.rate.serviceId)
  )
    throw new Error("平台订单的参考号或服务不匹配，未关联");
  await updateRecord(id, detailPatch(detail));
  if (["void", "voided", "cancelled"].includes(detail.state?.code)) {
    const { error } = await db.rpc("release_voided_express_shipment", { p_id: id });
    if (error) throw new Error(error.message);
  }
  return { ok: true };
}
export async function voidExpress(input: unknown, c: ExpressAuth) {
  await staffOnly(c);
  const { id, reason } = z
    .object({
      id: z.string().uuid(),
      reason: z.string().trim().min(1).max(200),
      confirmed: z.literal(true),
    })
    .parse(input);
  const s = await record(id, c);
  if (!s.provider_id || s.status !== "created") throw new Error("仅已创建且已核对的订单可以取消");
  await verykRequest("shipment/void", { id: s.provider_id, reason });
  // Success alone is not evidence of refund or final cancellation: verify remote state.
  await refreshExpress({ id }, c);
  return { ok: true };
}
export async function labelExpress(input: unknown, c: ExpressAuth) {
  const { id } = z.object({ id: z.string().uuid() }).parse(input);
  const s = await record(id, c);
  if (s.status !== "created" || !s.provider_id)
    throw new Error("该记录尚无可打印面单，请先核对订单状态");
  // Verify on every access to avoid serving cached labels cancelled outside remix.
  const detail = await verykRequest("shipment/detail", { id: s.provider_id });
  if (["void", "voided", "cancelled"].includes(detail.state?.code)) {
    await updateRecord(id, detailPatch(detail));
    const { error } = await db.rpc("release_voided_express_shipment", { p_id: id });
    if (error) throw new Error(error.message);
    throw new Error("平台订单已取消，不可打印");
  }
  const { data: cached, error } = await db
    .from("express_labels")
    .select("mime_type,file_name,base64")
    .eq("shipment_id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (cached) return cached as { mime_type: string; file_name: string; base64: string };
  const file = await verykRequest("shipment/label", { id: s.provider_id, option: 1 });
  const mime = String(file.type),
    base64 = String(file.label ?? "");
  if (
    mime !== "application/pdf" ||
    !/^[A-Za-z0-9+/=\r\n]+$/.test(base64) ||
    base64.length > 28000000 ||
    Buffer.from(base64, "base64").subarray(0, 5).toString() !== "%PDF-"
  )
    throw new Error("平台尚未提供有效 PDF 面单，请稍后重试");
  const label = { mime_type: mime, file_name: `express-${s.reference}.pdf`, base64 };
  const result = await db.from("express_labels").upsert({ shipment_id: id, ...label });
  if (result.error) throw new Error(result.error.message);
  return label;
}
export async function expressOverview(c: ExpressAuth) {
  await staffOnly(c);
  const { data, error } = await db
    .from("express_shipments")
    .select(summaryColumns)
    .eq("account_key", accountKey())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("快递模块数据库尚未就绪，请先应用迁移");
  const config = providerConfig();
  return {
    records: data ?? [],
    settings: await settings(),
    connection: {
      configured: config.configured,
      environment: config.environment,
      purchasing: config.purchasing,
    },
  };
}
