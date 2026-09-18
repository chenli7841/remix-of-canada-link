// Idempotency-Key 通用去重层，供所有 ship API 写接口用。见
// docs/ship-api/shipper-api-v3.md 第 11 节、docs/ship-api/system-change-guide-v3.md
// 第 8 节。
//
// 用法：claimIdempotencyKey() 先占位；占位成功（这次请求"拿到执行权"）就去跑业务
// 逻辑，跑完调用 completeIdempotencyKey() 记录最终响应；跑失败调用
// releaseIdempotencyKey() 把占位删掉，让重试能重新尝试（"创建失败不留下半单"）。
// 占位失败分两种：已经 completed（回放存好的响应）、还在 in_progress（另一个并发
// 请求正在处理同一个 key，返回可重试的 503，不阻塞等待）。
import { sha256Hex, ShipApiError } from "./auth.server";

export function computeFingerprint(method: string, path: string, ifMatch: string | null, body: unknown): string {
  return sha256Hex(JSON.stringify({ method, path, ifMatch: ifMatch ?? null, body: body ?? null }));
}

export type IdempotencyClaim =
  | { kind: "own" }
  | { kind: "replay"; status: number; body: unknown };

export async function claimIdempotencyKey(
  admin: any,
  partnerKey: string,
  idempotencyKey: string,
  fingerprint: string,
): Promise<IdempotencyClaim> {
  const { error } = await admin.from("partner_api_idempotency").insert({
    partner_key: partnerKey,
    idempotency_key: idempotencyKey,
    request_fingerprint: fingerprint,
  });
  if (!error) return { kind: "own" };

  if ((error as any).code !== "23505") {
    throw new ShipApiError("INTERNAL_ERROR", "幂等校验失败");
  }

  // 已经有一条记录——同一个 key 之前提交过（或正在提交）。
  const { data: existing, error: fetchErr } = await admin
    .from("partner_api_idempotency")
    .select("request_fingerprint, status, response_status, response_body")
    .eq("partner_key", partnerKey)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (fetchErr || !existing) throw new ShipApiError("INTERNAL_ERROR", "幂等校验失败");

  if (existing.request_fingerprint !== fingerprint) {
    throw new ShipApiError("IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 的请求内容与此前不同，请使用新的 key");
  }
  if (existing.status === "completed") {
    return { kind: "replay", status: existing.response_status ?? 200, body: existing.response_body };
  }
  // 仍在处理中（另一个并发的相同请求正在跑）——不做内部等待/轮询，直接告诉客户端
  // 稍后按原 key、原内容重试，符合契约里"有界退避重试"的建议。
  throw new ShipApiError("TEMPORARILY_UNAVAILABLE", "同一请求正在处理中，请稍后按原 key 重试");
}

export async function completeIdempotencyKey(
  admin: any,
  partnerKey: string,
  idempotencyKey: string,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  await admin
    .from("partner_api_idempotency")
    .update({
      status: "completed",
      response_status: responseStatus,
      response_body: responseBody,
      completed_at: new Date().toISOString(),
    })
    .eq("partner_key", partnerKey)
    .eq("idempotency_key", idempotencyKey);
}

export async function releaseIdempotencyKey(admin: any, partnerKey: string, idempotencyKey: string): Promise<void> {
  await admin
    .from("partner_api_idempotency")
    .delete()
    .eq("partner_key", partnerKey)
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "in_progress");
}
