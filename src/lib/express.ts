import { z } from "zod";

export const sourceSchema = z.object({
  kind: z.enum(["order", "forwarding", "waybill", "carton", "pallet", "batch"]),
  id: z.string().uuid(),
});
export type ExpressSource = z.infer<typeof sourceSchema>;
const text = z.string().trim().max(200);
export const addressSchema = z.object({
  name: text.min(1, "请填写姓名"),
  company: text.default(""),
  mobile_phone: text.min(1, "请填写电话"),
  region_id: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "国家必须为两位代码"),
  province: text.min(1, "请填写省份"),
  city: text.min(1, "请填写城市"),
  postalcode: text.min(1, "请填写邮编"),
  address: text.min(1, "请填写地址"),
  address2: text.default(""),
  email: z.union([z.literal(""), z.string().email()]).default(""),
  type: z.enum(["resident", "commercial"]).default("resident"),
});
export type ExpressAddress = z.infer<typeof addressSchema>;
export const emptyAddress: ExpressAddress = {
  name: "",
  company: "",
  mobile_phone: "",
  region_id: "CA",
  province: "",
  city: "",
  postalcode: "",
  address: "",
  address2: "",
  email: "",
  type: "resident",
};
export const packageSchema = z.object({
  weightKg: z.number().finite().positive().max(100000),
  lengthCm: z.number().finite().positive().max(10000),
  widthCm: z.number().finite().positive().max(10000),
  heightCm: z.number().finite().positive().max(10000),
});
export const draftSchema = z.object({
  source: sourceSchema,
  leg: z.enum(["last_mile", "first_mile", "transfer"]),
  from: addressSchema,
  to: addressSchema,
  packageType: z.enum(["parcel", "pallet"]),
  packages: z.array(packageSchema).min(1).max(100),
  description: text.default(""),
  printSize: z.enum(["thermal", "letter", "default"]).default("thermal"),
  // Typed auxiliary options: never accept an arbitrary provider payload from a browser.
  signature: z.boolean().default(false),
  liftgate: z.boolean().default(false),
  pickupDate: z
    .string()
    .regex(/^$|^\d{4}-\d{2}-\d{2}$/)
    .default(""),
  pickupStart: z
    .string()
    .regex(/^([01]\d|20):[03]0$/)
    .default("09:00"),
  pickupEnd: z
    .string()
    .regex(/^([01]\d|20):[03]0$/)
    .default("17:00"),
});
export type ExpressDraft = z.infer<typeof draftSchema>;
export const ruleSchema = z.object({
  strategy: z.enum(["cheapest", "earliest"]).default("cheapest"),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("CAD"),
  carrierIds: z.array(z.string().min(1).max(40)).max(50).default([]),
  serviceIds: z.array(z.string().min(1).max(40)).max(100).default([]),
  maxPrice: z.number().finite().nonnegative().nullable().default(null),
  latestDelivery: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
});
export type ExpressRule = z.infer<typeof ruleSchema>;
export const defaultRule: ExpressRule = {
  strategy: "cheapest",
  currency: "CAD",
  carrierIds: [],
  serviceIds: [],
  maxPrice: null,
  latestDelivery: null,
};
export type ExpressRate = {
  key: string;
  carrierId: string;
  carrier: string;
  serviceId: string;
  service: string;
  currency: string;
  price: number;
  tax: number | null;
  eta: string;
  deliveryDate: string | null;
  message: string;
};
export const sourceKey = (s: ExpressSource) => `${s.kind}:${s.id}`;
export const sourceNames: Record<ExpressSource["kind"], string> = {
  order: "订单",
  forwarding: "集运单",
  waybill: "运单",
  carton: "箱号",
  pallet: "托盘",
  batch: "批次",
};
export const statusNames: Record<string, string> = {
  submitting: "正在提交／待核对",
  unknown: "结果待核对，请勿重复下单",
  created: "已创建",
  voided: "已取消",
};

function amount(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean")
    return null;
  if (typeof value === "object") return amount((value as { value?: unknown }).value);
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
export function normalizeRates(response: unknown): ExpressRate[] {
  if (!Array.isArray(response)) throw new Error("平台报价格式异常");
  return response.flatMap((carrier: any) =>
    (Array.isArray(carrier.services) ? carrier.services : []).flatMap((s: any) => {
      const price = amount(s.charge);
      const currency = String(s.currency?.code ?? carrier.currency?.code ?? "").toUpperCase();
      if (price === null || !s.id || !carrier.carrier_id || !/^[A-Z]{3}$/.test(currency)) return [];
      const eta = String(s.eta ?? "");
      // Do not invent transit times from service names or parse "not guaranteed" as a date.
      const deliveryDate =
        /^\d{4}-\d{2}-\d{2}$/.test(eta) && Number.isFinite(Date.parse(eta)) ? eta : null;
      return [
        {
          key: `${carrier.carrier_id}:${s.id}`,
          carrierId: String(carrier.carrier_id),
          carrier: String(carrier.name ?? ""),
          serviceId: String(s.id),
          service: String(s.name ?? ""),
          currency,
          price,
          tax: amount(s.tax),
          eta,
          deliveryDate,
          message: String(s.message ?? ""),
        },
      ];
    }),
  );
}
export function chooseRate(
  rates: ExpressRate[],
  rule: ExpressRule,
): { rate: ExpressRate | null; reason: string } {
  const eligible = rates.filter(
    (r) =>
      r.currency === rule.currency &&
      (!rule.carrierIds.length || rule.carrierIds.includes(r.carrierId)) &&
      (!rule.serviceIds.length || rule.serviceIds.includes(r.serviceId)) &&
      (rule.maxPrice === null || r.price <= rule.maxPrice) &&
      (!rule.latestDelivery || (!!r.deliveryDate && r.deliveryDate <= rule.latestDelivery)) &&
      (rule.strategy !== "earliest" || !!r.deliveryDate),
  );
  eligible.sort(
    (a, b) =>
      (rule.strategy === "earliest" ? a.deliveryDate!.localeCompare(b.deliveryDate!) : 0) ||
      a.price - b.price ||
      a.key.localeCompare(b.key),
  );
  return {
    rate: eligible[0] ?? null,
    reason: eligible.length
      ? `符合条件的 ${eligible.length} 个服务中${rule.strategy === "earliest" ? "预计最早送达，同日取最低价" : "报价最低"}`
      : "没有符合条件的服务；未知送达日期不会满足时效条件，请调整规则或手动选择。",
  };
}
export function mapAddress(a: any): ExpressAddress {
  if (!a) return { ...emptyAddress };
  const country = String(a.region_id ?? a.country ?? "CA");
  return {
    ...emptyAddress,
    name: String(a.name ?? a.recipient ?? ""),
    company: String(a.company ?? ""),
    mobile_phone: String(a.mobile_phone ?? a.phone ?? ""),
    region_id:
      ({ Canada: "CA", China: "CN", 加拿大: "CA", 中国: "CN" } as Record<string, string>)[
        country
      ] ?? country.toUpperCase(),
    province: String(a.province?.code ?? a.province ?? ""),
    city: String(a.city ?? ""),
    postalcode: String(a.postalcode ?? a.postal_code ?? ""),
    address: String(a.address ?? a.line1 ?? a.address1 ?? ""),
    address2: String(a.address2 ?? a.line2 ?? ""),
    email: String(a.email ?? ""),
    type: a.type === "commercial" ? "commercial" : "resident",
  };
}
export function convertedPackages(
  d: Pick<ExpressDraft, "packages">,
  units: { weight: "kg" | "lb"; length: "cm" | "in" },
) {
  const round = (n: number) => Math.ceil(n * 1000 - 1e-9) / 1000;
  return d.packages.map((p) => ({
    weight: round(units.weight === "kg" ? p.weightKg : p.weightKg / 0.45359237),
    dimension: {
      length: round(p.lengthCm / (units.length === "cm" ? 1 : 2.54)),
      width: round(p.widthCm / (units.length === "cm" ? 1 : 2.54)),
      height: round(p.heightCm / (units.length === "cm" ? 1 : 2.54)),
    },
  }));
}
