// PUT/DELETE 编排：跟 create 一样，requestId 级别的校验（字段/线路/物品形状）在
// TypeScript 层做，真正的锁定判定 + 写入必须原子发生的部分交给 SQL 函数
// （ship_update_forwarding_order / ship_delete_forwarding_order）——这里的
// editable/editToken 检查是"先给个好懂的错误提示"，SQL 那边带行锁的重新核验才是
// 真正的安全边界，两者不是同一件事，不能只做前者。见
// docs/ship-api/shipper-api-v3.md 第 7、8 节。
import { ShipApiError } from "./auth.server";
import { assembleOrderResponse, resolvePartnerOrder } from "./order-query.server";
import { resolveShipRoute, validateItemsPayload } from "./orders.server";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeAddressForUpdate(raw: any, errors: { path: string; message: string }[]) {
  const name = str(raw?.name);
  const phone = str(raw?.phone);
  const countryCode = str(raw?.countryCode).toUpperCase();
  const addressLine1 = str(raw?.addressLine1);
  if (!name) errors.push({ path: "recipient.name", message: "必填" });
  if (!phone) errors.push({ path: "recipient.phone", message: "必填" });
  if (!countryCode) errors.push({ path: "recipient.countryCode", message: "必填" });
  if (!addressLine1) errors.push({ path: "recipient.addressLine1", message: "必填" });
  return {
    name,
    phone,
    countryCode,
    province: str(raw?.province) || null,
    city: str(raw?.city) || null,
    addressLine1,
    addressLine2: str(raw?.addressLine2) || null,
    postalCode: str(raw?.postalCode) || null,
  };
}

export async function updateShipOrder(
  admin: any,
  partnerKey: string,
  domesticNumber: string,
  ifMatch: string,
  body: any,
): Promise<{ status: number; data: any }> {
  if (!body || typeof body !== "object") throw new ShipApiError("INVALID_REQUEST", "请求体不是合法 JSON 对象");
  if (body.domesticNumber !== undefined || body.externalCustomerId !== undefined || body.customerProfile !== undefined) {
    throw new ShipApiError("VALIDATION_FAILED", "修改接口不接受 domesticNumber/externalCustomerId/customerProfile", [
      { path: "domesticNumber", message: "不允许在修改接口传入" },
    ]);
  }

  const order = await resolvePartnerOrder(admin, partnerKey, domesticNumber);
  const current = await assembleOrderResponse(admin, order, { includeFees: false });
  if (current.editToken !== ifMatch) {
    throw new ShipApiError("VERSION_CONFLICT", "editToken 已过期，请重新查询后再提交");
  }
  if (!current.editable) {
    throw new ShipApiError("ORDER_LOCKED", current.lockReason ?? "订单已锁定，无法修改");
  }

  const errors: { path: string; message: string }[] = [];
  const routeCode = str(body.routeCode);
  const schemaVersion = str(body.schemaVersion);
  const destination = str(body.destination);
  if (!routeCode) errors.push({ path: "routeCode", message: "必填" });
  if (!schemaVersion) errors.push({ path: "schemaVersion", message: "必填" });
  if (!destination) errors.push({ path: "destination", message: "必填" });
  if (errors.length) throw new ShipApiError("VALIDATION_FAILED", "请求缺少必填字段", errors);

  const recipient = normalizeAddressForUpdate(body.recipient, errors);
  if (errors.length) throw new ShipApiError("VALIDATION_FAILED", "收件地址不完整", errors);

  const warehouseCodeIn = str(body.warehouseCode) || null;
  const { boxKnown, fields, warehouseCode } = await resolveShipRoute(admin, routeCode, schemaVersion, destination, warehouseCodeIn);
  if (boxKnown !== order.box_count_known) {
    throw new ShipApiError("VALIDATION_FAILED", "不支持把订单从一种箱数模式切换到另一种，请使用待入库删除后按新线路重建");
  }
  const { normalizedPackages, normalizedItems } = validateItemsPayload(body, boxKnown, fields);
  const remark = str(body.remark) || null;

  const { data: rpcResult, error: rpcErr } = await admin.rpc("ship_update_forwarding_order", {
    _partner_key: partnerKey,
    _domestic_number: domesticNumber,
    _warehouse_code: warehouseCode,
    _note: remark,
    _recipient: recipient,
    _destination: destination,
    _box_known: boxKnown,
    _packages: normalizedPackages.map((p) => ({
      client_package_id: p.clientPackageId,
      items: p.items.map((it) => ({ name: it.name, quantity: it.quantity, unit_price_cad: it.unit_price_cad })),
    })),
    _items: normalizedItems.map((it) => ({ name: it.name, quantity: it.quantity, unit_price_cad: it.unit_price_cad, extras: it.extras })),
  });
  if (rpcErr) {
    const code = (rpcErr as any).code as string | undefined;
    if (code === "PT404") throw new ShipApiError("ORDER_NOT_FOUND", "运单不存在");
    if (code === "PT409") throw new ShipApiError("ORDER_LOCKED", "订单已锁定，无法修改");
    if (code === "PT422") throw new ShipApiError("VALIDATION_FAILED", rpcErr.message ?? "请求校验失败");
    throw rpcErr;
  }

  const updated = await assembleOrderResponse(admin, order, { includeFees: false });
  return {
    status: 200,
    data: {
      ...updated,
      removedWaybillNumbers: rpcResult.removed_waybill_numbers ?? [],
      reprintRequired: true,
    },
  };
}

export async function deleteShipOrder(
  admin: any,
  partnerKey: string,
  domesticNumber: string,
  ifMatch: string,
): Promise<{ status: number; data: any }> {
  const order = await resolvePartnerOrder(admin, partnerKey, domesticNumber);
  const current = await assembleOrderResponse(admin, order, { includeFees: false });
  if (current.editToken !== ifMatch) {
    throw new ShipApiError("VERSION_CONFLICT", "editToken 已过期，请重新查询后再提交");
  }
  if (!current.deletable) {
    throw new ShipApiError("ORDER_LOCKED", current.lockReason ?? "订单已锁定，无法删除");
  }

  const { data: rpcResult, error: rpcErr } = await admin.rpc("ship_delete_forwarding_order", {
    _partner_key: partnerKey,
    _domestic_number: domesticNumber,
  });
  if (rpcErr) {
    const code = (rpcErr as any).code as string | undefined;
    if (code === "PT404") throw new ShipApiError("ORDER_NOT_FOUND", "运单不存在");
    if (code === "PT409") throw new ShipApiError("ORDER_LOCKED", "订单已锁定，无法删除");
    throw rpcErr;
  }

  return {
    status: 200,
    data: {
      domesticNumber,
      deleted: true,
      removedWaybillNumbers: rpcResult.removed_waybill_numbers ?? [],
    },
  };
}
