/**
 * 微信客服回调去重（持久化，跨 Worker 实例有效）。
 * 指纹 = SHA-256(完整 query + "\n" + raw body)，记录保存在数据库，10 分钟过期。
 */

export async function callbackFingerprint(search: string, body: ArrayBuffer): Promise<string> {
  const prefix = new TextEncoder().encode(`${search}\n`);
  const bodyBytes = new Uint8Array(body);
  const buf = new Uint8Array(prefix.length + bodyBytes.length);
  buf.set(prefix, 0);
  buf.set(bodyBytes, prefix.length);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * 返回 true 表示本次是首次到达（应转发），false 表示重复（不再转发）。
 * 出错时保守返回 true，避免漏转发。
 */
export async function claimCallback(hash: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("wechat_callback_claim", { _hash: hash });
    if (error) {
      console.error(`[adp-callback] dedup_store_error hash=${hash.slice(0, 8)} code=${error.code ?? "unknown"}`);
      return true;
    }
    return data !== false;
  } catch {
    console.error(`[adp-callback] dedup_store_unavailable hash=${hash.slice(0, 8)}`);
    return true;
  }
}
