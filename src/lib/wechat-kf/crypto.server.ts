/**
 * 企业微信回调消息签名校验与 AES 解密（本地处理，不经过任何第三方）。
 */
import { createDecipheriv, createHash } from "node:crypto";

export function signature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  const raw = [token, timestamp, nonce, encrypt].sort().join("");
  return createHash("sha1").update(raw).digest("hex");
}

export function verifySignature(
  token: string,
  msgSignature: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): boolean {
  const expected = signature(token, timestamp, nonce, encrypt);
  if (expected.length !== msgSignature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ msgSignature.charCodeAt(i);
  return diff === 0;
}

/** 返回明文 XML/echostr；receiveid 不匹配时抛错 */
export function decryptMessage(aesKey: string, encrypted: string, expectReceiveId: string): string {
  const key = Buffer.from(aesKey + "=", "base64");
  const iv = key.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  decipher.setAutoPadding(false);
  const raw = Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]);

  // 去 PKCS#7 填充
  const pad = raw[raw.length - 1] ?? 0;
  const body = pad > 0 && pad <= 32 ? raw.subarray(0, raw.length - pad) : raw;

  // 16 随机字节 + 4 字节网络序长度 + 明文 + receiveid
  const msgLen = body.readUInt32BE(16);
  const plain = body.subarray(20, 20 + msgLen).toString("utf8");
  const receiveId = body.subarray(20 + msgLen).toString("utf8");
  if (expectReceiveId && receiveId && receiveId !== expectReceiveId) {
    throw new Error("receiveid_mismatch");
  }
  return plain;
}

/** 极简 XML 取值（回调结构固定，不引第三方解析器） */
export function xmlValue(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`)) ??
    xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}
