/**
 * 微信客服 AI 通道的永久业务记录层。
 *
 * 负责：会话、客户消息与 AI 回复、GPT 运行记录、工具调用记录、
 * 录单草稿与草稿字段变更历史。
 *
 * 安全与日志规范：
 * - 绝不写入 Secret / Token / AESKey / OpenAI Key / 回调密文 / OpenAI 隐藏推理内容。
 * - 工具入参与结果只保存脱敏摘要。
 * - 所有写入失败都不得影响客服主流程（静默降级）。
 */
import { createHash } from "node:crypto";

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await fn();
  } catch {
    return fallback;
  }
};

/** 企业标识只保存哈希，不保存明文 corp_id */
export function corpIdHash(corpId?: string | null): string | null {
  const s = String(corpId ?? "").trim();
  if (!s) return null;
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

/** 微信身份脱敏展示：wm123456abcd -> wm12****abcd */
export function maskExternalUserid(id?: string | null): string {
  const s = String(id ?? "").trim();
  if (!s) return "";
  if (s.length <= 8) return `${s.slice(0, 2)}****`;
  return `${s.slice(0, 4)}****${s.slice(-4)}`;
}

export type ConversationRow = {
  id: string;
  customer_code: string | null;
  current_intent: string | null;
  pending_action: string | null;
  awaiting_field: string | null;
  last_tracking_number: string | null;
};

/** 取得（或创建）该微信身份的长期会话行 */
export async function ensureConversation(params: {
  openKfid: string;
  externalUserid: string;
  corpId?: string | null;
}): Promise<ConversationRow | null> {
  return safe(async () => {
    const admin = await db();
    const cols = "id, customer_code, current_intent, pending_action, awaiting_field, last_tracking_number";
    const { data: found } = await admin
      .from("wechat_ai_conversations")
      .select(cols)
      .eq("open_kfid", params.openKfid)
      .eq("external_userid", params.externalUserid)
      .maybeSingle();
    if (found?.id) {
      await admin
        .from("wechat_ai_conversations")
        .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", found.id);
      return found as ConversationRow;
    }
    const { data: created } = await admin
      .from("wechat_ai_conversations")
      .insert({
        open_kfid: params.openKfid,
        external_userid: params.externalUserid,
        corp_id_hash: corpIdHash(params.corpId),
      })
      .select(cols)
      .maybeSingle();
    return (created as ConversationRow) ?? null;
  }, null);
}

export async function updateConversationState(
  conversationId: string | null,
  patch: Partial<Pick<ConversationRow, "customer_code" | "current_intent" | "pending_action" | "awaiting_field" | "last_tracking_number">>,
): Promise<void> {
  if (!conversationId) return;
  await safe(async () => {
    const admin = await db();
    await admin
      .from("wechat_ai_conversations")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", conversationId);
  }, undefined);
}

export type SaveMessageInput = {
  conversationId: string | null;
  msgid?: string | null;
  direction: "in" | "out";
  origin?: number | null;
  messageType?: string;
  text?: string | null;
  mediaId?: string | null;
  ocrText?: string | null;
  ocrConfidence?: number | null;
  sendTime?: number | null;
  replyToMessageId?: string | null;
  processingStatus?: string | null;
  wechatErrcode?: number | null;
};

/** 永久保存一条消息，返回记录 id */
export async function saveMessage(input: SaveMessageInput): Promise<string | null> {
  if (!input.conversationId) return null;
  return safe(async () => {
    const admin = await db();
    const { data } = await admin
      .from("wechat_ai_messages")
      .insert({
        conversation_id: input.conversationId,
        msgid: input.msgid ?? null,
        direction: input.direction,
        origin: input.origin ?? null,
        message_type: input.messageType ?? "text",
        text_content: input.text ?? null,
        media_id: input.mediaId ?? null,
        ocr_text: input.ocrText ?? null,
        ocr_confidence: input.ocrConfidence ?? null,
        send_time: input.sendTime ? new Date(input.sendTime * 1000).toISOString() : null,
        reply_to_message_id: input.replyToMessageId ?? null,
        processing_status: input.processingStatus ?? null,
        wechat_errcode: input.wechatErrcode ?? null,
      })
      .select("id")
      .maybeSingle();
    return (data?.id as string) ?? null;
  }, null);
}

export type HistoryTurn = { direction: "in" | "out"; text: string };

/** 最近 N 轮客户消息与 AI 回复（按时间正序） */
export async function recentHistory(conversationId: string | null, turns = 10): Promise<HistoryTurn[]> {
  if (!conversationId) return [];
  return safe(async () => {
    const admin = await db();
    const { data } = await admin
      .from("wechat_ai_messages")
      .select("direction, text_content, ocr_text, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(turns * 2);
    const rows = ((data ?? []) as any[]).slice().reverse();
    return rows
      .map((r) => ({
        direction: (r.direction === "out" ? "out" : "in") as "in" | "out",
        text: String(r.text_content ?? r.ocr_text ?? "").slice(0, 300),
      }))
      .filter((r) => r.text.length > 0);
  }, []);
}

// ---------------------------------------------------------------- agent runs

export async function createAgentRun(params: {
  conversationId: string | null;
  userMessageId?: string | null;
  model: string;
  stateBefore: Record<string, unknown>;
  inputContextSummary?: string;
}): Promise<string | null> {
  if (!params.conversationId) return null;
  return safe(async () => {
    const admin = await db();
    const { data } = await admin
      .from("wechat_ai_agent_runs")
      .insert({
        conversation_id: params.conversationId,
        user_message_id: params.userMessageId ?? null,
        model: params.model,
        state_before: params.stateBefore,
        input_context_summary: params.inputContextSummary ?? null,
      })
      .select("id")
      .maybeSingle();
    return (data?.id as string) ?? null;
  }, null);
}

export async function finishAgentRun(
  runId: string | null,
  patch: {
    intent?: string | null;
    statePatch?: Record<string, unknown>;
    stateAfter?: Record<string, unknown>;
    toolRequested?: string | null;
    openaiStatus?: number | null;
    openaiDurationMs?: number | null;
    totalDurationMs?: number | null;
    resultStatus?: string | null;
    errorCode?: string | null;
  },
): Promise<void> {
  if (!runId) return;
  await safe(async () => {
    const admin = await db();
    await admin
      .from("wechat_ai_agent_runs")
      .update({
        intent: patch.intent ?? null,
        state_patch: patch.statePatch ?? {},
        state_after: patch.stateAfter ?? {},
        tool_requested: patch.toolRequested ?? null,
        openai_status: patch.openaiStatus ?? null,
        openai_duration_ms: patch.openaiDurationMs ?? null,
        total_duration_ms: patch.totalDurationMs ?? null,
        result_status: patch.resultStatus ?? null,
        error_code: patch.errorCode ?? null,
      })
      .eq("id", runId);
  }, undefined);
}

/** 工具入参脱敏：绑定码永不落库，长文本截断 */
export function maskToolArgs(args: any): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (k === "bind_code") {
      out[k] = v ? "******" : null;
      continue;
    }
    if (k === "idempotency_key") {
      out[k] = v ? "set" : null;
      continue;
    }
    out[k] = typeof v === "string" ? v.slice(0, 120) : v;
  }
  return out;
}

/** 工具结果摘要：只保留结构化关键字段 */
export function summarizeToolResult(data: any): Record<string, unknown> {
  const keys = [
    "found",
    "result_code",
    "bound",
    "created",
    "success",
    "tracking_number",
    "fw_tracking_no",
    "domestic_tracking_no",
    "needs_order_entry",
    "customer_bound",
    "transferred",
    "customer_waybill_count",
  ];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (data && data[k] !== undefined) out[k] = data[k];
  return out;
}

export async function saveToolRun(params: {
  agentRunId: string | null;
  conversationId: string | null;
  toolName: string;
  args: any;
  data: any;
  success: boolean;
  resultCode?: string | null;
  durationMs: number;
}): Promise<void> {
  if (!params.conversationId) return;
  await safe(async () => {
    const admin = await db();
    await admin.from("wechat_ai_tool_runs").insert({
      agent_run_id: params.agentRunId,
      conversation_id: params.conversationId,
      tool_name: params.toolName,
      request_summary: maskToolArgs(params.args),
      response_summary: summarizeToolResult(params.data),
      success: params.success,
      result_code: params.resultCode ?? null,
      duration_ms: params.durationMs,
    });
  }, undefined);
}

/** 上一次工具调用的结构化结果摘要（用于 GPT 上下文） */
export async function lastToolSummary(
  conversationId: string | null,
): Promise<{ tool_name: string; success: boolean; result_code: string | null; response: Record<string, unknown> } | null> {
  if (!conversationId) return null;
  return safe(async () => {
    const admin = await db();
    const { data } = await admin
      .from("wechat_ai_tool_runs")
      .select("tool_name, success, result_code, response_summary, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1);
    const row = ((data ?? []) as any[])[0];
    if (!row) return null;
    return {
      tool_name: String(row.tool_name),
      success: Boolean(row.success),
      result_code: row.result_code ?? null,
      response: (row.response_summary ?? {}) as Record<string, unknown>,
    };
  }, null);
}


// ---------------------------------------------------------------- drafts

export type DraftRow = {
  id: string;
  draft_data: Record<string, any>;
  draft_status: string;
  expires_at: string;
  customer_code: string | null;
  idempotency_key: string | null;
};

const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 取回当前活动草稿；已完成/取消/过期的旧草稿永不恢复 */
export async function getActiveDraft(conversationId: string | null): Promise<DraftRow | null> {
  if (!conversationId) return null;
  return safe(async () => {
    const admin = await db();
    const { data } = await admin
      .from("wechat_forwarding_drafts")
      .select("id, draft_data, draft_status, expires_at, customer_code, idempotency_key")
      .eq("conversation_id", conversationId)
      .eq("draft_status", "active")
      .order("created_at", { ascending: false })
      .limit(1);
    const row = ((data ?? []) as any[])[0] as DraftRow | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await admin
        .from("wechat_forwarding_drafts")
        .update({ draft_status: "expired", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      return null;
    }
    return row;
  }, null);
}

/** 合并写入草稿：空值不覆盖已有有效字段，并记录字段变更历史 */
export async function upsertDraft(params: {
  conversationId: string | null;
  messageId?: string | null;
  customerCode?: string | null;
  patch: Record<string, any>;
}): Promise<DraftRow | null> {
  if (!params.conversationId) return null;
  return safe(async () => {
    const admin = await db();
    const existing = await getActiveDraft(params.conversationId);
    const before = existing?.draft_data ?? {};
    const changed: Record<string, any> = {};
    const after: Record<string, any> = { ...before };
    for (const [k, v] of Object.entries(params.patch ?? {})) {
      if (v === undefined || v === null || v === "") continue; // 空值不覆盖
      if (after[k] === v) continue;
      after[k] = v;
      changed[k] = v;
    }
    const now = new Date().toISOString();

    let row: DraftRow | null = existing;
    if (!existing) {
      const { data } = await admin
        .from("wechat_forwarding_drafts")
        .insert({
          conversation_id: params.conversationId,
          customer_code: params.customerCode ?? null,
          draft_data: after,
          draft_status: "active",
          expires_at: new Date(Date.now() + DRAFT_TTL_MS).toISOString(),
        })
        .select("id, draft_data, draft_status, expires_at, customer_code, idempotency_key")
        .maybeSingle();
      row = (data as DraftRow) ?? null;
    } else if (Object.keys(changed).length) {
      await admin
        .from("wechat_forwarding_drafts")
        .update({
          draft_data: after,
          updated_at: now,
          ...(params.customerCode ? { customer_code: params.customerCode } : {}),
        })
        .eq("id", existing.id);
      row = { ...existing, draft_data: after };
    }

    if (row && Object.keys(changed).length) {
      await admin.from("wechat_forwarding_draft_events").insert({
        draft_id: row.id,
        message_id: params.messageId ?? null,
        changed_fields: changed,
        before_data: before,
        after_data: after,
      });
    }
    return row;
  }, null);
}

export async function closeDraft(
  draftId: string | null,
  status: "completed" | "cancelled" | "failed",
  extra?: { fwTrackingNo?: string | null; idempotencyKey?: string | null; failureReason?: string | null },
): Promise<void> {
  if (!draftId) return;
  await safe(async () => {
    const admin = await db();
    await admin
      .from("wechat_forwarding_drafts")
      .update({
        draft_status: status,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        created_fw_tracking_no: extra?.fwTrackingNo ?? null,
        idempotency_key: extra?.idempotencyKey ?? null,
        failure_reason: extra?.failureReason ?? null,
      })
      .eq("id", draftId);
  }, undefined);
}

/** 7 天未完成草稿批量过期（清理任务只处理草稿状态，不删除任何历史记录） */
export async function expireStaleDrafts(): Promise<number> {
  return safe(async () => {
    const admin = await db();
    const { data } = await admin.rpc("wechat_expire_stale_drafts");
    return Number(data ?? 0);
  }, 0);
}
