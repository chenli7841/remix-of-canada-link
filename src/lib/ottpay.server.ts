// OTT Pay integration helpers (server-only).
// Docs: https://apidocs.ottpay.com/api/
import crypto from "crypto";

export type OttChannel = "wechat" | "alipay" | "card";

export function ottConfig() {
  const appId = process.env["OTTPAY_APP_ID"]?.trim();
  const appKey = process.env["OTTPAY_APP_KEY"]?.trim();
  if (!appId || !appKey) throw new Error("OTT Pay 未配置（缺少 OTTPAY_APP_ID / OTTPAY_APP_KEY）");
  return {
    appId,
    appKey,
    signKey: process.env["OTTPAY_SIGN_KEY"] ?? "",
    baseUrl: (process.env["OTTPAY_BASE_URL"] ?? "https://ecom-api.ottpay.com").replace(/\/+$/, ""),
    // Public origin used for callback / return URLs (must be reachable by OTT Pay)
    origin: (process.env["OTTPAY_PUBLIC_ORIGIN"] ?? "https://shopper.epluscanada.com").replace(/\/+$/, ""),
  };
}

let _token: { value: string; expired: number } | null = null;

export async function ottToken(): Promise<string> {
  const cfg = ottConfig();
  if (_token && _token.expired - 60_000 > Date.now()) return _token.value;
  const res = await fetch(`${cfg.baseUrl}/api/v1/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId: cfg.appId, appKey: cfg.appKey }),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.status !== "SUCCESS" || !json?.result?.token) {
    // OTT errors are nested under result, not top-level message/msg.
    // Only expose a numeric code and our own explanation, never raw responses or credentials.
    const rawCode = json?.result?.code ?? json?.code;
    const code = /^\d{4,6}$/.test(String(rawCode)) ? String(rawCode) : "unknown";
    const reasons: Record<string, string> = {
      "10003": "App ID 与 App Key 未通过 OTT 校验，请管理员核对 Lovable 中的支付凭证",
      "10005": "OTT 授权参数格式不正确，请管理员检查支付配置",
      "20004": "OTT 服务端数据库错误，请稍后重试",
    };
    const reason = reasons[code] ?? "OTT 未返回有效授权，请管理员检查支付配置或联系 OTT";
    console.error("[ottpay] authorization failed", { httpStatus: res.status, code });
    throw new Error(`OTT Pay 授权失败（HTTP ${res.status}，代码 ${code}）：${reason}`);
  }
  _token = { value: json.result.token as string, expired: Number(json.result.expired ?? Date.now() + 600_000) };
  return _token.value;
}

export async function ottPost<T = any>(path: string, body: unknown): Promise<T> {
  const cfg = ottConfig();
  const token = await ottToken();
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => null);
  if (!res.ok || json?.status !== "SUCCESS") {
    throw new Error(`OTT Pay 请求失败 (${path}): ${json?.message ?? json?.msg ?? json?.code ?? res.status}`);
  }
  return json.result as T;
}

/** CAD dollars -> cents string, per OTT Pay ("100" = $1.00) */
export function toCents(amountCad: number): string {
  return String(Math.round(amountCad * 100));
}

/**
 * Decrypt an OTT Pay webhook payload.
 * key = uppercase 16-char md5(md5String + signKey); data = base64 -> AES-128-ECB.
 */
export function decryptOttCallback(payload: { data: string; md5: string }): Record<string, any> {
  const cfg = ottConfig();
  if (!cfg.signKey) throw new Error("缺少 OTTPAY_SIGN_KEY，无法校验回调");
  const full = crypto
    .createHash("md5")
    .update(payload.md5 + cfg.signKey, "utf8")
    .digest("hex")
    .toUpperCase();
  const key = full.slice(8, 24); // 16-bit md5 == middle 16 chars of the 32-char digest
  const decipher = crypto.createDecipheriv("aes-128-ecb", Buffer.from(key, "utf8"), Buffer.alloc(0));
  decipher.setAutoPadding(true);
  const out = Buffer.concat([decipher.update(Buffer.from(payload.data, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(out);
}

/**
 * Recompute the callback md5 (sort keys asc, concat values, MD5, upper-case)
 * and check it against the client-supplied `payload.md5`. The AES key is
 * derived from that supplied md5, so this is what actually pins the plaintext
 * body to something signed with OTTPAY_SIGN_KEY. Returns true on match.
 *
 * NOTE: if legitimate wallet callbacks start failing signature check, OTT Pay
 * may sign a different field set — loosen in the caller, not here.
 */
export function ottCallbackMd5Matches(suppliedMd5: string, decrypted: Record<string, unknown>): boolean {
  const flat: Record<string, string> = {};
  for (const k of Object.keys(decrypted)) {
    const v = decrypted[k];
    flat[k] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  const recomputed = crypto
    .createHash("md5")
    .update(
      Object.keys(flat)
        .sort()
        .map((k) => flat[k])
        .join(""),
      "utf8",
    )
    .digest("hex")
    .toUpperCase();
  return String(suppliedMd5).toUpperCase() === recomputed;
}

// Authorization alone has not captured funds and must never credit a wallet.
export const OTT_SUCCESS_STATES = new Set(["success", "captured"]);

// Only explicit terminal failures may close a pending recharge.
export const OTT_FAILED_STATES = new Set(["failure", "orderclosed"]);
