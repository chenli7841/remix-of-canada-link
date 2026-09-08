/**
 * 服务端专用 OpenAI 客户端。
 *
 * Cloudflare Worker 出口被 OpenAI 拒绝（HTTP 403），因此 Worker 不再直连
 * api.openai.com，而是通过本项目 Supabase 后端的安全中转（数据库侧
 * SECURITY DEFINER 函数 public.openai_responses_proxy）调用 Responses API。
 *
 * - OPENAI_API_KEY 只保存在 Supabase 内部私有配置中，不下发到 Worker 请求；
 * - 内部鉴权使用 OPENAI_PROXY_TOKEN；
 * - 中转失败不会回退到 Worker 直连；
 * - 日志/返回值均不含密钥、正文或内部 Token。
 */

export const OPENAI_DEFAULT_MODEL = "gpt-5.6-luna";
const DEFAULT_TIMEOUT_MS = 14000;
const MAX_OUTPUT_TOKENS = 300;

export type OpenAiPingResult = {
  ok: boolean;
  status: number | null;
  duration_ms: number;
  error?: string;
};

function proxyUrl(): string | null {
  const explicit = process.env["OPENAI_PROXY_URL"];
  if (explicit) return explicit;
  const base = process.env["SUPABASE_URL"];
  return base ? `${base.replace(/\/+$/, "")}/rest/v1/rpc/openai_responses_proxy` : null;
}

function proxyAuth(): { token: string; serviceKey: string } | null {
  const token = process.env["OPENAI_PROXY_TOKEN"];
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!token || !serviceKey) return null;
  return { token, serviceKey };
}

export function openAiConfigured(): boolean {
  return Boolean(proxyUrl() && proxyAuth());
}

/**
 * 原始 Responses API 调用（支持 function tools / 多轮 input）。
 * 只返回 HTTP 状态、响应体与耗时；不记录任何密钥。
 */
export async function callOpenAiRaw(
  payload: Record<string, unknown>,
  opts?: { timeoutMs?: number },
): Promise<{ status: number | null; body: any; ms: number; err?: string }> {
  const t0 = Date.now();
  const url = proxyUrl();
  const auth = proxyAuth();
  if (!url || !auth) return { status: null, body: null, ms: 0, err: "not_configured" };

  const maxTokens = Number(payload["max_output_tokens"]);
  const forwarded: Record<string, unknown> = {
    ...payload,
    model: OPENAI_DEFAULT_MODEL,
    max_output_tokens:
      Number.isFinite(maxTokens) && maxTokens > 0 ? Math.min(maxTokens, MAX_OUTPUT_TOKENS) : MAX_OUTPUT_TOKENS,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: auth.serviceKey,
        Authorization: `Bearer ${auth.serviceKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({ _token: auth.token, _payload: forwarded }),
    });

    if (res.status < 200 || res.status >= 300) {
      return { status: res.status, body: null, ms: Date.now() - t0, err: "proxy_error" };
    }

    let envelope: any = null;
    try {
      envelope = await res.json();
    } catch {
      envelope = null;
    }
    const status: number | null = typeof envelope?.status === "number" ? envelope.status : null;
    const body = envelope?.body ?? null;
    if (status === null) return { status: null, body: null, ms: Date.now() - t0, err: "proxy_error" };
    const ok = status >= 200 && status < 300;
    return { status, body, ms: Date.now() - t0, ...(ok ? {} : { err: "http_error" }) };
  } catch (e) {
    const err = (e as Error)?.name === "AbortError" ? "timeout" : "network_error";
    return { status: null, body: null, ms: Date.now() - t0, err };
  } finally {
    clearTimeout(timer);
  }
}

/** 通用 Responses API 调用（服务端，经安全中转） */
export async function callOpenAiResponses(
  input: string,
  opts?: { maxOutputTokens?: number; timeoutMs?: number },
): Promise<{ status: number; body: unknown }> {
  const res = await callOpenAiRaw(
    { input, max_output_tokens: opts?.maxOutputTokens ?? 250 },
    { timeoutMs: opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS },
  );
  if (res.status === null) throw new Error(res.err ?? "proxy_error");
  return { status: res.status, body: res.body };
}

/** 连通性测试：只返回成功/失败、HTTP 状态码与耗时，不含任何密钥或模型输出。 */
export async function pingOpenAi(): Promise<OpenAiPingResult> {
  const startedAt = Date.now();
  if (!openAiConfigured()) {
    return { ok: false, status: null, duration_ms: 0, error: "not_configured" };
  }
  const res = await callOpenAiRaw({ input: "ping", max_output_tokens: 20 });
  if (res.status === null) {
    return { ok: false, status: null, duration_ms: Date.now() - startedAt, error: res.err ?? "network_error" };
  }
  return {
    ok: res.status >= 200 && res.status < 300,
    status: res.status,
    duration_ms: Date.now() - startedAt,
    ...(res.err ? { error: res.err } : {}),
  };
}
