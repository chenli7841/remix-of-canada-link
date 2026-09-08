// 扫码类型识别：箱号 / 托盘 / 批次 / 运单
// 支持新旧两套编号规则：
// - 箱号: BOX...（旧）/ B+YYYYMMDD...（旧）/ B+线路(2字母)+客户号(5)+MMDD(4)+顺序(3)（新）
// - 托盘: PAL...（旧）/ P+YYYYMMDD...（旧）/ P+线路(2字母)+客户号(5)+MMDD(4)+顺序(3)（新）
// - 批次: BAT...（旧）/ M+方式+目的地+MMDD+顺序(3)（新）
// - 运单: FW/SC/W 前缀及其他（含旧编号，可走 aliases 回退查询）
export type ScanKind = "carton" | "pallet" | "batch" | "waybill";

export function detectScanKind(code: string): ScanKind {
  const c = code.trim().toUpperCase();
  if (!c) return "waybill";
  // 旧前缀
  if (c.startsWith("BOX")) return "carton";
  if (c.startsWith("PAL")) return "pallet";
  if (c.startsWith("BAT")) return "batch";
  // 新/旧单字母前缀
  if (/^B(?:[A-Z]{2}\d{12}|\d{8})/.test(c)) return "carton";
  if (/^P(?:[A-Z]{2}\d{12}|\d{8})/.test(c)) return "pallet";
  if (/^M[A-Z0-9]/.test(c)) return "batch";
  return "waybill";
}

export const SCAN_KIND_LABEL: Record<ScanKind, string> = {
  carton: "箱号",
  pallet: "托盘",
  batch: "批次",
  waybill: "运单",
};
