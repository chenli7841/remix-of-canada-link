/**
 * 微信客服会话状态（每个 external_userid 一条，30 分钟无操作失效）。
 */

export type KfState =
  | "idle"
  | "waiting_tracking_status"
  | "waiting_order_billing"
  | "waiting_order_eta"
  | "waiting_bind_code"
  | "creating_order"
  | "creating_confirm";

export type KfDraft = {
  domestic_tracking_no?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  route_code?: string | null;
  pending_action?: string | null;
  pending_tracking_no?: string | null;
  candidates?: string[];
};

const TTL_MS = 30 * 60 * 1000;

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function getState(externalUserid: string): Promise<{ state: KfState; draft: KfDraft }> {
  const admin = await db();
  const { data } = await admin
    .from("wechat_kf_state")
    .select("state, draft, expires_at")
    .eq("external_userid", externalUserid)
    .maybeSingle();
  if (!data || new Date(data.expires_at).getTime() < Date.now()) return { state: "idle", draft: {} };
  return { state: (data.state as KfState) ?? "idle", draft: (data.draft as KfDraft) ?? {} };
}

export async function setState(
  externalUserid: string,
  state: KfState,
  draft: KfDraft = {},
  openKfid?: string | null,
) {
  const admin = await db();
  await admin.from("wechat_kf_state").upsert({
    external_userid: externalUserid,
    open_kfid: openKfid ?? null,
    state,
    draft: draft as unknown as never,
    expires_at: new Date(Date.now() + TTL_MS).toISOString(),
    updated_at: new Date().toISOString(),
  });
}

export async function mergeDraft(externalUserid: string, patch: KfDraft, state?: KfState, openKfid?: string | null) {
  const current = await getState(externalUserid);
  await setState(externalUserid, state ?? current.state, { ...current.draft, ...patch }, openKfid);
  return { ...current.draft, ...patch };
}

export async function clearState(externalUserid: string) {
  const admin = await db();
  await admin.from("wechat_kf_state").delete().eq("external_userid", externalUserid);
}
