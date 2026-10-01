import { ShipApiError } from "./auth.server";

// PostgREST may omit the constraint field, so also recognize the exact message
// emitted by the global domestic-number trigger. Do not mask unrelated 23505s.
export function throwShipCreateError(error: {
  code?: string; message?: string; constraint?: string;
}): never {
  const domesticConflict = error.code === "PT409" || (error.code === "23505" && (
    error.constraint === "domestic_tracking_global_unique" ||
    error.message === "国内单号已被其他订单使用，请核对后重试" ||
    error.message?.includes('"uq_fo_user_domestic_tracking"')
  ));
  if (domesticConflict) {
    throw new ShipApiError("DOMESTIC_NUMBER_CONFLICT",
      "国内单号已被占用或与已有订单内容冲突。请核对原请求；仅可修改本方已有订单，新订单请使用新的国内单号。",
      [{ path: "domesticNumber", message: "国内单号须全局唯一（忽略大小写及首尾空格）" }]);
  }
  if (error.code === "PT404") throw new ShipApiError("ROUTE_NOT_FOUND", "线路不存在");
  if (error.code === "PT422") throw new ShipApiError("VALIDATION_FAILED", error.message ?? "请求校验失败");
  throw error;
}
