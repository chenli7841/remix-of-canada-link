/**
 * 微信客服 GPT 通道的结构化会话记忆（保存在本项目数据库，不依赖 OpenAI）。
 * 不记录客户完整消息内容。
 */

export type CreateOrderDraft = {
  domestic_tracking_no?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  unit_price?: number | null;
  route_id?: string | null;
  route_name?: string | null;
  awaiting_confirmation?: boolean;
};

export type GptSession = {
  external_userid: string;
  open_kfid: string;
  last_tracking_number: string | null;
  current_intent: string | null;
  pending_action: string | null;
  create_order_draft: CreateOrderDraft;
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function loadSession(openKfid: string, externalUserid: string): Promise<GptSession> {
  const admin = await db();
  const { data } = await admin
    .from("wechat_gpt_session")
    .select("open_kfid, external_userid, last_tracking_number, current_intent, pending_action, create_order_draft")
    .eq("open_kfid", openKfid)
    .eq("external_userid", externalUserid)
    .maybeSingle();
  return {
    open_kfid: openKfid,
    external_userid: externalUserid,
    last_tracking_number: (data as any)?.last_tracking_number ?? null,
    current_intent: (data as any)?.current_intent ?? null,
    pending_action: (data as any)?.pending_action ?? null,
    create_order_draft: ((data as any)?.create_order_draft as CreateOrderDraft) ?? {},
  };
}

export async function saveSession(patch: Partial<GptSession> & { open_kfid: string; external_userid: string }) {
  const admin = await db();
  const row: Record<string, unknown> = {
    open_kfid: patch.open_kfid,
    external_userid: patch.external_userid,
    updated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  };
  if (patch.last_tracking_number !== undefined) row["last_tracking_number"] = patch.last_tracking_number;
  if (patch.current_intent !== undefined) row["current_intent"] = patch.current_intent;
  if (patch.pending_action !== undefined) row["pending_action"] = patch.pending_action;
  if (patch.create_order_draft !== undefined) row["create_order_draft"] = patch.create_order_draft;
  await admin.from("wechat_gpt_session").upsert(row as never, { onConflict: "open_kfid,external_userid" });
}
