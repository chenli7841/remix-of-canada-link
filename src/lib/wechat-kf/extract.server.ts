/**
 * 图片字段提取：条码 + OCR 并行，必要时视觉模型兜底。
 * 输出统一结构；不记录图片、完整 OCR 文本或客户资料。
 */
import { decodeBarcodes } from "./barcode.server";
import { runOcr } from "./ocr.server";

export type TrackingCandidate = {
  value: string;
  type: "fw_tracking_no" | "domestic_tracking_no" | "waybill_no" | "intl_tracking_no" | "mark_no" | "unknown";
  confidence: number;
  source: "barcode" | "ocr" | "vision";
};

export type ExtractResult = {
  tracking_candidates: TrackingCandidate[];
  fw_tracking_no: string | null;
  domestic_tracking_no: string | null;
  item_name: string | null;
  quantity: number | null;
  unit_price: number | null;
  currency: string;
  confidence: number;
  missing_fields: string[];
};

/** 保留字母数字，去除空格、横线与常见标点 */
export function normalizeNo(raw: string): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function classifyNo(v: string): TrackingCandidate["type"] {
  if (/^FW\d{4,}$/.test(v)) return "fw_tracking_no";
  if (/^SC\d{4,}$/.test(v)) return "fw_tracking_no";
  if (/^[A-Z]{2}\d{9}[A-Z]{2}$/.test(v)) return "intl_tracking_no";
  if (/^SF\d{10,15}$/.test(v)) return "domestic_tracking_no";
  if (/^\d{10,20}$/.test(v)) return "domestic_tracking_no";
  if (/^[A-Z]{2,6}\d{4,}[A-Z]{0,4}$/.test(v)) return "waybill_no";
  if (/^[A-Z0-9]{4,12}$/.test(v)) return "mark_no";
  return "unknown";
}

function pushCandidate(list: TrackingCandidate[], value: string, confidence: number, source: TrackingCandidate["source"]) {
  const v = normalizeNo(value);
  if (v.length < 6 || v.length > 32) return;
  const type = classifyNo(v);
  if (type === "unknown") return;
  const existing = list.find((c) => c.value === v);
  if (existing) {
    if (confidence > existing.confidence) {
      existing.confidence = confidence;
      existing.source = source;
    }
    return;
  }
  list.push({ value: v, type, confidence, source });
}

const NUM = "[0-9０-９]";

function parseOrderFields(text: string) {
  const t = text.replace(/[：:]/g, ":").replace(/[，,]/g, ",");
  const nameMatch =
    t.match(/(?:品名|商品名称|名称|货名|商品)\s*:?\s*([^\n]{1,30})/) ??
    t.match(/^([\u4e00-\u9fa5A-Za-z][^\n]{1,20})$/m);
  const qtyMatch = t.match(new RegExp(`(?:数量|件数|共|x|X|×)\\s*:?\\s*(${NUM}{1,4})`));
  const priceMatch =
    t.match(new RegExp(`(?:单价|价格|金额|实付|合计)\\s*:?\\s*[¥￥$]?\\s*(${NUM}+(?:\\.${NUM}{1,2})?)`)) ??
    t.match(new RegExp(`[¥￥]\\s*(${NUM}+(?:\\.${NUM}{1,2})?)`));

  const toNum = (s?: string) => {
    if (!s) return null;
    const n = Number(String(s).replace(/[０-９]/g, (d) => String("０１２３４５６７８９".indexOf(d))));
    return Number.isFinite(n) ? n : null;
  };

  return {
    item_name: nameMatch ? nameMatch[1].trim().slice(0, 30) : null,
    quantity: toNum(qtyMatch?.[1]),
    unit_price: toNum(priceMatch?.[1]),
  };
}

/** 复杂订单截图兜底：视觉模型只提取结构化字段，单号仍以条码/OCR 为准 */
async function visionFallback(bytes: Uint8Array, contentType: string) {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) return null;
  try {
    const dataUrl = `data:${contentType.includes("image") ? contentType : "image/jpeg"};base64,${Buffer.from(bytes).toString("base64")}`;
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-3.7-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  '从图片中提取订单信息，只输出JSON：{"item_name":string|null,"quantity":number|null,"unit_price":number|null,"currency":"CNY"}。不要猜测单号。',
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error(`[wechat-kf] vision_fallback_status=${res.status}`);
      return null;
    }
    const json: any = await res.json();
    const raw = json?.choices?.[0]?.message?.content ?? "";
    const m = String(raw).match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

export async function extractFromImage(bytes: Uint8Array, contentType: string): Promise<ExtractResult> {
  // 条码与 OCR 并行
  const [barcodes, ocr] = await Promise.all([
    decodeBarcodes(bytes, contentType),
    runOcr(bytes).catch((e) => {
      console.error(`[wechat-kf] ocr_failed ${(e as Error)?.message ?? "unknown"}`);
      return null;
    }),
  ]);

  const candidates: TrackingCandidate[] = [];
  for (const b of barcodes) pushCandidate(candidates, b.value, 0.98, "barcode");

  let fields: { item_name: string | null; quantity: number | null; unit_price: number | null } = {
    item_name: null,
    quantity: null,
    unit_price: null,
  };

  if (ocr) {
    for (const w of ocr.words) {
      for (const token of w.text.split(/\s+/)) {
        pushCandidate(candidates, token, Math.max(w.confidence * 0.95, 0.5), "ocr");
      }
      pushCandidate(candidates, w.text, Math.max(w.confidence * 0.9, 0.5), "ocr");
    }
    fields = parseOrderFields(ocr.text);
  }

  // 只有结构化失败（订单截图类）才调用视觉模型
  if (!fields.item_name && !fields.unit_price) {
    const vision = await visionFallback(bytes, contentType);
    if (vision) {
      fields = {
        item_name: vision.item_name ?? null,
        quantity: Number.isFinite(Number(vision.quantity)) ? Number(vision.quantity) : null,
        unit_price: Number.isFinite(Number(vision.unit_price)) ? Number(vision.unit_price) : null,
      };
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const fw = candidates.find((c) => c.type === "fw_tracking_no") ?? null;
  const domestic = candidates.find((c) => c.type === "domestic_tracking_no") ?? null;

  const missing: string[] = [];
  if (!domestic && !fw) missing.push("domestic_tracking_no");
  if (!fields.item_name) missing.push("item_name");
  if (fields.quantity == null) missing.push("quantity");
  if (fields.unit_price == null) missing.push("unit_price");

  return {
    tracking_candidates: candidates.slice(0, 5),
    fw_tracking_no: fw?.value ?? null,
    domestic_tracking_no: domestic?.value ?? null,
    item_name: fields.item_name,
    quantity: fields.quantity,
    unit_price: fields.unit_price,
    currency: "CNY",
    confidence: candidates[0]?.confidence ?? 0,
    missing_fields: missing,
  };
}

/** 同一图片 10 分钟内复用识别结果 */
export async function extractWithCache(bytes: Uint8Array, contentType: string): Promise<ExtractResult> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const sha = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: cached } = await supabaseAdmin.rpc("wechat_kf_image_cache_get", { _sha256: sha });
  if (cached) return cached as unknown as ExtractResult;

  const result = await extractFromImage(bytes, contentType);
  await supabaseAdmin.from("wechat_kf_image_cache").upsert({
    sha256: sha,
    result: result as unknown as never,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  return result;
}
