import { createHmac, createHash } from "node:crypto";
import { convertedPackages, type ExpressDraft, type ExpressRate } from "./express";

export function providerConfig() {
  const environment = process.env.VERYKSHIP_ENV === "production" ? "production" : "sandbox";
  const id =
    process.env[environment === "production" ? "VERYKSHIP_APP_ID" : "VERYKSHIP_SANDBOX_APP_ID"] ??
    "";
  const secret =
    process.env[
      environment === "production" ? "VERYKSHIP_APP_SECRET" : "VERYKSHIP_SANDBOX_APP_SECRET"
    ] ?? "";
  return {
    environment,
    id,
    secret,
    configured: !!id && !!secret,
    purchasing: process.env.VERYKSHIP_PURCHASE_ENABLED === "true",
    url:
      environment === "production"
        ? "https://www.verykship.com/api"
        : "https://3hlrnj-shipper.veryk.dev/api",
  };
}
const encode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
export function signParameters(parameters: Record<string, string>, secret: string) {
  const lower = Object.fromEntries(
    Object.entries(parameters).map(([k, v]) => [k.toLowerCase(), v]),
  );
  delete lower.sign;
  return createHmac("sha256", secret)
    .update(
      Object.keys(lower)
        .sort()
        .map((k) => `${k}=${encode(lower[k])}`)
        .join("&"),
    )
    .digest("base64");
}
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function accountKey() {
  const c = providerConfig();
  return `${c.environment}:${c.id}`;
}
type ProviderAction = 'account'|'shipment/quote'|'shipment/create'|'shipment/label'|'shipment/detail'|'shipment/void';
const readRequests = new Map<string, Promise<any>>();
const accountResponses = new Map<string, {value:any;until:number}>();
let quoteCooldown = {key:'',until:0};
export async function verykRequest(action:ProviderAction,payload:unknown={}) {
 const readonly=action==='account'||action==='shipment/quote';
 if(!readonly)return sendVerykRequest(action,payload);
 const c=providerConfig(), account=fingerprint([c.environment,c.id,c.secret]);
 const cached=accountResponses.get(account);
 if(action==='account'&&cached&&cached.until>Date.now())return cached.value;
 if(quoteCooldown.key===account&&quoteCooldown.until>Date.now())throw Error('快递平台请求过于频繁（HTTP 429），请等待 '+Math.ceil((quoteCooldown.until-Date.now())/1000)+' 秒后再查询；未创建面单或扣款');
 const key=fingerprint([account,action,payload]);
 const existing=readRequests.get(key);if(existing)return existing;
 // Bound memory without sharing or caching quotes across different addresses/packages.
 if(readRequests.size>=100)throw Error('快递查询繁忙，请稍后再试');
 const pending=sendVerykRequest(action,payload).then(value=>{
   if(action==='account'){
     for(const [k,v] of accountResponses)if(v.until<=Date.now())accountResponses.delete(k);
     if(accountResponses.size>=20)accountResponses.delete(accountResponses.keys().next().value!);
     accountResponses.set(account,{value,until:Date.now()+300000});
   }
   return value;
 }).finally(()=>readRequests.delete(key));
 readRequests.set(key,pending);return pending;
}
async function sendVerykRequest(
  action:
    | "account"
    | "shipment/quote"
    | "shipment/create"
    | "shipment/label"
    | "shipment/detail"
    | "shipment/void",
  payload: unknown = {},
) {
  const c = providerConfig();
  if (!c.configured) throw new Error("尚未配置 VerykShip 服务端凭据，请联系管理员");
  const params: Record<string, string> = {
    id: c.id,
    timestamp: String(Math.floor(Date.now() / 1000)),
    format: "json",
    action,
  };
  params.sign = signParameters(params, c.secret);
  let json: any;
  let responseStatus: number | undefined;
  let receivedResponse = false;
  let retrySeconds = 60;
  try {
    const res = await fetch(`${c.url}?${new URLSearchParams(params)}`, {
      method: "POST",
      // Cloudflare Workers rejects redirect: "error"; "manual" returns the 3xx
      // response, which !res.ok below still treats as a failure.
      redirect: "manual",
      headers: { "Content-Type": "application/json", "Accept-Language": "zh-CN" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(45000),
    });
    responseStatus = res.status;
    receivedResponse = true;
    if(res.status===429&&(action==='account'||action==='shipment/quote')){
      const retry=res.headers?.get('Retry-After');
      if(retry){const n=Number(retry),seconds=Number.isFinite(n)?n:(Date.parse(retry)-Date.now())/1000;if(Number.isFinite(seconds)&&seconds>0)retrySeconds=Math.ceil(seconds);}
      quoteCooldown={key:fingerprint([c.environment,c.id,c.secret]),until:Date.now()+retrySeconds*1000};
    }
    if (!res.ok) throw new Error("HTTP failure");
    json = await res.json();
  } catch (error) {
    // Only expose bounded diagnostics, never a signed URL, response body or raw exception.
    if(responseStatus===429&&(action==='account'||action==='shipment/quote'))throw Error('快递平台请求过于频繁（HTTP 429，'+(action==='account'?'账号信息查询':'派送报价查询')+'），请等待 '+retrySeconds+' 秒后再查询；未创建面单或扣款');
    const name = (error as { name?: string })?.name;
    const reason = receivedResponse
      ? (responseStatus && responseStatus >= 200 && responseStatus < 300
          ? "响应不是有效 JSON"
          : `HTTP ${responseStatus}`)
      : name === "TimeoutError" || name === "AbortError"
        ? "请求超时"
        : "网络连接失败";
    const caution = action === "shipment/create" || action === "shipment/void"
      ? "；操作结果不确定，请核对平台订单，勿重复提交"
      : "；未创建面单或扣款";
    throw new Error(`VerykShip ${reason}${caution}`);
  }
  if (![true, 1, "1"].includes(json?.status)) {
    // Never forward the query, signed URL, headers or unfiltered provider response.
    const message = String(json?.message ?? "平台未接受请求")
      .replace(/https?:\/\/\S+/g, "[链接已隐藏]")
      .replaceAll(c.secret, "[密钥已隐藏]")
      .slice(0, 350);
    throw new Error(`VerykShip：${message}`);
  }
  if (action === "shipment/void" && json.response === "success") return { success: true };
  if (!json.response || typeof json.response !== "object")
    throw new Error("VerykShip 返回内容不完整");
  return json.response;
}
export async function accountUnits() {
  const a = await verykRequest("account");
  // The account endpoint returns units as unit.weight.code / unit.length.code;
  // the flat weightUnit/lengthunit fields are kept only as a fallback.
  const weight = String(a.unit?.weight?.code ?? a.weightUnit).toLowerCase(),
    length = String(a.unit?.length?.code ?? a.lengthunit).toLowerCase();
  if (!["kg", "lb"].includes(weight) || !["cm", "in"].includes(length))
    throw new Error("账号计量单位无法识别，已停止请求以免错误计费");
  return { weight: weight as "kg" | "lb", length: length as "cm" | "in" };
}
export function providerPayload(
  d: Omit<ExpressDraft, "source" | "leg">,
  units: Awaited<ReturnType<typeof accountUnits>>,
  rate?: ExpressRate,
) {
  if (d.from.region_id !== d.to.region_id)
    throw new Error("当前出单支持同一国家境内运输；跨境需先接入商品申报资料");
  const packages: any[] = convertedPackages(d, units);
  const additional: any = {};
  const pkgAdditional: any = {};
  const carrier = (rate?.carrier ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (d.packageType === "pallet") {
    if (!d.description) throw new Error("托盘发货请填写货物描述");
    pkgAdditional.info = { description: d.description };
    pkgAdditional.pallet = { state: true, description: d.description };
    packages.forEach((p) => {
      p.additional = pkgAdditional;
    });
    if (/day.*ross/.test(carrier)) {
      if (!d.pickupDate || d.pickupStart >= d.pickupEnd)
        throw new Error("该托盘服务需要有效的取货日期及时间范围");
      additional.pickup = {
        state: true,
        date: d.pickupDate,
        starttime: d.pickupStart,
        endtime: d.pickupEnd,
      };
    }
    if (d.liftgate && rate) {
      if (rate && !/fedex|day.*ross/.test(carrier))
        throw new Error("该承运商的尾板参数尚未配置，请选择已支持的托盘服务");
      additional.accessorialServices = {
        state: true,
        accessorialServices: /day.*ross/.test(carrier) ? ["TLGDL"] : ["LIFTGATE_DELIVERY"],
      };
    }
  }
  if (d.signature && rate) {
    if (carrier === "ups")
      packages.forEach((p) => {
        p.additional = { ...p.additional, DC: { state: true, type: 2 } };
      });
    else if (carrier === "canadapost") additional.SO = { state: true, "signature-type": "SO" };
    else if (carrier.includes("fedex")) additional.signature = { state: true, type: "DIRECT" };
    else if (carrier === "purolator") additional.signature = { state: true, type: "FreeSignature" };
    else throw new Error("该服务暂不支持签名参数映射，请选择其他服务");
  } else if (carrier === "purolator")
    additional.signature = { state: true, type: "OriginSignatureNotRequired" };
  const formats: Record<string, [string, string]> = {
    ups: ["6X4_thermal_PDF", "A4_PDF"],
    canadapost: ["4x6", "8.5x11"],
    fedex: ["STOCK_4X6", "PAPER_LETTER"],
    purolator: ["Thermal", "Regular"],
    dhl: ["6X4_thermal", "8X4_A4_PDF"],
  };
  const label =
    d.printSize === "default" ? undefined : formats[carrier]?.[d.printSize === "thermal" ? 0 : 1];
  return {
    initiation: d.from,
    destination: d.to,
    package: { type: d.packageType, packages, additional: pkgAdditional },
    sadditional: additional,
    option: { ...(label ? { label_format: label } : {}) },
    ...(rate ? { service_id: rate.serviceId } : {}),
  };
}
