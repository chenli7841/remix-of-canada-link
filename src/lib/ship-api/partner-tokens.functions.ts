// 合作方 API 凭证管理——仅 owner 可用。原本（system-change-guide-v3.md 第 8 节）
// "不要求先开发凭证管理页面"，只提供函数；现在按
// docs/ship-api/claude-api-token-admin-page.md 补齐运行时校验、ship 范围限定和
// 撤销幂等，给 /admin/api-tokens 页面直接调用。
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generatePartnerApiToken, getShipApiPublicOrigin, sha256Hex, SHIP_API_SCOPES, type ShipApiScope } from "./auth.server";

// 这里的 "owner" 是员工角色（has_role RPC），跟 profiles.vip_level 新增的 'owner' 客户
// 分级值是两回事，字面撞名但完全独立，见 auth.server.ts 顶部注释。
async function assertOwnerRole(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "owner" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: owner only");
}

// 目前只有 ship 一个合作方。服务端固定白名单而不是信前端传什么就存什么——
// 以后真的要接第二个合作方，往这个数组加一项就行，不用动下面的校验逻辑。
const ALLOWED_PARTNER_KEYS = ["ship"] as const;
function validatePartnerKey(raw: string): string {
  const key = raw.trim();
  if (!(ALLOWED_PARTNER_KEYS as readonly string[]).includes(key)) {
    throw new Error(`未知合作方：${key || "(空)"}`);
  }
  return key;
}

function validateScopes(scopes: string[]): ShipApiScope[] {
  const deduped = Array.from(new Set((scopes ?? []).map((s) => String(s).trim()).filter(Boolean)));
  const bad = deduped.filter((s) => !SHIP_API_SCOPES.includes(s as ShipApiScope));
  if (bad.length) throw new Error(`未知 scope：${bad.join(", ")}`);
  if (deduped.length === 0) throw new Error("至少要给一个 scope");
  // 勾了费用权限必须同时有查询权限——前端会自动帮着勾上并解释，这里是最终防线。
  if (deduped.includes("orders:fees:read") && !deduped.includes("orders:read")) {
    throw new Error("查看费用权限（orders:fees:read）必须同时具备查询运单权限（orders:read）");
  }
  return deduped as ShipApiScope[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 生成一个新凭证。明文 token 只在这次响应里返回一次，之后无法再次查看——数据库只存哈希。
export const issuePartnerApiToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { partnerKey: string; name: string; scopes: string[] }) => d)
  .handler(async ({ data, context }) => {
    await assertOwnerRole(context.supabase, context.userId);
    const partnerKey = validatePartnerKey(data.partnerKey ?? "");
    const name = (data.name ?? "").trim();
    if (!name) throw new Error("凭证名称不能为空");
    if (name.length > 100) throw new Error("凭证名称最长 100 字");
    const scopes = validateScopes(data.scopes ?? []);

    const token = generatePartnerApiToken();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ins, error } = await (supabaseAdmin as any)
      .from("partner_api_tokens")
      .insert({
        partner_key: partnerKey,
        name,
        token_hash: sha256Hex(token),
        scopes,
        created_by: context.userId,
      })
      .select("id, partner_key, name, scopes, created_at")
      .single();
    if (error) throw new Error(error.message);

    return { ok: true, token, record: ins };
  });

export const listPartnerApiTokens = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { partnerKey?: string } = {}) => d)
  .handler(async ({ data, context }) => {
    await assertOwnerRole(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let q = (supabaseAdmin as any)
      .from("partner_api_tokens")
      // 明文/哈希都不返回——列表页只需要知道有哪些凭证、状态如何，不需要（也不该）拿到能拿去用的东西。
      .select("id, partner_key, name, scopes, is_active, created_at, revoked_at, revoked_by, created_by, last_used_at")
      .order("created_at", { ascending: false });
    if (data.partnerKey) q = q.eq("partner_key", validatePartnerKey(data.partnerKey));
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return { items: rows ?? [] };
  });

// 撤销：验证 UUID 格式 → 查到具体这条记录（顺带校验属于 partnerKey，若传了的话）→
// 不存在给明确错误；已经撤销过的再撤一次算成功但不覆盖首次撤销时间/操作者
// （幂等，不是"每次都当新撤销处理"）。
export const revokePartnerApiToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; partnerKey?: string }) => d)
  .handler(async ({ data, context }) => {
    await assertOwnerRole(context.supabase, context.userId);
    const id = (data.id ?? "").trim();
    if (!UUID_RE.test(id)) throw new Error("凭证 ID 格式不正确");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error: selErr } = await (supabaseAdmin as any)
      .from("partner_api_tokens")
      .select("id, partner_key, is_active, revoked_at")
      .eq("id", id)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (!row) throw new Error("凭证不存在");
    if (data.partnerKey && row.partner_key !== validatePartnerKey(data.partnerKey)) {
      throw new Error("凭证不存在");
    }
    if (row.revoked_at) {
      // 已撤销：幂等成功，不重写 revoked_at/revoked_by。
      return { ok: true, already_revoked: true };
    }
    const { error: updErr } = await (supabaseAdmin as any)
      .from("partner_api_tokens")
      .update({ is_active: false, revoked_at: new Date().toISOString(), revoked_by: context.userId })
      .eq("id", id);
    if (updErr) throw new Error(updErr.message);
    return { ok: true, already_revoked: false };
  });

// 页面顶部展示当前配置好的 API 根地址；没配就是没配，不猜一个出来。
export const getShipApiAdminConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwnerRole(context.supabase, context.userId);
    const origin = getShipApiPublicOrigin();
    return { apiBaseUrl: origin ? `${origin}/api/partners/v1` : null };
  });
