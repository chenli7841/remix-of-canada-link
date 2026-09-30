import { z } from "zod";
import { addressSchema, quoteRecipientSchema, packageSchema } from "./express";
import {
  partnerPackageWeight,
  partnerVolumeFee,
  partnerDestinationFee,
} from "@/components/partner/partner-weight";
import { partnerDuty } from "@/components/partner/partner-duty";

const text = z.string().trim().max(200);
const numberText = z
  .string()
  .max(30)
  .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0), "请输入有效的非负数");
export const partnerRouteSchema = z.object({
  shared: z.boolean().optional(),
  originId: text.optional(),
  rounding: z.enum(["none", "0.5", "1"]).optional(),
  airRate: numberText.optional(),
  airCurrency: z.enum(["USD", "CAD"]).optional(),
  divisor: numberText.optional(),
  minKg: numberText.optional(),
  name: text.min(1),
  code: text.min(1),
  method: z.enum(["sea", "air"]),
  cargo: z.enum(["general", "sensitive"]),
  enabled: z.boolean(),
  domesticRate: numberText,
  domesticDensity: numberText,
  domesticCurrency: z.enum(["USD", "CAD"]),
  seaRate: numberText,
  seaDensity: numberText,
  seaCurrency: z.enum(["USD", "CAD"]),
  portRate: numberText,
  portCurrency: z.enum(["USD", "CAD"]),
  fx: numberText,
  originName: text,
  originPhone: text,
  originStreet: text,
  originCity: text,
  originProvince: text,
  originPostal: text,
  carrier: text,
  audience: z.enum(["指定同行客户", "全部同行客户"]),
  customers: z.string().max(10000),
  editors: z.literal("管理员"),
  allowQuote: z.boolean(),
  allowOrder: z.literal(false),
});
export type PartnerRouteDraft = z.infer<typeof partnerRouteSchema>;
export const quoteInputSchema = z
  .object({
    routeId: z.string().uuid(),
    dispatchWarehouseId: z.string().uuid().optional(),
    to: quoteRecipientSchema,
    items: z
      .array(
        z.object({
          name: text.min(1),
          hsId: z.string().uuid(),
          value: z.number().finite().positive().max(1e9),
          count: z.number().int().min(1).max(100),
          specs: z
            .array(packageSchema.extend({ count: z.number().int().min(1).max(100) }))
            .min(1)
            .max(100),
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine((v, ctx) => {
    if (v.items.some((i) => i.count !== i.specs.reduce((s, r) => s + r.count, 0)))
      ctx.addIssue({ code: "custom", message: "规格数量与品名总包裹数不一致" });
    if (v.items.reduce((s, i) => s + i.count, 0) > 100)
      ctx.addIssue({ code: "custom", message: "每次最多查询 100 箱" });
    if (v.to.region_id !== "CA")
      ctx.addIssue({ code: "custom", message: "目前仅支持加拿大收件地址" });
  });
export type PartnerQuoteInput = z.infer<typeof quoteInputSchema>;
export function routeOrigin(d: PartnerRouteDraft) {
  return addressSchema.parse({
    name: d.originName,
    company: d.originName,
    mobile_phone: d.originPhone,
    region_id: "CA",
    province: d.originProvince,
    city: d.originCity,
    postalcode: d.originPostal,
    address: d.originStreet,
    type: "commercial",
  });
}
export function routePricing(d: PartnerRouteDraft) {
  const n = (s: string) => (s.trim() === "" ? NaN : Number(s));
  return {
    domestic: {
      ratePerM3: n(d.domesticRate),
      kgPerM3: n(d.domesticDensity),
      currency: d.domesticCurrency,
    },
    sea: { ratePerM3: n(d.seaRate), kgPerM3: n(d.seaDensity), currency: d.seaCurrency },
    destination: { ratePerM3: n(d.portRate), currency: d.portCurrency },
  };
}
export function baseQuote(d: PartnerRouteDraft, input: PartnerQuoteInput, hs: any[]) {
  if (d.method !== "sea" && !d.shared) throw Error("空运计费规则尚未设置");
  const packages = input.items.flatMap((i) =>
    i.specs.flatMap((s) =>
      Array.from({ length: s.count }, () => ({
        lengthCm: s.lengthCm,
        widthCm: s.widthCm,
        heightCm: s.heightCm,
        weightKg: s.weightKg,
      })),
    ),
  );
  const weights = packages.map((p) =>
    partnerPackageWeight(
      p.lengthCm,
      p.widthCm,
      p.heightCm,
      p.weightKg,
      d.shared
        ? {
            divisor: Number(d.divisor),
            minimum: Number(d.minKg),
            step: d.rounding === "none" ? 0 : Number(d.rounding),
          }
        : undefined,
    )!,
  );
  if (weights.some((w) => !w)) throw Error("包裹计费重量参数缺失");
  const volume = packages.reduce((s, p) => s + (p.lengthCm * p.widthCm * p.heightCm) / 1e6, 0),
    actual = packages.reduce((s, p) => s + p.weightKg, 0);
  const pricing = routePricing(d),
    domestic = partnerVolumeFee(volume, actual, pricing.domestic),
    sea = partnerVolumeFee(volume, actual, pricing.sea),
    port = partnerDestinationFee(volume, pricing.destination);
  if (d.shared && sea) {
    sea.billableM3 = Math.ceil(sea.billableM3 * 10 - 1e-9) / 10;
    sea.amount = Math.round(sea.billableM3 * pricing.sea.ratePerM3 * 100) / 100;
  }
  const freight =
    d.method === "air"
      ? d.airRate?.trim() !== "" && Number.isFinite(Number(d.airRate))
        ? {
            amount:
              Math.round(weights.reduce((s, w) => s + w.chargeable, 0) * Number(d.airRate) * 100) /
              100,
            currency: d.airCurrency || "CAD",
          }
        : null
      : sea;
  if (!domestic || !freight || !port)
    throw Error("线路费用参数缺失，请管理员补齐国内、海运和目的港费");
  const duties = input.items.map((i) => {
    const row = hs.find((h) => h.id === i.hsId);
    const duty = partnerDuty(i.value, row);
    if (!duty) throw Error(`${i.name} 的 HS 编码或税率缺失`);
    return { name: i.name, hs: row.hs_code, ...duty };
  });
  const round = (n: number) => Math.round(n * 100) / 100;
  const cad = (f: { amount: number; currency: string }) => {
    if (f.currency === "CAD") return f.amount;
    const fx = Number(d.fx);
    if (!d.fx.trim() || !Number.isFinite(fx) || fx <= 0) throw Error("线路 USD/CAD 汇率缺失");
    return round(f.amount * fx);
  };
  const fees = [
    { name: "国内费用", amount: cad(domestic) },
    { name: d.method === "air" ? "空运费" : "海运费", amount: cad(freight) },
    { name: "目的港费用", amount: cad(port) },
    { name: "关税", amount: round(duties.reduce((s, r) => s + r.amount, 0)) },
  ];
  return {
    packages,
    weights,
    volume,
    actual,
    chargeable: weights.reduce((s, w) => s + w.chargeable, 0),
    duties,
    fees,
  };
}
