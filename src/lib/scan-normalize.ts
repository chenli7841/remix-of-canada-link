// 扫码号容错：扫码枪/手输常带空格、不可见字符、全角字符、小写或各种横杠。
// 统一整理后再查询；数据库侧有同样规则（scan_normalize / scan_key）。
const DASHES = /[\u2010-\u2015\u2212\u30FC\uFF0D]/g;
const INVISIBLE_OR_SPACE = /[\s\u200B-\u200D\u2060\uFEFF]+/g;

/** 去空格/不可见字符、全角转半角、统一大写和横杠，并去掉首尾非字母数字符号。 */
export function normalizeScanCode(raw: unknown): string {
  return String(raw ?? "")
    .normalize("NFKC")
    .replace(DASHES, "-")
    .replace(INVISIBLE_OR_SPACE, "")
    .toUpperCase()
    .replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, "");
}

/** 只保留字母数字，用于容错比对。 */
export function scanKey(raw: unknown): string {
  return normalizeScanCode(raw).replace(/[^A-Z0-9]/g, "");
}

export function sameScanCode(a: unknown, b: unknown): boolean {
  const k = scanKey(a);
  return !!k && k === scanKey(b);
}
