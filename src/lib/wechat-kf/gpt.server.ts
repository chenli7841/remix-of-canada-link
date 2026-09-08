/**
 * 微信客服 GPT 回复（服务端）。
 * 只返回文本与 HTTP 状态码，绝不记录消息正文或密钥。
 */
import { callOpenAiResponses, openAiConfigured } from "@/lib/openai.server";

export const GPT_FALLBACK_TEXT =
  "抱歉，系统暂时繁忙，请稍后重试；如问题紧急，可转人工客服。";

const SYSTEM_PROMPT =
  "你是 EPLUS 壹嘉国际物流的中文在线客服。用简体中文回答，语气礼貌简洁，控制在 120 字以内。" +
  "涉及运单查询或创建运单时，提示客户使用菜单中的“查询运单”“创建运单”。不要编造运单号、价格或时效。";

/** 抽取 Responses API 的纯文本输出 */
function outputText(body: any): string {
  if (typeof body?.output_text === "string" && body.output_text.trim()) return body.output_text.trim();
  const parts: string[] = [];
  for (const item of body?.output ?? []) {
    for (const c of item?.content ?? []) {
      if (typeof c?.text === "string") parts.push(c.text);
    }
  }
  return parts.join("").trim();
}

export async function gptReply(
  userText: string,
): Promise<{ text: string; status: number | null; ok: boolean; err?: string; ms: number }> {
  const t0 = Date.now();
  if (!openAiConfigured()) return { text: GPT_FALLBACK_TEXT, status: null, ok: false, err: "not_configured", ms: 0 };
  try {
    const { status, body } = await callOpenAiResponses(`${SYSTEM_PROMPT}\n\n客户消息：${userText}`, {
      timeoutMs: 8000,
    });
    if (status < 200 || status >= 300)
      return { text: GPT_FALLBACK_TEXT, status, ok: false, err: "http_error", ms: Date.now() - t0 };
    const text = outputText(body);
    if (!text) return { text: GPT_FALLBACK_TEXT, status, ok: false, err: "empty_output", ms: Date.now() - t0 };
    return { text: text.slice(0, 600), status, ok: true, ms: Date.now() - t0 };
  } catch (e) {
    const err = (e as Error)?.name === "AbortError" ? "timeout" : "network_error";
    return { text: GPT_FALLBACK_TEXT, status: null, ok: false, err, ms: Date.now() - t0 };
  }
}
