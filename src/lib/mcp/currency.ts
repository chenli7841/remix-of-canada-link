export const DEFAULT_CNY_TO_CAD_RATE = 0.19;

export function cnyToCad(value: unknown, rate: unknown = DEFAULT_CNY_TO_CAD_RATE) {
  const safeValue = Number(value ?? 0);
  const safeRate = Number(rate ?? DEFAULT_CNY_TO_CAD_RATE);
  return +(safeValue * (Number.isFinite(safeRate) && safeRate > 0 ? safeRate : DEFAULT_CNY_TO_CAD_RATE)).toFixed(2);
}

export function forwardingTotalCad(feeCny: unknown, freightSnapshot: unknown) {
  const snapshot = ((freightSnapshot ?? {}) as Record<string, unknown>);
  const componentTotal =
    Number(snapshot.freight_cad ?? 0) +
    Number(snapshot.duty_cad ?? 0) +
    Number(snapshot.insurance_cad ?? 0) +
    Number(snapshot.surcharges_cad ?? 0);
  const authoritativeTotal = Number(snapshot.total_cad ?? componentTotal);
  return authoritativeTotal > 0 ? +authoritativeTotal.toFixed(2) : cnyToCad(feeCny, snapshot.fx_rate);
}
