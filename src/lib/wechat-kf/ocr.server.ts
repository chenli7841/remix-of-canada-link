/**
 * 腾讯云 OCR（TC3-HMAC-SHA256 直连签名）。
 * 分级：先高速版 GeneralFastOCR，置信度不足再调高精度版 GeneralAccurateOCR。
 * 不记录完整 OCR 文本、不记录密钥。
 */
import { createHash, createHmac } from "node:crypto";
import { ocrConfig } from "./config.server";

const HOST = "ocr.tencentcloudapi.com";
const SERVICE = "ocr";
const VERSION = "2018-11-19";

function sha256Hex(s: string) {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
function hmac(key: Buffer | string, data: string) {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

async function tc3Request(action: string, payload: unknown, region: string) {
  const { secretId, secretKey } = ocrConfig();
  if (!secretId || !secretKey) throw new Error("ocr_not_configured");

  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${HOST}\n`;
  const signedHeaders = "content-type;host";
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, sha256Hex(body)].join("\n");

  const credentialScope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = ["TC3-HMAC-SHA256", String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`TC3${secretKey}`, date);
  const kService = hmac(kDate, SERVICE);
  const kSigning = hmac(kService, "tc3_request");
  const sig = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const res = await fetch(`https://${HOST}`, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json; charset=utf-8",
      host: HOST,
      "x-tc-action": action,
      "x-tc-timestamp": String(timestamp),
      "x-tc-version": VERSION,
      "x-tc-region": region,
    },
    body,
  });
  const json: any = await res.json();
  if (json?.Response?.Error) throw new Error(`ocr_error_${json.Response.Error.Code}`);
  return json.Response;
}

export type OcrResult = {
  text: string;
  words: Array<{ text: string; confidence: number }>;
  avgConfidence: number;
  engine: "fast" | "accurate";
};

function toResult(resp: any, engine: "fast" | "accurate"): OcrResult {
  const items: any[] = resp?.TextDetections ?? [];
  const words = items.map((d) => ({
    text: String(d?.DetectedText ?? ""),
    confidence: Number(d?.Confidence ?? 0) / 100,
  }));
  const avg = words.length ? words.reduce((s, w) => s + w.confidence, 0) / words.length : 0;
  return { text: words.map((w) => w.text).join("\n"), words, avgConfidence: avg, engine };
}

/** 分级 OCR：高速版优先，置信度低于阈值时升级高精度版 */
export async function runOcr(bytes: Uint8Array, minConfidence = 0.9): Promise<OcrResult> {
  const { region } = ocrConfig();
  const ImageBase64 = Buffer.from(bytes).toString("base64");

  try {
    const fast = toResult(await tc3Request("GeneralFastOCR", { ImageBase64 }, region), "fast");
    if (fast.words.length && fast.avgConfidence >= minConfidence) return fast;
    const accurate = toResult(await tc3Request("GeneralAccurateOCR", { ImageBase64 }, region), "accurate");
    return accurate.words.length ? accurate : fast;
  } catch (e) {
    // 高速版不可用时直接尝试高精度版
    const accurate = toResult(await tc3Request("GeneralAccurateOCR", { ImageBase64 }, region), "accurate");
    return accurate;
  }
}
