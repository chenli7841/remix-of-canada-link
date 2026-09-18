// POST /orders 的核心编排：校验请求 -> 解析线路/客户 -> 建订单专属地址 -> 调用原子
// 建单 RPC -> 组装契约响应。具体规则见 docs/ship-api/shipper-api-v3.md 第 5、5.1 节。
import { ShipApiError, sha256Hex } from "./auth.server";
import { buildItemFields, computeSchemaVersion, isBoxCountKnownRoute, isRouteVisibleToShip } from "./routes.server";
import { findOrCreateShipCustomer } from "./customers.server";
import { computeOrderEditToken } from "./concurrency.server";

type FieldError = { path: string; message: string };

function fail(code: ConstructorParameters<typeof ShipApiError>[0], message: string, fields?: FieldError[]): never {
  throw new ShipApiError(code, message, fields);
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function requireStr(body: any, path: string, errors: FieldError[]): string {
  const v = str(body?.[path]);
  if (!v) errors.push({ path, message: "必填" });
  return v;
}

// 收/寄件地址的基础必填字段（合同 §5：name/phone/countryCode/addressLine1 必填；
// province/city/district/postalCode 按线路要求——本仓库目前没有按线路配置地址字段
// 必填与否的数据源，这里只校验合同规定的这四个通用必填项）。
function normalizeAddress(raw: any, prefix: string, errors: FieldError[]) {
  const name = str(raw?.name);
  const phone = str(raw?.phone);
  const countryCode = str(raw?.countryCode).toUpperCase();
  const addressLine1 = str(raw?.addressLine1);
  if (!name) errors.push({ path: `${prefix}.name`, message: "必填" });
  if (!phone) errors.push({ path: `${prefix}.phone`, message: "必填" });
  if (!countryCode) errors.push({ path: `${prefix}.countryCode`, message: "必填" });
  if (!addressLine1) errors.push({ path: `${prefix}.addressLine1`, message: "必填" });
  return {
    name,
    phone,
    countryCode,
    province: str(raw?.province) || null,
    city: str(raw?.city) || null,
    district: str(raw?.district) || null,
    addressLine1,
    addressLine2: str(raw?.addressLine2) || null,
    postalCode: str(raw?.postalCode) || null,
    email: str(raw?.email) || null,
  };
}

type NormalizedItem = {
  name: string;
  quantity: number;
  unit_price_cad: number | null;
  extras: Record<string, unknown>;
};

// 按这条线路的 order-schema 字段清单校验+归一化一个物品；required 校验失败往
// errors 里追加，不在这里直接抛错（同一批物品的多个错误要一次性收集返回）。
function normalizeItem(
  raw: any,
  fields: ReturnType<typeof buildItemFields>,
  pathPrefix: string,
  errors: FieldError[],
): NormalizedItem {
  const byKey = new Map(fields.map((f) => [f.path.split(".").pop() as string, f]));
  const get = (key: string) => raw?.[key];

  const name = str(get("name"));
  if (!name) errors.push({ path: `${pathPrefix}.name`, message: "必填" });
  const quantityRaw = get("quantity");
  const quantity = Number(quantityRaw);
  if (!(quantity > 0)) errors.push({ path: `${pathPrefix}.quantity`, message: "必须是正整数" });

  const extras: Record<string, unknown> = {};
  for (const key of ["hscode", "box_count", "inner_qty", "material", "origin", "brand", "length_cm", "width_cm", "height_cm", "weight_kg"]) {
    const field = byKey.get(key);
    if (!field) continue; // 这条线路的 schema 没有这个字段，不收也不校验
    const val = get(key);
    if (field.required && (val === undefined || val === null || val === "")) {
      errors.push({ path: `${pathPrefix}.${key}`, message: "必填" });
      continue;
    }
    if (val !== undefined && val !== null && val !== "") extras[key] = val;
  }

  const unitPriceField = byKey.get("unit_price");
  const unitPriceRaw = get("unit_price");
  const unitPriceMissing = unitPriceRaw === undefined || unitPriceRaw === null || unitPriceRaw === "";
  if (unitPriceField?.required && unitPriceMissing) {
    errors.push({ path: `${pathPrefix}.unit_price`, message: "必填" });
  }
  const unit_price_cad = unitPriceMissing ? null : Number(unitPriceRaw);

  return { name, quantity: Number.isFinite(quantity) ? quantity : 0, unit_price_cad, extras };
}

export type CreateOrderResult = { status: number; data: any };

export type ResolvedShipRoute = {
  route: any;
  boxKnown: boolean;
  fields: ReturnType<typeof buildItemFields>;
  warehouseCode: string;
};

// 线路解析 + schemaVersion 校验 + 唯一起点仓推导——create 和 update 共用，保证两个
// 接口对"这条线路现在是什么规则"的判断完全一致。
export async function resolveShipRoute(
  admin: any,
  routeCode: string,
  schemaVersion: string,
  destination: string,
  warehouseCodeIn: string | null,
): Promise<ResolvedShipRoute> {
  const { data: route, error: routeErr } = await admin
    .from("shipping_routes")
    .select(
      "id, code, is_active, usage_scope, shipping_method, destination_code, origin_warehouse_id, cargo_type, item_fields, item_field_required, visible_vip_levels, blacklist_vip_levels",
    )
    .eq("code", routeCode)
    .maybeSingle();
  if (routeErr) throw routeErr;
  if (!route || !isRouteVisibleToShip(route)) fail("ROUTE_NOT_FOUND", "线路不存在");
  if (destination !== (route.destination_code ?? "")) {
    fail("VALIDATION_FAILED", "destination 与线路目的地不一致", [{ path: "destination", message: "与线路 destination 不一致" }]);
  }
  const currentSchemaVersion = computeSchemaVersion(route);
  if (schemaVersion !== currentSchemaVersion) {
    fail("ROUTE_SCHEMA_CHANGED", "线路规则已变化，请重新获取 order-schema");
  }

  let warehouseCode = warehouseCodeIn;
  if (route.origin_warehouse_id) {
    const { data: wh } = await admin.from("warehouses").select("code").eq("id", route.origin_warehouse_id).maybeSingle();
    if (wh?.code) warehouseCode = wh.code; // 唯一起点仓由服务方推导，不采信/不要求 Shipper 猜
  }
  if (!warehouseCode) fail("VALIDATION_FAILED", "该线路需要 warehouseCode", [{ path: "warehouseCode", message: "必填" }]);

  return { route, boxKnown: isBoxCountKnownRoute(route), fields: buildItemFields(route), warehouseCode };
}

export type ValidatedItemsPayload = {
  normalizedPackages: { clientPackageId: string; items: NormalizedItem[] }[];
  normalizedItems: NormalizedItem[];
};

// 箱数已知 / 未知两种请求形状分别校验——create 和 update 共用。
export function validateItemsPayload(body: any, boxKnown: boolean, fields: ReturnType<typeof buildItemFields>): ValidatedItemsPayload {
  const errors: FieldError[] = [];
  let normalizedPackages: { clientPackageId: string; items: NormalizedItem[] }[] = [];
  let normalizedItems: NormalizedItem[] = [];

  if (boxKnown) {
    if (body.items !== undefined) {
      fail("VALIDATION_FAILED", "该线路箱数已知，应提交 packages[]，不接受订单级别 items", [
        { path: "items", message: "该线路不接受此字段" },
      ]);
    }
    const packageCount = Number(body.packageCount);
    const packagesRaw = Array.isArray(body.packages) ? body.packages : null;
    if (!packagesRaw || packagesRaw.length === 0) fail("VALIDATION_FAILED", "packages 不能为空", [{ path: "packages", message: "必填" }]);
    if (!(packageCount > 0) || packageCount !== packagesRaw!.length) {
      fail("PACKAGE_COUNT_MISMATCH", "packageCount 与 packages 长度不一致");
    }
    const seenIds = new Set<string>();
    normalizedPackages = packagesRaw!.map((p: any, i: number) => {
      const clientPackageId = str(p?.clientPackageId);
      if (!clientPackageId) errors.push({ path: `packages[${i}].clientPackageId`, message: "必填" });
      if (clientPackageId && seenIds.has(clientPackageId)) {
        errors.push({ path: `packages[${i}].clientPackageId`, message: "同单内必须唯一" });
      }
      seenIds.add(clientPackageId);
      const itemsRaw = Array.isArray(p?.items) ? p.items : [];
      if (itemsRaw.length === 0) errors.push({ path: `packages[${i}].items`, message: "不能为空" });
      const items = itemsRaw.map((it: any, j: number) => normalizeItem(it, fields, `packages[${i}].items[${j}]`, errors));
      return { clientPackageId, items };
    });
  } else {
    if (body.packages !== undefined || body.packageCount !== undefined) {
      fail("VALIDATION_FAILED", "该线路箱数未知（海运），应提交订单级别 items[]，不接受 packages/packageCount", [
        { path: "packages", message: "该线路不接受此字段" },
      ]);
    }
    const itemsRaw = Array.isArray(body.items) ? body.items : null;
    if (!itemsRaw || itemsRaw.length === 0) fail("VALIDATION_FAILED", "items 不能为空", [{ path: "items", message: "必填" }]);
    normalizedItems = itemsRaw!.map((it: any, i: number) => normalizeItem(it, fields, `items[${i}]`, errors));
  }
  if (errors.length) fail("VALIDATION_FAILED", "请求物品/箱子信息不完整", errors);
  return { normalizedPackages, normalizedItems };
}

export async function createShipOrder(admin: any, partnerKey: string, body: any): Promise<CreateOrderResult> {
  if (!body || typeof body !== "object") fail("INVALID_REQUEST", "请求体不是合法 JSON 对象");

  const errors: FieldError[] = [];
  const domesticNumber = requireStr(body, "domesticNumber", errors);
  const externalCustomerId = requireStr(body, "externalCustomerId", errors);
  const routeCode = requireStr(body, "routeCode", errors);
  const schemaVersion = requireStr(body, "schemaVersion", errors);
  const destination = requireStr(body, "destination", errors);
  const remark = str(body.remark) || null;
  const warehouseCodeIn = str(body.warehouseCode) || null;
  if (errors.length) fail("VALIDATION_FAILED", "请求缺少必填字段", errors);

  const recipient = normalizeAddress(body.recipient, "recipient", errors);
  if (errors.length) fail("VALIDATION_FAILED", "收件地址不完整", errors);

  const { boxKnown, fields, warehouseCode } = await resolveShipRoute(admin, routeCode, schemaVersion, destination, warehouseCodeIn);
  const { normalizedPackages, normalizedItems } = validateItemsPayload(body, boxKnown, fields);

  // ---------- 客户身份：已建档直接复用，否则用 customerProfile 建一条新档案 ----------
  const { data: existingMapping } = await admin
    .from("partner_customer_mappings")
    .select("local_user_id")
    .eq("partner_key", partnerKey)
    .eq("external_customer_id", externalCustomerId)
    .maybeSingle();
  if (!existingMapping && !body.customerProfile) {
    fail("VALIDATION_FAILED", "首次下单必须提供 customerProfile", [{ path: "customerProfile", message: "必填" }]);
  }
  const cp = body.customerProfile ?? {};
  const customer = await findOrCreateShipCustomer(admin, {
    partnerKey,
    externalCustomerId,
    name: str(cp.name) || recipient.name,
    phone: str(cp.phone) || recipient.phone,
    email: str(cp.email) || null,
  });

  // ---------- 订单专属收件地址：新开一条记录，绝不覆盖客户的全局默认地址 ----------
  const { data: addrIns, error: addrErr } = await admin
    .from("addresses")
    .insert({
      user_id: customer.localUserId,
      recipient: recipient.name,
      phone: recipient.phone,
      country: recipient.countryCode,
      province: recipient.province ?? "",
      city: recipient.city ?? "",
      postal_code: recipient.postalCode ?? "",
      line1: recipient.addressLine1,
      line2: recipient.addressLine2,
      destination_code: destination || null,
      is_default: false,
    })
    .select("id")
    .single();
  if (addrErr) throw addrErr;

  // ---------- 幂等/去重指纹：基于建单的业务内容（不含 requestId/idempotencyKey 本身）----------
  const fingerprint = sha256Hex(
    JSON.stringify({
      routeCode,
      destination,
      recipient,
      remark,
      packages: normalizedPackages,
      items: normalizedItems,
    }),
  );

  const { data: rpcResult, error: rpcErr } = await admin.rpc("ship_create_forwarding_order", {
    _partner_key: partnerKey,
    _domestic_number: domesticNumber,
    _local_user_id: customer.localUserId,
    _route_code: routeCode,
    _warehouse_code: warehouseCode,
    _address_id: addrIns!.id,
    _note: remark,
    _insured: false,
    _box_known: boxKnown,
    _packages: normalizedPackages.map((p) => ({
      client_package_id: p.clientPackageId,
      items: p.items.map((it) => ({ name: it.name, quantity: it.quantity, unit_price_cad: it.unit_price_cad })),
    })),
    _items: normalizedItems.map((it) => ({
      name: it.name,
      quantity: it.quantity,
      unit_price_cad: it.unit_price_cad,
      extras: it.extras,
    })),
    _request_fingerprint: fingerprint,
  });
  if (rpcErr) {
    const code = (rpcErr as any).code as string | undefined;
    if (code === "PT404") fail("ROUTE_NOT_FOUND", "线路不存在");
    if (code === "PT409") fail("DOMESTIC_NUMBER_CONFLICT", "该国内单号已存在且内容不同，请使用修改接口");
    if (code === "PT422") fail("VALIDATION_FAILED", rpcErr.message ?? "请求校验失败");
    throw rpcErr;
  }

  const forwardingId = rpcResult.forwarding_id as string;
  const replayed = !!rpcResult.replayed;

  // ---------- 组装响应：真实号码只能从数据库读，不能自己拼 ----------
  const { data: fo, error: foErr } = await admin
    .from("forwarding_orders")
    .select("id, request_no, domestic_tracking_no, status, updated_at, customer_code")
    .eq("id", forwardingId)
    .maybeSingle();
  if (foErr || !fo) throw foErr ?? new Error("forwarding order missing after create");

  const { data: waybills, error: wbErr } = await admin
    .from("waybills")
    .select("id, waybill_no, mark_no, box_no, items_summary, client_package_id, updated_at")
    .eq("forwarding_id", forwardingId)
    .order("box_no", { ascending: true });
  if (wbErr) throw wbErr;
  const wbRows = (waybills ?? []) as any[];

  const { data: profile } = await admin
    .from("profiles")
    .select("id, updated_at")
    .eq("id", customer.localUserId)
    .maybeSingle();

  const editToken = computeOrderEditToken({ updated_at: fo.updated_at }, wbRows);
  const customerEditToken = profile ? sha256Hex(`${profile.id}:${profile.updated_at}`) : "";

  const contentsOf = (summary: any): string =>
    (Array.isArray(summary) ? summary : [])
      .map((it: any) => `${it?.name ?? ""} × ${it?.quantity ?? 1}`)
      .join(", ") || "-";

  let packagesOut: any[];
  let labelData: any[];
  if (boxKnown) {
    // box_no 按 001/002/... 顺序生成，跟 packages[] 提交顺序一一对应（同一 SQL 循环
    // 按数组顺序建的）。
    packagesOut = wbRows.map((w, i) => ({
      clientPackageId: w.client_package_id ?? null,
      waybillNumber: w.waybill_no,
      sequence: i + 1,
    }));
    labelData = wbRows.map((w, i) => ({
      waybillNumber: w.waybill_no,
      domesticNumber: fo.domestic_tracking_no,
      customerNumber: fo.customer_code,
      recipientName: recipient.name,
      phone: recipient.phone,
      address: [recipient.addressLine2, recipient.addressLine1, recipient.city, recipient.province, recipient.postalCode, recipient.countryCode]
        .filter(Boolean)
        .join(", "),
      destination,
      contents: contentsOf(w.items_summary),
      sequence: i + 1,
      totalPackages: wbRows.length,
    }));
  } else {
    // 箱数未知：没有真实箱号，只给一张整单参考面单（waybillNumber=null），Shipper
    // 靠这一张识别整批货，等收货完成后按国内单号重新查询拿真实箱号。
    packagesOut = [];
    labelData = [
      {
        waybillNumber: null,
        domesticNumber: fo.domestic_tracking_no,
        customerNumber: fo.customer_code,
        recipientName: recipient.name,
        phone: recipient.phone,
        address: [recipient.addressLine2, recipient.addressLine1, recipient.city, recipient.province, recipient.postalCode, recipient.countryCode]
          .filter(Boolean)
          .join(", "),
        destination,
        contents: normalizedItems.map((it) => `${it.name} × ${it.quantity}`).join(", ") || "-",
        sequence: 1,
        totalPackages: 1,
      },
    ];
  }

  return {
    status: replayed ? 200 : 201,
    data: {
      domesticNumber: fo.domestic_tracking_no,
      externalCustomerId,
      customerNumber: fo.customer_code,
      customerCreated: customer.customerCreated,
      customerEditToken,
      status: fo.status === "pending" ? "PENDING_INBOUND" : "UNKNOWN",
      editable: true,
      deletable: true,
      editToken,
      packageCount: boxKnown ? packagesOut.length : null,
      packages: packagesOut,
      labelData,
      requestNo: fo.request_no,
      replayed,
    },
  };
}
