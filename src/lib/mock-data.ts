import type { Lang } from "./i18n";

export interface Category {
  slug: string;
  name: { zh: string; en: string };
  icon: string;
}

export const categories: Category[] = [
  { slug: "electronics", name: { zh: "数码电子", en: "Electronics" }, icon: "📱" },
  { slug: "fashion", name: { zh: "服饰鞋包", en: "Fashion" }, icon: "👜" },
  { slug: "beauty", name: { zh: "美妆个护", en: "Beauty" }, icon: "💄" },
  { slug: "home", name: { zh: "家居生活", en: "Home" }, icon: "🛋️" },
  { slug: "food", name: { zh: "食品零食", en: "Snacks" }, icon: "🍜" },
  { slug: "mom-baby", name: { zh: "母婴用品", en: "Mom & Baby" }, icon: "🍼" },
  { slug: "health", name: { zh: "保健养生", en: "Health" }, icon: "🌿" },
  { slug: "stationery", name: { zh: "文具周边", en: "Stationery" }, icon: "✏️" },
];

export type PurchaseType = "personal" | "business";

export interface Product {
  slug: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  priceCNY: number;
  weightKg: number;
  category: string;
  image: string; // emoji fallback or url
  badge?: { zh: string; en: string };
  purchaseType: PurchaseType;
  /** Business-only: minimum order quantity */
  moq?: number;
  /** Business-only: units per inner pack/box — quantity steps by this amount */
  packQty?: number;
  /** Business-only: weight of one full pack/carton (kg) — used instead of per-unit weight */
  packWeightKg?: number;
  /** Shipping routes this product is restricted to; empty/undefined = all routes allowed */
  availableRouteCodes?: string[];
  /** Routes configured for personal-purchase mode (sea/air); empty = fall back to availableRouteCodes */
  personalRouteCodes?: string[];
  /** Routes configured for business-purchase mode (sea/air); empty = fall back to availableRouteCodes */
  businessRouteCodes?: string[];
  /** Business-only: tiered/wholesale pricing hint */
  wholesaleNote?: { zh: string; en: string };
}

export const products: Product[] = [
  // === Personal purchases (B2C retail) ===
  {
    slug: "xiaomi-buds-5",
    name: { zh: "小米 Buds 5 真无线耳机", en: "Xiaomi Buds 5 Wireless Earbuds" },
    description: { zh: "降噪 · 空间音频 · 38h 续航，国行版本", en: "ANC, spatial audio, 38h battery, China edition" },
    priceCNY: 399,
    weightKg: 0.15,
    category: "electronics",
    image: "🎧",
    badge: { zh: "热卖", en: "Hot" },
    purchaseType: "personal",
  },
  {
    slug: "huawei-watch-gt5",
    name: { zh: "华为 Watch GT5 智能手表", en: "Huawei Watch GT5 Smartwatch" },
    description: { zh: "蓝宝石表镜，14 天超长续航", en: "Sapphire glass, 14-day battery life" },
    priceCNY: 1488,
    weightKg: 0.25,
    category: "electronics",
    image: "⌚",
    purchaseType: "personal",
  },
  {
    slug: "perfect-diary-lipstick",
    name: { zh: "完美日记 哑光小细跟口红", en: "Perfect Diary Matte Lipstick" },
    description: { zh: "丝绒哑光，持久不脱色", en: "Velvet matte, long-lasting" },
    priceCNY: 89,
    weightKg: 0.05,
    category: "beauty",
    image: "💋",
    badge: { zh: "新品", en: "New" },
    purchaseType: "personal",
  },
  {
    slug: "uniqlo-down-jacket",
    name: { zh: "优衣库 高级轻型羽绒服", en: "UNIQLO Ultra Light Down Jacket" },
    description: { zh: "国内官方专柜版，加拿大冬季神器", en: "Mainland retail edition, ideal for Canadian winters" },
    priceCNY: 599,
    weightKg: 0.4,
    category: "fashion",
    image: "🧥",
    purchaseType: "personal",
  },
  {
    slug: "haidilao-hotpot",
    name: { zh: "海底捞 番茄火锅底料 6 包", en: "Haidilao Tomato Hotpot Base × 6" },
    description: { zh: "正宗川味，一个人也能吃火锅", en: "Authentic Sichuan flavor, single-serve packs" },
    priceCNY: 138,
    weightKg: 1.8,
    category: "food",
    image: "🍲",
    badge: { zh: "包邮", en: "Free ship" },
    purchaseType: "personal",
  },
  {
    slug: "muji-storage-box",
    name: { zh: "无印良品 PP 收纳盒套装", en: "MUJI PP Storage Box Set" },
    description: { zh: "国内官网价格，加拿大门店 3 倍差价", en: "China retail price — 3× cheaper than Canada stores" },
    priceCNY: 268,
    weightKg: 2.5,
    category: "home",
    image: "📦",
    purchaseType: "personal",
  },
  {
    slug: "babycare-diapers",
    name: { zh: "Babycare 皇室纸尿裤 L 码", en: "Babycare Royal Diapers Size L" },
    description: { zh: "超薄透气，国货之光", en: "Ultra-thin breathable, top China brand" },
    priceCNY: 198,
    weightKg: 2.2,
    category: "mom-baby",
    image: "👶",
    purchaseType: "personal",
  },
  {
    slug: "yangshengtang-eyedrops",
    name: { zh: "养生堂 维生素 E 软胶囊", en: "By-Health Vitamin E Capsules" },
    description: { zh: "100 粒装，国产保健佳品", en: "100 capsules, premium domestic health brand" },
    priceCNY: 79,
    weightKg: 0.1,
    category: "health",
    image: "💊",
    purchaseType: "personal",
  },

  // === Business purchases (B2B wholesale) ===
  {
    slug: "b2b-bluetooth-speaker-100",
    name: { zh: "蓝牙音箱 OEM · 100 件起订", en: "Bluetooth Speaker OEM · MOQ 100" },
    description: {
      zh: "深圳工厂直供，支持贴牌与定制包装",
      en: "Shenzhen factory direct, OEM branding & custom packaging",
    },
    priceCNY: 58,
    weightKg: 0.45,
    category: "electronics",
    image: "🔊",
    badge: { zh: "批发", en: "Wholesale" },
    purchaseType: "business",
    moq: 100,
    wholesaleNote: { zh: "100+ ¥58 / 500+ ¥49 / 1000+ ¥42", en: "100+ ¥58 / 500+ ¥49 / 1000+ ¥42" },
  },
  {
    slug: "b2b-cotton-tshirt-200",
    name: { zh: "精梳棉 T 恤 · 200 件起批", en: "Combed Cotton T-Shirt · MOQ 200" },
    description: { zh: "义乌工厂，全码全色，可印 LOGO", en: "Yiwu factory, full size/color range, logo print ready" },
    priceCNY: 22,
    weightKg: 0.22,
    category: "fashion",
    image: "👕",
    purchaseType: "business",
    moq: 200,
    wholesaleNote: { zh: "200+ ¥22 / 1000+ ¥18", en: "200+ ¥22 / 1000+ ¥18" },
  },
  {
    slug: "b2b-kraft-mailer-1000",
    name: { zh: "牛皮纸快递袋 · 1000 个起", en: "Kraft Paper Mailers · MOQ 1000" },
    description: { zh: "电商打包神器，多尺寸可选", en: "E-commerce packaging essential, multiple sizes" },
    priceCNY: 380,
    weightKg: 12,
    category: "home",
    image: "📮",
    badge: { zh: "工厂直发", en: "Factory" },
    purchaseType: "business",
    moq: 1000,
    wholesaleNote: { zh: "1000 个 ¥380 / 5000+ 议价", en: "1000 ¥380 / 5000+ negotiable" },
  },
  {
    slug: "b2b-led-strip-500",
    name: { zh: "智能 LED 灯带 · 500 米起", en: "Smart LED Strip Light · MOQ 500m" },
    description: { zh: "RGB+WiFi 控制，适用零售与装修工程", en: "RGB + WiFi, retail and contractor friendly" },
    priceCNY: 14,
    weightKg: 0.08,
    category: "electronics",
    image: "💡",
    purchaseType: "business",
    moq: 500,
    wholesaleNote: { zh: "按米计价 ¥14/m", en: "Priced per meter ¥14/m" },
  },
];

export function localizedName<T extends { name: { zh: string; en: string } }>(item: T, lang: Lang) {
  return item.name[lang];
}

// Tracking demo
export interface TrackingEvent {
  time: string;
  location: { zh: string; en: string };
  status: { zh: string; en: string };
}
export interface Shipment {
  trackingNo: string;
  method: "air" | "sea";
  events: TrackingEvent[];
  eta: string;
}

export const shipments: Record<string, Shipment> = {
  SC2026000123: {
    trackingNo: "SC2026000123",
    method: "air",
    eta: "2026-06-25",
    events: [
      {
        time: "2026-06-18 09:12",
        location: { zh: "加拿大 多伦多", en: "Toronto, CA" },
        status: { zh: "派送中 — 司机已出库", en: "Out for delivery" },
      },
      {
        time: "2026-06-17 21:40",
        location: { zh: "加拿大 多伦多分拨中心", en: "Toronto sort facility" },
        status: { zh: "清关完成，已交本地快递", en: "Cleared customs, handed to last-mile" },
      },
      {
        time: "2026-06-16 03:05",
        location: { zh: "加拿大 多伦多机场", en: "Toronto Pearson Airport" },
        status: { zh: "到港，等待清关", en: "Arrived, awaiting clearance" },
      },
      {
        time: "2026-06-15 14:30",
        location: { zh: "中国 广州白云机场", en: "Guangzhou Baiyun Airport" },
        status: { zh: "国际航班起飞", en: "International flight departed" },
      },
      {
        time: "2026-06-14 11:00",
        location: { zh: "中国 广州集运仓", en: "Guangzhou warehouse" },
        status: { zh: "已合箱出库", en: "Consolidated & shipped out" },
      },
      {
        time: "2026-06-12 16:22",
        location: { zh: "中国 广州集运仓", en: "Guangzhou warehouse" },
        status: { zh: "包裹入库，正在打包", en: "Package received, repacking" },
      },
      {
        time: "2026-06-10 10:00",
        location: { zh: "线上", en: "Online" },
        status: { zh: "订单已创建", en: "Order placed" },
      },
    ],
  },
};
