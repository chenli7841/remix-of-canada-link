// 微信 AI 客服可用线路解析（唯一入口）。
// 规则：is_active=true + 起点仓 = 义乌仓(YW) + usage_scope 含 forwarding
//       + wechat_ai_enabled=true + 对该客户可见（VIP/客户号白名单、黑名单）。

export const WECHAT_AI_WAREHOUSE_CODE = "YW";

const SHIPPING_ZH: Record<string, string> = {
  air: "空运",
  sea: "海运",
  truck: "陆运",
  express: "快递",
  storage: "仓储",
};

export type WechatAiRouteOption = {
  route_id: string;
  route_code: string;
  route_name: string;
  shipping_method: string;
  cargo_type: string;
  transit_time_text: string | null;
  price_text: string | null;
};

export function isRouteVisibleToCustomer(r: any, customerCode: string, vip: string): boolean {
  if (!["forwarding", "both"].includes(String(r.usage_scope ?? "forwarding"))) return false;
  if ((r.blacklist_customer_codes ?? []).includes(customerCode)) return false;
  if ((r.blacklist_vip_levels ?? []).includes(vip)) return false;
  if ((r.visible_customer_codes ?? []).length) return (r.visible_customer_codes ?? []).includes(customerCode);
  return (r.visible_vip_levels ?? []).includes(vip);
}

export function toRouteOption(r: any): WechatAiRouteOption {
  const min = r.transit_days_min ?? null;
  const max = r.transit_days_max ?? null;
  const transit = min && max ? `${min}-${max}天` : min ? `${min}天起` : max ? `${max}天内` : null;
  return {
    route_id: String(r.id),
    route_code: String(r.code),
    route_name: String(r.name_zh ?? r.code),
    shipping_method: String(r.shipping_method),
    cargo_type: String(r.cargo_type),
    transit_time_text: transit,
    price_text: r.wechat_ai_price_text ?? null,
  };
}

export function shippingMethodZh(m: string): string {
  return SHIPPING_ZH[m] ?? m;
}

/** 返回义乌仓信息 + 对该客户开放给微信 AI 的线路（原始行）。 */
export async function listWechatAiRoutes(
  admin: any,
  opts: { customer_code: string; vip_level: string },
): Promise<{ warehouse: { id: string; code: string; name: string } | null; routes: any[] }> {
  const { data: wh } = await admin
    .from("warehouses")
    .select("id, code, name_zh")
    .eq("code", WECHAT_AI_WAREHOUSE_CODE)
    .maybeSingle();

  if (!wh) return { warehouse: null, routes: [] };

  const { data: rows } = await admin
    .from("shipping_routes")
    .select(
      "id, code, name_zh, shipping_method, cargo_type, destination_code, usage_scope, transit_days_min, transit_days_max, sort_order, wechat_ai_enabled, wechat_ai_price_text, origin_warehouse_id, visible_vip_levels, visible_customer_codes, blacklist_vip_levels, blacklist_customer_codes, item_field_required",
    )
    .eq("is_active", true)
    .eq("wechat_ai_enabled", true)
    .eq("origin_warehouse_id", wh.id);

  const routes = ((rows ?? []) as any[])
    .filter((r) => isRouteVisibleToCustomer(r, opts.customer_code, opts.vip_level))
    .sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) || String(a.code).localeCompare(String(b.code)));

  return { warehouse: { id: String(wh.id), code: String(wh.code), name: String(wh.name_zh ?? wh.code) }, routes };
}

/** 客户默认收货地址 */
export async function getDefaultAddress(admin: any, userId: string) {
  const { data } = await admin
    .from("addresses")
    .select("id, recipient, phone, city, province, country, postal_code, line1, is_default")
    .eq("user_id", userId)
    .eq("is_default", true)
    .maybeSingle();
  return data ?? null;
}
