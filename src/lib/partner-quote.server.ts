import {partnerRouteCodeSchema} from './partner-number';
import {
  settingInput,
  emptyGeneral,
  emptyTransport,
  resolvePartnerRoute,
  type Settings,
} from "./partner-settings";
import {
  partnerRouteSchema,
  quoteInputSchema,
  routeOrigin,
  baseQuote,
  type PartnerRouteDraft,
} from "./partner-quote";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { quotePartnerDelivery } from "./partner-delivery.server";
const db: any = supabaseAdmin;
type Auth = { userId: string; supabase: any };
async function staff(c: Auth) {
  const rows = await Promise.all(
    ["owner", "manager"].map((role) =>
      c.supabase.rpc("has_role", { _user_id: c.userId, _role: role }),
    ),
  );
  if (rows.some((r) => r.error)) throw Error("权限读取失败");
  return rows.some((r) => r.data === true);
}
async function admin(c: Auth) {
  const r = await c.supabase.rpc("has_role", { _user_id: c.userId, _role: "owner" });
  if (r.error) throw Error("权限读取失败");
  if (r.data !== true) throw Error("仅负责人 owner 可管理同行设置");
}
function checked(r: any, message: string) {
  if (r.error) throw Error(message);
  return r.data;
}
async function identity(c: Auth) {
  if (await staff(c)) return { staff: true, code: "" };
  const p = checked(
    await db.from("profiles").select("customer_code").eq("id", c.userId).maybeSingle(),
    "客户资料读取失败",
  );
  return { staff: false, code: p?.customer_code || "" };
}
export function canQuote(d: PartnerRouteDraft, who: { staff: boolean; code: string }) {
  return (
    (d.shared && d.enabled && d.allowQuote) ||
    who.staff ||
    (d.enabled &&
      d.allowQuote &&
      !!who.code &&
      (d.audience === "全部同行客户" || d.customers.split(/[,，\s]+/).includes(who.code)))
  );
}
export async function listRoutes(c: Auth, management = false) {
  if (management) await admin(c);
  const who = await identity(c),
    rows = checked(
      await db.from("partner_quote_routes").select("*").order("code"),
      "同行线路读取失败，请检查数据库迁移",
    );
  if (management) return rows;
  const settings = rows.some((r: any) => r.config.shared) ? await readSettings() : null;
  return rows
    .filter((r: any) => {
      const d = partnerRouteSchema.parse(r.config);
      return d.enabled && d.allowQuote && canQuote(d, who);
    })
    .map((r: any) => {
      const d = r.config.shared ? resolvePartnerRoute(r.config, settings!) : r.config;
      return {
        id: r.id,
        code: r.code,
        name_zh: d.name,
        shipping_method: d.method,
        cargo_type: d.cargo,
        weight_mode: "max",
        volumetric_divisor: d.shared ? Number(d.divisor) : 6000,
        minimum_kg: d.shared ? Number(d.minKg) : 10,
        weight_step: d.shared ? (d.rounding === "none" ? 0 : Number(d.rounding)) : 0.5,
      };
    });
}
export async function saveRoute(c: Auth, input: { id?: string; config: unknown }) {
  await admin(c);
  const stored = partnerRouteSchema.parse(input.config);
  stored.code = partnerRouteCodeSchema.parse(stored.code);
  const d =
    stored.shared && stored.enabled ? resolvePartnerRoute(stored, await readSettings()) : stored;
  if (d.enabled) {
    routeOrigin(d);
    if (d.method !== "sea" && !d.shared) throw Error("空运规则未设置，不能启用");
    if (d.audience === "指定同行客户" && !d.customers.trim()) throw Error("请指定客户号");
    for (const k of [
      "domesticRate",
      d.method === "sea" ? "seaRate" : "airRate",
      "portRate",
    ] as const)
      if (d[k] === undefined || d[k] === "") throw Error("启用前请补齐各项费用单价");
    for (const k of (d.method === "sea"
      ? ["domesticDensity", "seaDensity"]
      : ["domesticDensity"]) as ("domesticDensity" | "seaDensity")[])
      if (!d[k] || Number(d[k]) <= 0) throw Error("启用前请补齐折算重量");
    if (
      [
        d.domesticCurrency,
        d.method === "air" ? d.airCurrency : d.seaCurrency,
        d.portCurrency,
      ].includes("USD") &&
      (!d.fx || Number(d.fx) <= 0)
    )
      throw Error("启用前请补齐 USD/CAD 汇率");
  }
  const data = {
    code: d.code,
    config: stored,
    updated_by: c.userId,
    updated_at: new Date().toISOString(),
  };
  const query = input.id
    ? db.from("partner_quote_routes").update(data).eq("id", input.id)
    : db.from("partner_quote_routes").insert(data);
  const saved = checked(
    await query.select("*").single(),
    "线路保存失败，请检查编号是否重复及数据库迁移",
  );
  return saved;
}
export async function createQuote(c: Auth, raw: unknown) {
  const input = quoteInputSchema.parse(raw),
    who = await identity(c);
  const route = checked(
    await db.from("partner_quote_routes").select("*").eq("id", input.routeId).maybeSingle(),
    "线路读取失败",
  );
  if (!route) throw Error("线路不存在");
  const stored = partnerRouteSchema.parse(route.config);
  const settings = stored.shared ? await readSettings() : null;
  const config = settings ? resolvePartnerRoute(stored, settings) : stored;
  if (!config.enabled || !config.allowQuote || !canQuote(config, who))
    throw Error("线路未启用或您无权查询");
  const hs = checked(
    await db
      .from("hs_codes")
      .select("id,hs_code,mfn_rate,gst_rate,anti_dumping_rate")
      .in("id", [...new Set(input.items.map((i) => i.hsId))])
      .eq("is_active", true),
    "税率读取失败",
  );
  const base = baseQuote(config, input, hs);
  const arrival = settings?.warehouses.find(w => w.id === config.originId);
  const origins = settings ? settings.warehouses.map(w => {
    let transferAmount = 0, billableM3 = 0;
    if (w.id !== arrival?.id) {
      const transfer = arrival?.transfers.find(t => t.target === w.id);
      if (!transfer || transfer.rate === "" || !(Number(arrival?.density) > 0))
        throw Error(`缺少 ${arrival?.label || "到货仓"} → ${w.label} 的转运单价或每立方折算重量，无法比较全部仓库`);
      billableM3 = Math.max(base.volume, base.actual / Number(arrival!.density));
      const fx = arrival!.currency === "USD" ? Number(config.fx) : 1;
      if (!(fx > 0) || !Number.isFinite(fx) || !Number.isFinite(Number(transfer.rate)) || Number(transfer.rate) < 0)
        throw Error("转运单价或汇率无效");
      transferAmount = Math.round(billableM3 * Number(transfer.rate) * fx * 100) / 100;
    }
    const from = routeOrigin({...config, originName:w.name, originPhone:w.phone,
      originStreet:[w.street,w.unit].filter(Boolean).join(", "), originCity:w.city,
      originProvince:w.province, originPostal:w.postal});
    return {id:w.id, label:w.label, from, transferAmount, billableM3};
  }) : [{id:"route", label:config.originCity, from:routeOrigin(config), transferAmount:0, billableM3:0}];
  const rates = [];
  const expiries: number[] = [];
  // Sequential requests avoid a burst against the provider's shared account quota.
  for (const origin of origins) {
    let delivery;
    try {
      delivery = await quotePartnerDelivery({draft:{from:origin.from,to:input.to,packages:base.packages,packageType:"parcel"},rule:{currency:"CAD"}});
    } catch (error) {
      throw Error(`${origin.label} 派送查询失败，尚未完成全部仓库比价：${error instanceof Error ? error.message : "请重试"}`);
    }
    expiries.push(Date.parse(delivery.expiresAt));
    rates.push(...delivery.rates.filter(r => r.currency === "CAD").map(r => ({...r,
      providerKey:r.key, key:`${origin.id}:${r.key}`, dispatchWarehouse:{id:origin.id,label:origin.label,address:origin.from},
      transfer:{from:arrival?.label || config.originCity,to:origin.label,amount:origin.transferAmount,billableM3:origin.billableM3,currency:"CAD"}})));
  }
  if (!rates.length) throw Error("未返回可用 CAD 派送服务，请核对地址、尺寸和重量");
  const subtotal = base.fees.reduce((s, r) => s + Math.round(r.amount * 100), 0);
  const result = {
    ...base,
    rates: rates.map((r) => ({ ...r, total: Math.round(subtotal + r.price * 100 + r.transfer.amount * 100) / 100 })).sort((a,b) => a.total-b.total || a.key.localeCompare(b.key)),
    expiresAt: new Date(Math.min(...expiries)).toISOString(),
    localOversizePending: true,
    currency: "CAD",
    routeName: config.name,
  };
  const saved = checked(
    await db
      .from("partner_quote_snapshots")
      .insert({
        user_id: c.userId,
        route_id: route.id,
        input,
        route_snapshot: { ...route, config, warehouses:settings?.warehouses },
        result,
        expires_at: result.expiresAt,
      })
      .select("id")
      .single(),
    "报价已返回，但快照保存失败，请重新查询",
  );
  return { ...result, id: saved.id };
}

async function readSettings(): Promise<Settings> {
  const rows = checked(
    await db.from("partner_shipping_settings").select("section,value"),
    "公共设置读取失败，请先执行同行设置迁移",
  );
  const values = Object.fromEntries(rows.map((r: any) => [r.section, r.value]));
  return {
    general: { ...emptyGeneral, ...values.general },
    transport: { ...emptyTransport, ...values.transport },
    warehouses: values.warehouses || [],
    amazonWarehouses: values.amazonWarehouses || [],
  };
}
export async function getSettings(c: Auth) {
  await admin(c);
  return readSettings();
}
export async function saveSettings(c: Auth, raw: unknown) {
  await admin(c);
  const data = settingInput.parse(raw);
  checked(
    await db
      .from("partner_shipping_settings")
      .upsert(
        { ...data, updated_at: new Date().toISOString(), updated_by: c.userId },
        { onConflict: "section" },
      ),
    "设置保存失败",
  );
  return data.value;
}

export async function listAmazonWarehouses(){const row=checked(await db.from('partner_shipping_settings').select('value').eq('section','amazonWarehouses').maybeSingle(),'亚马逊仓库地址读取失败，请重试');return (row?.value||[]).filter((w:any)=>w.enabled).map((w:any)=>({code:w.code,company:w.company,street:w.street,city:w.city,province:w.province,postal:w.postal,phone:w.phone}));}
