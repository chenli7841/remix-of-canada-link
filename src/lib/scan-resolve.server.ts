import { normalizeScanCode } from "./scan-normalize";

/** 把扫描内容还原成数据库里实际存的单号（先精确，再按字母数字容错）；找不到时返回整理后的号码。 */
export async function resolveScanInput(db: any, raw: unknown): Promise<string> {
  const n = normalizeScanCode(raw);
  if (!n) return "";
  try {
    const { data, error } = await db.rpc("resolve_scan_code", { _input: n });
    if (!error && typeof data === "string" && data) return data;
  } catch {
    /* fall back to the normalized code */
  }
  return n;
}
