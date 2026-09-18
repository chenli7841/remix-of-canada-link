// OTT Pay "Elavon Converge Hosted Payment" (credit card) integration — server only.
// Flow: POST encrypted request to frontapi -> receive codeUrl (Converge hosted page)
// -> redirect cardholder -> Converge posts result to OTT Pay -> OTT Pay calls our backUrl.
import crypto from "crypto";

export function hostedConfig() {
  const merchantId =
    process.env["OTTPAY_MERCHANT_ID"] ?? process.env["OTTPAY_MERCHANT_NO"] ?? process.env["OTTPAY_APP_ID"];

  const signKey = process.env["OTTPAY_SIGN_KEY"];
  if (!merchantId || !signKey) {
    throw new Error("信用卡支付未配置（缺少 OTTPAY_MERCHANT_ID / OTTPAY_SIGN_KEY）");
  }
  return {
    merchantId,
    signKey,
    operatorId: process.env["OTTPAY_OPERATOR_ID"] ?? merchantId,
    baseUrl: (process.env["OTTPAY_FRONT_URL"] ?? "https://frontapi.ottpay.com:443/processV3").replace(/\/+$/, ""),
    origin: (process.env["OTTPAY_PUBLIC_ORIGIN"] ?? "https://shopper.epluscanada.com").replace(/\/+$/, ""),
  };
}

/** Step 1: sort keys alphabetically, concatenate the values only. */
function joinSorted(data: Record<string, string>): string {
  return Object.keys(data)
    .sort()
    .map((k) => data[k] ?? "")
    .join("");
}

function md5Upper(s: string) {
  return crypto.createHash("md5").update(s, "utf8").digest("hex").toUpperCase();
}

/** 16-bit MD5 == middle 16 chars of the 32-char digest. */
function aesKeyFrom(md5Value: string, signKey: string) {
  return md5Upper(md5Value + signKey).slice(8, 24);
}

export function encryptHosted(data: Record<string, string>): { data: string; md5: string } {
  const cfg = hostedConfig();
  const raw = JSON.stringify(data);
  const md5 = md5Upper(joinSorted(data));
  const key = aesKeyFrom(md5, cfg.signKey);
  const cipher = crypto.createCipheriv("aes-128-ecb", Buffer.from(key, "utf8"), null);
  cipher.setAutoPadding(true);
  const out = Buffer.concat([cipher.update(Buffer.from(raw, "utf8")), cipher.final()]).toString("base64");
  return { data: out, md5 };
}

export function decryptHosted(payload: { data: string; md5: string }): Record<string, any> {
  const cfg = hostedConfig();
  const key = aesKeyFrom(String(payload.md5), cfg.signKey);
  const decipher = crypto.createDecipheriv("aes-128-ecb", Buffer.from(key, "utf8"), Buffer.alloc(0));
  decipher.setAutoPadding(true);
  const out = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(out);
}

/**
 * Recompute the payload md5 exactly the way encryptHosted signs outbound
 * requests (sort keys asc, concat values, MD5, upper-case). The inbound
 * callback derives its AES key from the *client-supplied* `payload.md5`, so
 * without this check a captured genuine `(data, md5)` pair could be replayed
 * with the plaintext envelope tampered. Returns true when the supplied md5
 * matches the decrypted body.
 *
 * NOTE: if legitimate card callbacks ever start returning 401 "invalid
 * signature", this is the first suspect — OTT Pay may sign a different field
 * set. Loosening back to accept-and-log is a one-line change in the caller.
 */
export function hostedMd5Matches(suppliedMd5: string, decrypted: Record<string, unknown>): boolean {
  const flat: Record<string, string> = {};
  for (const k of Object.keys(decrypted)) {
    const v = decrypted[k];
    flat[k] = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return String(suppliedMd5).toUpperCase() === md5Upper(joinSorted(flat));
}

/** yyyyMMddHHmmss in UTC — must not depend on the host's local timezone,
 * or a non-UTC deploy sends a stale/future timestamp and the gateway rejects it. */
export function txnTime(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

export async function hostedPost(action: string, version: string, data: Record<string, string>): Promise<any> {
  const cfg = hostedConfig();
  const enc = encryptHosted(data);
  const res = await fetch(cfg.baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, version, merchant_id: cfg.merchantId, data: enc.data, md5: enc.md5 }),
  });
  const json: any = await res.json().catch(() => null);
  const code = String(json?.rsp_code ?? "");
  if (!res.ok || !["SUCCESS", "PROCESSING"].includes(code)) {
    throw new Error(`OTT Pay 信用卡请求失败 (${action}): ${json?.rsp_msg ?? code ?? res.status}`);
  }
  const result = json?.data ? decryptHosted({ data: String(json.data), md5: String(json.md5) }) : {};
  return { rsp_code: code, rsp_msg: json?.rsp_msg, ...result };
}

export const HOSTED_PAID_STATES = new Set(["success", "paid", "trade_success", "captured", "authorised", "authorized"]);
export const HOSTED_FAILED_STATES = new Set(["fail", "failure", "closed", "orderclosed", "cancelled", "canceled", "revoked"]);
