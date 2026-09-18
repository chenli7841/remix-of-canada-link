// 线路相关的只读适配层，供 GET /routes 与 GET /routes/{routeCode}/order-schema 共用，
// 保证两者对"这条线路要不要填箱数"的判断口径完全一致。见
// docs/ship-api/shipper-api-v3.md 第 4、5.1 节，docs/ship-api/system-change-guide-v3.md
// 第 4 节。
import { sha256Hex } from "./auth.server";

// ship 客户线路可见性：有意复用现有的 vip_level 可见性机制（把 ship 的（未来）客户分级
// 设为 'ship'，管理员在线路管理页面勾选"可见客户等级=ship客户"）。这是账户/合作方级别
// 的判断——不针对某一个具体的本地客户号，所以不复用
// wechat-ai-routes.server.ts 的 isRouteVisibleToCustomer()（那个函数在"存在
// visible_customer_codes 时优先按客户号白名单判断"，对没有具体客户号的场景语义不对）。
export function isRouteVisibleToShip(route: {
  is_active: boolean;
  usage_scope: string;
  visible_vip_levels?: string[] | null;
  blacklist_vip_levels?: string[] | null;
}): boolean {
  if (!route.is_active) return false;
  if (!["forwarding", "both"].includes(route.usage_scope ?? "forwarding")) return false;
  if ((route.blacklist_vip_levels ?? []).includes("ship")) return false;
  return (route.visible_vip_levels ?? []).includes("ship");
}

// 跟 forwarding.index.tsx 的 FIELD_META 保持同一份标签/类型口径（那边是页面内部常量，
// 没有导出，这里按需要的字段单独维护一份；改动时两边一起同步）。
const ITEM_FIELD_META: Record<
  string,
  { label: string; type: "string" | "integer" | "decimal"; min?: number; maxLength?: number }
> = {
  name: { label: "品名", type: "string", maxLength: 200 },
  quantity: { label: "数量", type: "integer", min: 1 },
  hscode: { label: "HS Code", type: "string", maxLength: 20 },
  box_count: { label: "箱数", type: "integer", min: 1 },
  inner_qty: { label: "每箱数量", type: "integer", min: 1 },
  material: { label: "材质", type: "string", maxLength: 100 },
  origin: { label: "产地", type: "string", maxLength: 100 },
  brand: { label: "品牌", type: "string", maxLength: 100 },
  unit_price: { label: "单价 CAD", type: "decimal", min: 0 },
  length_cm: { label: "长 (cm)", type: "decimal", min: 0 },
  width_cm: { label: "宽 (cm)", type: "decimal", min: 0 },
  height_cm: { label: "高 (cm)", type: "decimal", min: 0 },
  weight_kg: { label: "重量 (kg)", type: "decimal", min: 0 },
};

// name/quantity 是契约里明确规定的基础必填字段，不管线路 item_fields 有没有列出都要收；
// 其余字段是否出现、是否必填，完全由这条线路的 item_fields / item_field_required 决定。
const BASE_REQUIRED_FIELDS = ["name", "quantity"];

export type OrderSchemaField = {
  path: string;
  label: string;
  type: "string" | "integer" | "decimal" | "boolean" | "object" | "array";
  required: boolean;
  min?: number;
  maxLength?: number;
};

export function buildItemFields(route: { item_fields?: string[] | null; item_field_required?: any }): OrderSchemaField[] {
  const enabled = new Set<string>([...(route.item_fields ?? []), ...BASE_REQUIRED_FIELDS]);
  const requiredMap = (route.item_field_required ?? {}) as Record<string, boolean>;
  const out: OrderSchemaField[] = [];
  for (const key of Object.keys(ITEM_FIELD_META)) {
    if (!enabled.has(key)) continue;
    const meta = ITEM_FIELD_META[key];
    out.push({
      path: `packages[].items[].${key}`,
      label: meta.label,
      type: meta.type,
      required: BASE_REQUIRED_FIELDS.includes(key) ? true : !!requiredMap[key],
      ...(meta.min != null ? { min: meta.min } : {}),
      ...(meta.maxLength != null ? { maxLength: meta.maxLength } : {}),
    });
  }
  return out;
}

// 这条线路是不是"箱数已知"——由 item_fields 是否包含 box_count 且被标记必填决定，
// 跟 Shipper 那边靠同一份 order-schema 字段列表推断的口径完全一致，不额外暴露旗标字段
// （docs/ship-api/shipper-api-v3.md 5.1 节："服务方不再另外提供专门的标志字段"）。
export function isBoxCountKnownRoute(route: { item_fields?: string[] | null; item_field_required?: any }): boolean {
  const requiredMap = (route.item_field_required ?? {}) as Record<string, boolean>;
  return !!(route.item_fields ?? []).includes("box_count") && !!requiredMap["box_count"];
}

// 稳定的 schemaVersion：只要影响录单规则的字段有变化，这个值就会变，Shipper 可以拿它
// 判断线路规则是否已经过期（对应 ROUTE_SCHEMA_CHANGED 错误码）。不是数据库里存的字段，
// 现算现返，不需要额外迁移。
export function computeSchemaVersion(route: {
  item_fields?: string[] | null;
  item_field_required?: any;
  origin_warehouse_id?: string | null;
  cargo_type?: string | null;
  shipping_method?: string | null;
  destination_code?: string | null;
}): string {
  const basis = JSON.stringify({
    f: [...(route.item_fields ?? [])].sort(),
    r: route.item_field_required ?? {},
    w: route.origin_warehouse_id ?? null,
    c: route.cargo_type ?? null,
    m: route.shipping_method ?? null,
    d: route.destination_code ?? null,
  });
  return sha256Hex(basis).slice(0, 12);
}

export function mapRouteSummary(route: {
  code: string;
  name_zh: string;
  name_en?: string | null;
  is_active: boolean;
  destination_code?: string | null;
  shipping_method: string;
  cargo_type?: string | null;
  origin_warehouse_code?: string | null;
  item_fields?: string[] | null;
  item_field_required?: any;
}) {
  return {
    routeCode: route.code,
    name: route.name_zh,
    enabled: route.is_active,
    destinations: route.destination_code ? [route.destination_code] : [],
    schemaVersion: computeSchemaVersion(route),
    shippingMethod: route.shipping_method,
    cargoTypes: route.cargo_type ? [route.cargo_type] : [],
    originWarehouseCode: route.origin_warehouse_code ?? null,
  };
}
