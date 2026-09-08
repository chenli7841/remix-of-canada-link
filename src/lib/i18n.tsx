import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export type Lang = "zh" | "en";
export type Currency = "CNY" | "CAD";

// Default fallback used only until app_settings.fx_rate loads: 1 CAD = 5.26 CNY.
// Always convert via useApp().cnyToCad() / cadToCny() — never a static multiplier —
// so every conversion reflects the live admin-configured rate (/admin/system → 汇率设置).
export const DEFAULT_CNY_PER_CAD = 5.26;

const dict = {
  zh: {
    "nav.home": "首页",
    "nav.products": "商品",
    "nav.shipping": "集运服务",
    "nav.track": "物流追踪",
    "nav.about": "关于我们",
    "nav.contact": "联系我们",
    "nav.cart": "购物车",
    "nav.signin": "登录",

    "hero.tag": "中国 · 加拿大 跨境直采",
    "hero.title": "把整个中国\n搬到你家门口",
    "hero.subtitle": "自营商城 + 国际集运一站搞定。源头好物、双币结算、全程可追踪，平均 7–12 天送达加拿大。",
    "hero.cta_shop": "立即选购",
    "hero.cta_ship": "了解集运",
    "home.shipping_entry": "中国 → 加拿大 集运",
    "home.shipping_entry_sub": "7-12 天空运 · 30-45 天海运",
    "home.shipping_entry_btn": "进入集运",

    "stats.orders": "累计订单",
    "stats.warehouses": "国内集运仓",
    "stats.cities": "覆盖加拿大城市",
    "stats.days": "平均送达天数",

    "section.categories": "热门品类",
    "section.featured": "本周精选",
    "section.flow": "服务流程",
    "section.flow_sub": "从下单到签收，每一步都看得见",
    "section.trust": "为什么选择我们",

    "flow.1_t": "线上下单",
    "flow.1_d": "在商城选购或提交代购链接",
    "flow.2_t": "国内入仓",
    "flow.2_d": "商品到达广州/义乌集运仓",
    "flow.3_t": "打包出库",
    "flow.3_d": "合箱减体积，节省运费",
    "flow.4_t": "国际运输",
    "flow.4_d": "空运 7 天 / 海运 35 天",
    "flow.5_t": "加拿大派送",
    "flow.5_d": "本地清关，门到门派送",

    "trust.1_t": "源头直采",
    "trust.1_d": "对接工厂与品牌方，价格透明",
    "trust.2_t": "双币结算",
    "trust.2_d": "实时显示 CNY / CAD，无隐藏汇率差",
    "trust.3_t": "全程追踪",
    "trust.3_d": "运单号一键查询，每个节点都有时间戳",
    "trust.4_t": "本地客服",
    "trust.4_d": "加拿大本地团队，中英双语支持",

    "product.from": "起",
    "product.add": "加入购物车",
    "product.weight": "重量",
    "product.eta": "预计送达",
    "product.days": "天",

    "shipping.title": "国际集运服务",
    "shipping.sub": "把你在淘宝、拼多多、1688 买的东西，安全送到加拿大",
    "shipping.calc_title": "运费计算器",
    "shipping.method": "运输方式",
    "shipping.air": "空运 (7-12天)",
    "shipping.sea": "海运 (30-45天)",
    "shipping.weight_label": "实际重量 (kg)",
    "shipping.volume_label": "体积 (长×宽×高 cm)",
    "shipping.calc_btn": "计算运费",
    "shipping.result": "预估运费",
    "shipping.note": "* 实际运费以入库实测为准，体积重 = 长×宽×高/6000",
    "shipping.login_to_apply": "登录 / 注册",
    "shipping.login_hint": "登录后可提交集运单并接收短信通知",

    "track.title": "物流追踪",
    "track.sub": "输入电商订单号 / 集运订单号 / 运单号 / 国内单号 / 国际单号，查询您包裹的实时状态",
    "track.placeholder": "订单号 / 运单号 / 国内单号 / 国际单号，如 SC2026000123",
    "track.btn": "查询",
    "track.notfound": "未找到相关记录，请检查订单号/运单号后重试",
    "track.demo_hint": "示例运单号：SC2026000123",

    "about.title": "关于 SinoCargo",
    "contact.title": "联系我们",
    "contact.cn_office": "中国办公室",
    "contact.ca_office": "加拿大办公室",
    "contact.hours": "服务时间",

    "footer.tagline": "中国 → 加拿大，跨境无界",
    "footer.rights": "保留所有权利。",

    "common.learn_more": "了解更多",
    "common.view_all": "查看全部",

    "ptype.all": "全部商品",
    "ptype.personal": "个人采购",
    "ptype.business": "商业采购",
    "ptype.personal_desc": "单件零售 · 适合个人 / 家庭使用",
    "ptype.business_desc": "批发起订 · 工厂直供 · 支持 OEM",
    "ptype.moq": "起订量",
    "ptype.tier": "阶梯价",
  },
  en: {
    "nav.home": "Home",
    "nav.products": "Shop",
    "nav.shipping": "Shipping",
    "nav.track": "Track",
    "nav.about": "About",
    "nav.contact": "Contact",
    "nav.cart": "Cart",
    "nav.signin": "Sign in",

    "hero.tag": "China · Canada Cross-Border",
    "hero.title": "China sourcing,\ndelivered home.",
    "hero.subtitle":
      "Self-operated marketplace plus international consolidation. Source goods, dual-currency checkout, end-to-end tracking — 7–12 days to your door in Canada.",
    "hero.cta_shop": "Shop now",
    "hero.cta_ship": "How shipping works",
    "home.shipping_entry": "China → Canada shipping",
    "home.shipping_entry_sub": "Air 7-12 days · Sea 30-45 days",
    "home.shipping_entry_btn": "Enter shipping",

    "stats.orders": "Orders shipped",
    "stats.warehouses": "China warehouses",
    "stats.cities": "Cities in Canada",
    "stats.days": "Avg. delivery days",

    "section.categories": "Popular categories",
    "section.featured": "This week's picks",
    "section.flow": "How it works",
    "section.flow_sub": "Every step is visible — from order to doorstep",
    "section.trust": "Why SinoCargo",

    "flow.1_t": "Place order",
    "flow.1_d": "Shop our catalog or submit a sourcing link",
    "flow.2_t": "Warehouse intake",
    "flow.2_d": "Items arrive at our Guangzhou / Yiwu hub",
    "flow.3_t": "Consolidate",
    "flow.3_d": "Repack to reduce volume and save freight",
    "flow.4_t": "International leg",
    "flow.4_d": "Air 7 days / Sea 35 days to Canada",
    "flow.5_t": "Canada delivery",
    "flow.5_d": "Local clearance, door-to-door dispatch",

    "trust.1_t": "Source direct",
    "trust.1_d": "Factory & brand partners, transparent pricing",
    "trust.2_t": "Dual currency",
    "trust.2_d": "Live CNY / CAD display, no hidden FX markup",
    "trust.3_t": "End-to-end tracking",
    "trust.3_d": "One tracking number, timestamps at every node",
    "trust.4_t": "Local support",
    "trust.4_d": "Canada-based team, bilingual EN/中文",

    "product.from": "from",
    "product.add": "Add to cart",
    "product.weight": "Weight",
    "product.eta": "ETA",
    "product.days": "days",

    "shipping.title": "International consolidation",
    "shipping.sub": "Ship anything you buy on Taobao, Pinduoduo, 1688 safely to Canada",
    "shipping.calc_title": "Freight calculator",
    "shipping.method": "Shipping method",
    "shipping.air": "Air (7-12 days)",
    "shipping.sea": "Sea (30-45 days)",
    "shipping.weight_label": "Actual weight (kg)",
    "shipping.volume_label": "Volume (L×W×H cm)",
    "shipping.calc_btn": "Calculate",
    "shipping.result": "Estimated freight",
    "shipping.note": "* Final freight billed by actual measurement on intake. Volumetric weight = L×W×H/6000.",
    "shipping.login_to_apply": "Sign in / Sign up",
    "shipping.login_hint": "Sign in to submit a shipment request and get SMS updates",

    "track.title": "Track your shipment",
    "track.sub": "Enter your shop order, forwarding order, waybill, domestic or international tracking number to see real-time status",
    "track.placeholder": "Order / waybill / domestic / intl tracking number, e.g. SC2026000123",
    "track.btn": "Track",
    "track.notfound": "No matching record found. Please check the number and retry.",
    "track.demo_hint": "Demo tracking number: SC2026000123",

    "about.title": "About SinoCargo",
    "contact.title": "Contact us",
    "contact.cn_office": "China office",
    "contact.ca_office": "Canada office",
    "contact.hours": "Service hours",

    "footer.tagline": "China → Canada, borderless.",
    "footer.rights": "All rights reserved.",

    "common.learn_more": "Learn more",
    "common.view_all": "View all",

    "ptype.all": "All products",
    "ptype.personal": "Personal",
    "ptype.business": "Business",
    "ptype.personal_desc": "Single-unit retail · for individuals & families",
    "ptype.business_desc": "Wholesale MOQ · factory direct · OEM ready",
    "ptype.moq": "MOQ",
    "ptype.tier": "Tier price",
  },
} as const;

export type TKey = keyof (typeof dict)["zh"];

interface AppCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  t: (k: TKey) => string;
  formatPrice: (cny: number) => string;
  /** CNY amount for 1 CAD (admin-configurable, default 5.26). */
  cnyPerCad: number;
  /** Convert a CAD amount to CNY using the current rate. */
  cadToCny: (cad: number) => number;
  /** Convert a CNY amount to CAD using the current rate. */
  cnyToCad: (cny: number) => number;
  /** Format any CAD amount according to the current display currency. */
  formatCad: (cad: number) => string;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("zh");
  const [currency, setCurrencyState] = useState<Currency>("CAD");
  const [cnyPerCad, setCnyPerCad] = useState<number>(DEFAULT_CNY_PER_CAD);

  useEffect(() => {
    const l = localStorage.getItem("lang") as Lang | null;
    const c = localStorage.getItem("currency") as Currency | null;
    if (l === "zh" || l === "en") setLangState(l);
    if (c === "CNY" || c === "CAD") setCurrencyState(c);
    // Load fx_rate from public app_settings (SELECT policy is open).
    (async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "fx_rate").maybeSingle();
      const v = Number((data?.value as any)?.cny_per_cad);
      if (Number.isFinite(v) && v > 0) setCnyPerCad(v);
    })();
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("lang", l);
  };
  const setCurrency = (c: Currency) => {
    setCurrencyState(c);
    localStorage.setItem("currency", c);
  };

  const t = (k: TKey) => dict[lang][k] ?? k;

  const cadToCny = (cad: number) => cad * cnyPerCad;
  const cnyToCad = (cny: number) => cny / cnyPerCad;

  const formatPrice = (cny: number) => {
    if (currency === "CNY") return `¥${cny.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
    return `CA$${cnyToCad(cny).toLocaleString("en-CA", { maximumFractionDigits: 2 })}`;
  };
  const formatCad = (cad: number) => {
    if (currency === "CNY") return `¥${cadToCny(cad).toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
    return `CA$${cad.toLocaleString("en-CA", { maximumFractionDigits: 2 })}`;
  };

  return (
    <Ctx.Provider
      value={{ lang, setLang, currency, setCurrency, t, formatPrice, cnyPerCad, cadToCny, cnyToCad, formatCad }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useApp() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp must be used inside AppProvider");
  return c;
}
