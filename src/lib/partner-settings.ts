import { z } from "zod";
import type { PartnerRouteDraft } from "./partner-quote";
const num = z
  .string()
  .trim()
  .max(30)
  .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0), "请输入非负数");
const str = z.string().trim().max(200),
  currency = z.enum(["CAD", "USD"]);
// Canada Post postal-code first-character regions. X is shared by NT and NU;
// dispatch selection uses the recipient's explicit province, not X alone.
export const CANADA_SERVICE_PROVINCES = [
  ["BC","不列颠哥伦比亚","V"],["AB","阿尔伯塔","T"],
  ["SK","萨斯喀彻温","S"],["MB","曼尼托巴","R"],
  ["ON","安大略","K / L / M / N / P"],["QC","魁北克","G / H / J"],
  ["NB","新不伦瑞克","E"],["NS","新斯科舍","B"],
  ["PE","爱德华王子岛","C"],["NL","纽芬兰与拉布拉多","A"],
  ["YT","育空","Y"],["NT","西北地区","X（与 NU 共用）"],["NU","努纳武特","X（与 NT 共用）"],
] as const;
export function selectDispatchWarehouse<T extends {id:string;serviceProvinces?:string[]}>(warehouses:T[],province:string,selected?:string):T {
  if(selected){const w=warehouses.find(w=>w.id===selected);if(!w)throw Error('所选发货仓库不存在，请刷新后重选');return w;}
  const matches=warehouses.filter(w=>(w.serviceProvinces||[]).includes(province));
  if(matches.length!==1)throw Error(matches.length?'此省份有多个推荐仓库，请选择一个发货仓库':'此省份尚未分配发货仓库，请手动选择或联系管理员');
  return matches[0];
}
export const generalSchema = z.object({
  domesticRate: num,
  domesticDensity: num,
  domesticCurrency: currency,
  portRate: num,
  portCurrency: currency,
  fx: num,
  taxIncludedRateUsd: num.default("30"),
  localOversizeNotes: z.string().trim().max(2000).default(""),
  localHandlingLength: num.default("122"),
  localHandlingSecondSide: num.default("76"),
  localHandlingGirth: num.default("266"),
  localHandlingFee: num.default(""),
  localLargeLength: num.default("244"),
  localLargeGirth: num.default("330"),
  localLargeFee: num.default(""),
  localOversizeCurrency: currency.default("CAD"),
});

export function taxIncludedDuty(volume: number, rateUsd: string, fxText: string) {
  const rate=Number(rateUsd),fx=Number(fxText);
  if (!rateUsd.trim() || !Number.isFinite(rate) || rate<0) throw Error('包税每立方关税单价未设置或无效');
  if (!fxText.trim() || !Number.isFinite(fx) || fx<=0) throw Error('包税 USD/CAD 汇率未设置或无效');
  if (!Number.isFinite(volume) || volume<0) throw Error('包税计费体积无效');
  return {volume,rateUsd:rate,fx,amount:Math.round(volume*rate*fx*100)/100,currency:'CAD'};
}

// Applies only to warehouse-to-warehouse transport, never to provider rate details.
export function localTransferSurcharges(g: z.infer<typeof generalSchema>, packages: {lengthCm:number;widthCm:number;heightCm:number}[]) {
  const positive = (value:string, label:string) => {
    if (!value || !Number.isFinite(Number(value)) || Number(value)<=0) throw Error(`本地长途运输${label}未设置或无效`);
    return Number(value);
  };
  const hl=positive(g.localHandlingLength,'最长边阈值'), hs=positive(g.localHandlingSecondSide,'第二长边阈值'), hg=positive(g.localHandlingGirth,'长加围长阈值');
  const ll=positive(g.localLargeLength,'大包裹最长边阈值'), lg=positive(g.localLargeGirth,'大包裹长加围长阈值');
  let handling=0,large=0;
  for(const p of packages){
    const [l,w,h]=[p.lengthCm,p.widthCm,p.heightCm].sort((a,b)=>b-a);
    const girth=l+2*w+2*h;
    if(l>ll || girth>lg)large++;
    else if(l>hl || w>hs || girth>hg)handling++;
  }
  const fx=g.localOversizeCurrency==='USD'?positive(g.fx,'USD/CAD 汇率'):1;
  return [{name:'本地转运额外操作费',count:handling,fee:g.localHandlingFee},{name:'本地转运大型包裹附加费',count:large,fee:g.localLargeFee}].filter(r=>r.count>0).map(r=>{
    if(r.fee==='' || !Number.isFinite(Number(r.fee)) || Number(r.fee)<0)throw Error(`${r.name}未设置，请填写费用；不收费请明确填 0`);
    return {name:r.name,count:r.count,unitPrice:Number(r.fee),sourceCurrency:g.localOversizeCurrency,amount:Math.round(r.count*Number(r.fee)*fx*100)/100,currency:'CAD'};
  });
}
export const transportSchema = z.object({
  seaRate: num,
  seaCurrency: currency,
  seaMinKg: num,
  seaDivisor: num,
  seaMaxKgPerM3: num,
  airRate: num,
  airCurrency: currency,
  airMinKg: num,
  airDivisor: num,
});
export const warehouseSchema = z.object({
  serviceProvinces: z.array(z.string().refine(v=>CANADA_SERVICE_PROVINCES.some(p=>p[0]===v),'无效省份')).max(13).default([]),
  id: z.string().uuid(),
  label: str.min(1),
  name: str,
  company: str,
  phone: str,
  street: str,
  unit: str,
  city: str,
  province: str,
  postal: str,
  density: num,
  currency,
  transfers: z.array(z.object({ target: z.string().uuid(), rate: num })).max(100),
});
export const warehousesSchema = z
  .array(warehouseSchema)
  .max(100)
  .superRefine((rows, ctx) => {
    const ids = new Set(rows.map((w) => w.id));
    if (ids.size !== rows.length) ctx.addIssue({ code: "custom", message: "仓库编号重复" });
    for (const w of rows) {
      const targets = new Set();
      for (const t of w.transfers) {
        if (
          t.target === w.id ||
          !ids.has(t.target) ||
          targets.has(t.target) ||
          t.rate === "" ||
          !(Number(w.density) > 0)
        )
          ctx.addIssue({
            code: "custom",
            message: "请补齐有效转运单价及折算重量，目的仓不能重复或为自身",
          });
        targets.add(t.target);
      }
    }
  });
export const amazonWarehousesSchema = z
  .array(
    z.object({
      id: z.string().uuid(),
      code: str.toUpperCase().min(1, "请填写亚马逊仓库代码"),
      company: str.min(1, "请填写仓库名称"),
      street: str.min(1, "请填写详细地址"),
      city: str.min(1, "请填写城市"),
      province: z.enum([
        "AB",
        "BC",
        "MB",
        "NB",
        "NL",
        "NS",
        "NT",
        "NU",
        "ON",
        "PE",
        "QC",
        "SK",
        "YT",
      ]),
      postal: str.toUpperCase().regex(/^[A-Z]\d[A-Z] ?\d[A-Z]\d$/, "请填写有效加拿大邮编"),
      phone: str,
      enabled: z.boolean(),
    }),
  )
  .max(500)
  .superRefine((rows, ctx) => {
    if (new Set(rows.map((r) => r.code)).size !== rows.length)
      ctx.addIssue({ code: "custom", message: "亚马逊仓库代码不能重复" });
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      ctx.addIssue({ code: "custom", message: "亚马逊仓库记录重复" });
  });
export type AmazonWarehouseSetting = z.infer<typeof amazonWarehousesSchema>[number];
export const settingInput = z.discriminatedUnion("section", [
  z.object({ section: z.literal("general"), value: generalSchema }),
  z.object({ section: z.literal("transport"), value: transportSchema }),
  z.object({ section: z.literal("warehouses"), value: warehousesSchema }),
  z.object({ section: z.literal("amazonWarehouses"), value: amazonWarehousesSchema }),
]);
export type General = z.infer<typeof generalSchema>;
export type Transport = z.infer<typeof transportSchema>;
export type Warehouse = z.infer<typeof warehouseSchema>;
export type Settings = {
  general: General;
  transport: Transport;
  warehouses: Warehouse[];
  amazonWarehouses: AmazonWarehouseSetting[];
};
export const emptyGeneral: General = {
  domesticRate: "",
  domesticDensity: "",
  domesticCurrency: "USD",
  portRate: "",
  portCurrency: "CAD",
  fx: "",
  taxIncludedRateUsd: "30",
  localOversizeNotes: "",
  localHandlingLength: "122",
  localHandlingSecondSide: "76",
  localHandlingGirth: "266",
  localHandlingFee: "",
  localLargeLength: "244",
  localLargeGirth: "330",
  localLargeFee: "",
  localOversizeCurrency: "CAD",
};
export const emptyTransport: Transport = {
  seaRate: "",
  seaCurrency: "USD",
  seaMinKg: "",
  seaDivisor: "",
  seaMaxKgPerM3: "",
  airRate: "",
  airCurrency: "USD",
  airMinKg: "",
  airDivisor: "",
};
export const emptyRoute: PartnerRouteDraft = {
  shared: true,
  name: "",
  code: "",
  method: "sea",
  cargo: "general",
  enabled: false,
  originId: "",
  rounding: "0.5",
  ...emptyGeneral,
  seaRate: "",
  seaDensity: "",
  seaCurrency: "USD",
  originName: "",
  originPhone: "",
  originStreet: "",
  originCity: "",
  originProvince: "",
  originPostal: "",
  carrier: "",
  audience: "全部同行客户",
  customers: "",
  editors: "管理员",
  allowQuote: true,
  allowOrder: false,
};
export function resolvePartnerRoute(d: PartnerRouteDraft, s: Settings): PartnerRouteDraft {
  if (!d.shared) return d;
  const w = s.warehouses.find((w) => w.id === d.originId);
  if (!w) throw Error("线路起始仓库未设置或不存在");
  const t = s.transport,
    sea = d.method === "sea";
  const result = {
    ...d,
    ...s.general,
    seaRate: t.seaRate,
    seaDensity: t.seaMaxKgPerM3,
    seaCurrency: t.seaCurrency,
    airRate: t.airRate,
    airCurrency: t.airCurrency,
    divisor: sea ? t.seaDivisor : t.airDivisor,
    minKg: sea ? t.seaMinKg : t.airMinKg,
    originName: w.name,
    originPhone: w.phone,
    originStreet: [w.street, w.unit].filter(Boolean).join(", "),
    originCity: w.city,
    originProvince: w.province,
    originPostal: w.postal,
  };
  if (!result.divisor || Number(result.divisor) <= 0 || result.minKg === "" || !d.rounding)
    throw Error("请补齐运输方式的体积重除数、最低计费重量和线路进位方式");
  return result;
}
