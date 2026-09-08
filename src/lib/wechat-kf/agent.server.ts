/**
 * 微信客服「全自然语言 GPT 工具调用」代理。
 *
 * 职责边界：
 * - GPT：理解客户自然语言、判断意图、提取字段、决定工具调用、生成回复，
 *   并通过 state_patch 声明会话状态变化（含清除不再成立的旧意图）。
 * - Lovable：加载/保存上下文、提供真实业务数据、执行工具，
 *   以及身份、权限、去重、幂等、创建确认等安全校验。
 *
 * 日志：只记录 HTTP 状态、错误类型、模型名、耗时、工具名与轮次；
 * 不记录客户正文、单号、身份或密钥。
 */
import { callOpenAiRaw, OPENAI_DEFAULT_MODEL, openAiConfigured } from "@/lib/openai.server";
import {
  executeTool,
  extractTrackingNumber,
  HUMAN_TRANSFER_TEXT,
  TOOL_DEFS,
  type ToolCtx,
} from "./agent-tools.server";
import { loadSession, saveSession, type CreateOrderDraft } from "./gpt-session.server";
import {
  AWAITING_BIND_CODE,
  BIND_INTENT,
  handleBindGate,
  isAwaitingBindCode,
  resumeDraftText,
} from "./bind-gate.server";
import {
  closeDraft,
  createAgentRun,
  finishAgentRun,
  getActiveDraft,
  lastToolSummary,
  recentHistory,
  saveToolRun,
  updateConversationState,
  upsertDraft,
} from "./records.server";
import { draftHasContent, isValidTrackingNumber, parseAgentOutput, sanitizeStatePatch } from "./state-guard.server";


export const GPT_BUSY_TEXT = "抱歉，系统暂时繁忙，请稍后重试；如问题紧急，可转人工客服。";
export const TOOL_FAIL_TEXT = "查询服务暂时不可用，请稍后重试或联系人工客服。";

export const WELCOME_TEXT =
  "您好，我是EPLUS AI客服。您可以直接告诉我需要查询的运单号，或说明需要创建运单；物流状态、入库情况、运费重量和预计到达时间也都可以直接问我。";

const TOTAL_BUDGET_MS = 12_000;
const MAX_TOOL_ROUNDS = 3;
const MAX_OUTPUT_TOKENS = 400;

const CREATE_INTENT = "create_forwarding_order";

const SYSTEM_PROMPT = [
  "你是EPLUS物流AI客服。",
  "先理解客户意图，不要求客户点击菜单；客户可以直接描述查询或录单需求。",
  "涉及物流状态、到仓扫描、重量、运费、预计到达时间、客户身份或创建运单时，必须调用对应工具。",
  "严禁根据常识猜测任何物流状态、费用、重量、时间、客户身份和订单结果。",
  "缺少单号时只询问单号，不要一次提出过多问题。",
  "会话上下文中若已有 last_tracking_number，客户说“这个单”“它”“运费呢”“什么时候到”时复用该单号；客户给出新的明确单号时以新单号为准。",
  "创建运单需逐项收集：国内快递单号、品名、数量、单价、线路；客户一次提供多个字段时一次性提取，不要重复询问。",
  "创建运单前必须先 resolve_or_bind_customer 确认绑定，再 get_forwarding_options 取得可用线路；线路只能从工具返回的 route_id 中选择，仓库固定义乌YW，地址使用客户默认地址。",
  "创建前必须用 confirm=false 展示完整确认内容并等待客户明确确认；只有客户回复“确认创建/确认录单”等明确同意后才可 confirm=true，并附 idempotency_key。",
  "只有客户在当前有效上下文中明确表达创建运单意图时，才可调用 get_forwarding_options 或 create_forwarding_order；普通问候、寒暄、感谢、无关闲聊不得调用任何工具。",
  "客户只是问候、开启新话题或明确结束旧任务时，必须在 state_patch 中把 current_intent、pending_action、awaiting_field 置为 null，awaiting_confirmation 置为 false；不能因为历史中出现过创建运单就一直保留该意图。",
  "普通咨询可直接回答，但不能虚构EPLUS政策；没有可靠资料时提示联系人工客服。",
  "回复用简体中文，简洁、自然、礼貌，避免重复客户已经提供的信息，单条回复不超过200字。",
  "客户发送 6 位数字或 6 位字母数字但当前并非等待绑定码状态时，不得当作绑定码，也不得当作运单号；先询问「这是绑定码还是运单号？」。",
  "绑定码绝不可写入 last_tracking_number；last_tracking_number 只能是国内快递单号、FW集运单号或工具返回的真实单号。",
  "customer_code 与绑定状态由服务端解析，禁止你写入、修改或清除。",
  "最终回复必须输出一个 JSON 对象（不要代码块以外的多余文字）：",
  '{"reply":"给客户的最终回复","state_patch":{},"tool_call":null}',
  "state_patch 只能包含 current_intent、pending_action、awaiting_field、last_tracking_number、create_order_draft、awaiting_confirmation；不需要变更时填 {}。",
  "每条客户消息最多发送一条最终回复。",
].join("\n");

type Msg = Record<string, any>;

function outputText(body: any): string {
  const parts: string[] = [];
  for (const item of body?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const c of item?.content ?? []) if (typeof c?.text === "string") parts.push(c.text);
  }
  return parts.join("").trim();
}

function functionCalls(body: any): Array<{ call_id: string; name: string; args: any; raw: any }> {
  const out: Array<{ call_id: string; name: string; args: any; raw: any }> = [];
  for (const item of body?.output ?? []) {
    if (item?.type !== "function_call") continue;
    let args: any = {};
    try {
      args = item.arguments ? JSON.parse(item.arguments) : {};
    } catch {
      args = {};
    }
    out.push({ call_id: item.call_id, name: item.name, args, raw: item });
  }
  return out;
}

export type AgentResult = {
  reply: string;
  via: "gpt" | "gpt_tool" | "fallback_tool" | "busy" | "transfer" | "bind";
  status: number | null;
  err: string | null;
  rounds: number;
  ms: number;
};

/** 服务端权威身份解析（GPT 与客户请求体都不能影响结果） */
async function resolveIdentity(
  externalUserid: string,
): Promise<{ bound: boolean; customer_code: string | null; display_name: string | null }> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveWechatCustomer } = await import("@/lib/wechat-identity.server");
    const r = await resolveWechatCustomer(supabaseAdmin, { external_userid: externalUserid });
    return {
      bound: Boolean(r.found),
      customer_code: r.found ? (r.customer_code ?? null) : null,
      display_name: r.customer_display_name ?? null,
    };
  } catch {
    return { bound: false, customer_code: null, display_name: null };
  }
}

/** OpenAI 不可用时的降级：客户消息里有明确单号+查询意图，直接调用真实工具 */
async function fallbackDirect(ctx: ToolCtx, text: string): Promise<string | null> {
  const no = extractTrackingNumber(text) ?? ctx.lastTrackingNumber ?? null;
  if (!no) return null;
  const wantsBilling = /运费|多少钱|价格|费用|重量|公斤|kg|计费|什么时候到|到达|时效/i.test(text);
  if (wantsBilling) {
    const r = await executeTool("query_order_billing", { tracking_number: no }, ctx);
    const t = r.data?.billing_text as string | null;
    if (t) return t;
  }
  const r = await executeTool("query_tracking_status", { tracking_number: no }, ctx);
  const t = (r.data?.tracking_text as string | null) || (r.data?.scan_text as string | null);
  return t || null;
}

/** 录单草稿中下一个仍需客户补齐的字段（仓库固定 YW、地址取默认地址，故不在其中） */
export function nextMissingField(draft: CreateOrderDraft, pending?: string | null): string | null {
  if (pending === AWAITING_BIND_CODE) return "bind_code";
  if (!draft || Object.keys(draft).length === 0) return null;
  if (!draft.domestic_tracking_no) return "domestic_tracking_no";
  if (!draft.item_name) return "item_name";
  if (draft.quantity == null) return "quantity";
  if (draft.unit_price == null) return "unit_price";
  if (!draft.route_id) return "route_id";
  if (draft.awaiting_confirmation) return "confirmation";
  return null;
}


export async function runAgent(params: {
  text: string;
  openKfid: string;
  externalUserid: string;
  baseUrl: string;
  /** 永久记录上下文（缺省时只走会话记忆，不影响主流程） */
  conversationId?: string | null;
  userMessageId?: string | null;
  /** 图片消息的识别文本，仅用于上下文提示 */
  ocrText?: string | null;
}): Promise<AgentResult> {
  const started = Date.now();
  const conversationId = params.conversationId ?? null;
  const session = await loadSession(params.openKfid, params.externalUserid);
  const ctx: ToolCtx = {
    baseUrl: params.baseUrl,
    openKfid: params.openKfid,
    externalUserid: params.externalUserid,
    lastTrackingNumber: isValidTrackingNumber(session.last_tracking_number) ? session.last_tracking_number : null,
  };

  // 永久草稿优先于临时会话草稿（跨天、跨会话继续录单）
  const storedDraft = await getActiveDraft(conversationId);
  const baseDraft: CreateOrderDraft = {
    ...(session.create_order_draft ?? {}),
    ...((storedDraft?.draft_data as CreateOrderDraft) ?? {}),
  };

  const [history, prevTool] = await Promise.all([recentHistory(conversationId, 10), lastToolSummary(conversationId)]);
  let identity = await resolveIdentity(params.externalUserid);

  let draft: CreateOrderDraft = { ...baseDraft };
  let lastTracking = isValidTrackingNumber(session.last_tracking_number) ? session.last_tracking_number : null;
  let intent = session.current_intent;
  let pending = session.pending_action;
  let awaitingOverride: string | null | undefined;
  let lastStatus: number | null = null;
  let lastErr: string | null = null;
  let openaiMs: number | null = null;
  let rounds = 0;
  let transferred = false;
  let toolRequested: string | null = null;
  let createdFwNo: string | null = null;
  const toolsUsed: string[] = [];
  let forceBindWait = false;

  const stateBefore = {
    last_tracking_number: session.last_tracking_number,
    current_intent: session.current_intent,
    pending_action: session.pending_action,
    create_order_draft: baseDraft,
  };

  const agentRunId = await createAgentRun({
    conversationId,
    userMessageId: params.userMessageId ?? null,
    model: OPENAI_DEFAULT_MODEL,
    stateBefore,
    inputContextSummary: `history_turns=${history.length};has_draft=${storedDraft ? 1 : 0};image=${params.ocrText ? 1 : 0};bound=${identity.bound ? 1 : 0}`,
  });

  /** 校验并合并 GPT 返回的 state_patch（身份类字段一律拒绝） */
  const applyStatePatch = (raw: any) => {
    const { patch } = sanitizeStatePatch(raw);
    if ("current_intent" in patch) intent = patch.current_intent ?? null;
    if ("pending_action" in patch) pending = patch.pending_action ?? null;
    if ("awaiting_field" in patch) awaitingOverride = patch.awaiting_field ?? null;
    if ("last_tracking_number" in patch) lastTracking = patch.last_tracking_number ?? null;
    if ("create_order_draft" in patch) {
      draft = patch.create_order_draft === null ? {} : { ...draft, ...patch.create_order_draft };
    }
    if (patch.awaiting_confirmation != null) draft.awaiting_confirmation = patch.awaiting_confirmation;
  };

  const finish = async (reply: string, via: AgentResult["via"]): Promise<AgentResult> => {
    // ---------- 服务端安全校验（GPT 无法绕过） ----------
    if (!isValidTrackingNumber(lastTracking)) lastTracking = null;
    if (forceBindWait) {
      pending = AWAITING_BIND_CODE;
      intent = BIND_INTENT;
    }
    const createToolUsed = toolsUsed.includes(CREATE_INTENT) || toolsUsed.includes("get_forwarding_options");
    // 没有任何录单草稿内容、本轮也没有创建动作时，不得保留创建意图
    if (intent === CREATE_INTENT && !draftHasContent(draft) && !createToolUsed && pending !== AWAITING_BIND_CODE) {
      intent = null;
      if (pending === "awaiting_confirmation" || pending === "creating") pending = null;
    }
    if (pending === "awaiting_confirmation" && draft.awaiting_confirmation !== true) pending = null;
    if (!draftHasContent(draft)) draft = {};

    await saveSession({
      open_kfid: params.openKfid,
      external_userid: params.externalUserid,
      last_tracking_number: lastTracking,
      current_intent: intent,
      pending_action: pending,
      create_order_draft: draft,
    });

    const stateAfter = {
      last_tracking_number: lastTracking,
      current_intent: intent,
      pending_action: pending,
      create_order_draft: draft,
    };
    const statePatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(stateAfter)) {
      if (JSON.stringify((stateBefore as any)[k]) !== JSON.stringify(v)) statePatch[k] = v;
    }

    if (conversationId) {
      await updateConversationState(conversationId, {
        current_intent: intent,
        pending_action: pending,
        awaiting_field: awaitingOverride !== undefined ? awaitingOverride : nextMissingField(draft, pending),
        last_tracking_number: lastTracking,
        // 客户号只来自服务端绑定解析；未解析到时保留原值，GPT 不得清除
        ...(identity.customer_code ? { customer_code: identity.customer_code } : {}),
      });
      if (createdFwNo) {
        await closeDraft(storedDraft?.id ?? null, "completed", { fwTrackingNo: createdFwNo });
      } else if (via === "bind" && !draft.domestic_tracking_no && storedDraft) {
        // 客户取消录单：草稿作废，永不自动恢复
        await closeDraft(storedDraft.id, "cancelled");
      } else if (draftHasContent(draft)) {
        await upsertDraft({
          conversationId,
          messageId: params.userMessageId ?? null,
          customerCode: identity.customer_code,
          patch: draft as Record<string, any>,
        });
      }
      await finishAgentRun(agentRunId, {
        intent,
        statePatch,
        stateAfter,
        toolRequested,
        openaiStatus: lastStatus,
        openaiDurationMs: openaiMs,
        totalDurationMs: Date.now() - started,
        resultStatus: via,
        errorCode: lastErr,
      });
    }
    return { reply, via, status: lastStatus, err: lastErr, rounds, ms: Date.now() - started };
  };


  // ---------- 绑定码优先处理（高于单号识别、GPT 意图与任何物流工具） ----------
  let userText = params.text;
  let justBound = false;
  if (isAwaitingBindCode(session)) {
    const outcome = await handleBindGate({ text: params.text, ctx, draft });
    if (outcome.kind === "reply") {
      if (outcome.clearDraft) {
        draft = {};
        pending = null;
        intent = null;
      } else if (outcome.keepWaiting) {
        pending = AWAITING_BIND_CODE;
        intent = BIND_INTENT;
      }
      return finish(outcome.reply, "bind");
    }
    if (outcome.kind === "bound") {
      justBound = true;
      pending = null;
      intent = draftHasContent(draft) ? CREATE_INTENT : null;
      identity = await resolveIdentity(params.externalUserid);
      userText = "我已完成绑定，请继续之前的录单流程。";
    }
  }

  const contextBlock = [
    "会话上下文（由服务端提供，身份字段权威且不可修改）：",
    JSON.stringify({
      current_intent: intent ?? null,
      pending_action: pending ?? null,
      awaiting_field: nextMissingField(draft, pending),
      last_tracking_number: lastTracking ?? null,
      customer_bound: identity.bound,
      customer_code: identity.customer_code,
      create_order_draft: draft,
      last_tool_result: prevTool,
    }),
  ].join("\n");

  const input: Msg[] = [
    { role: "system", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
    { role: "system", content: [{ type: "input_text", text: contextBlock }] },
    // 最近 10 轮对话（不含本条），让 GPT 能理解“这个单”“上面那个”等指代
    ...history.slice(0, -1).map((h) => ({
      role: h.direction === "in" ? "user" : "assistant",
      content: [{ type: h.direction === "in" ? "input_text" : "output_text", text: h.text }],
    })),
    ...(params.ocrText
      ? [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: `客户发送了图片，识别文本如下（可能有误，需与客户确认关键信息）：${params.ocrText.slice(0, 500)}`,
              },
            ],
          },
        ]
      : []),

    ...(justBound
      ? [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "客户刚刚绑定成功。请基于 create_order_draft 继续创建运单流程，不要重复询问已提供的信息，只补齐缺失字段或展示确认内容。",
              },
            ],
          },
        ]
      : []),
    { role: "user", content: [{ type: "input_text", text: userText }] },
  ];

  const busyText = () => (justBound ? resumeDraftText(draft) : GPT_BUSY_TEXT);

  if (justBound && !openAiConfigured()) {
    return finish(resumeDraftText(draft), "bind");
  }

  if (!openAiConfigured()) {
    lastErr = "not_configured";
    const direct = await fallbackDirect(ctx, userText);
    return finish(direct ?? busyText(), direct ? "fallback_tool" : "busy");
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const remaining = TOTAL_BUDGET_MS - (Date.now() - started);
    if (remaining <= 1500) break;
    rounds = round + 1;

    const res = await callOpenAiRaw(
      {
        input,
        tools: TOOL_DEFS as unknown as unknown[],
        tool_choice: "auto",
        parallel_tool_calls: false,
        reasoning: { effort: "none" },
        text: { verbosity: "low" },
        max_output_tokens: MAX_OUTPUT_TOKENS,
      },
      { timeoutMs: Math.min(remaining, 10_000) },
    );
    lastStatus = res.status;
    lastErr = res.err ?? null;
    openaiMs = res.ms ?? null;

    console.info(
      `[wxkf-gpt] openai round=${rounds} model=${OPENAI_DEFAULT_MODEL} status=${res.status ?? "n/a"} err=${res.err ?? "none"} oai_code=${res.body?.error?.code ?? res.body?.error?.type ?? "n/a"} ms=${res.ms}`,
    );

    if (res.err) {
      const direct = await fallbackDirect(ctx, userText);
      return finish(direct ?? busyText(), direct ? "fallback_tool" : "busy");
    }

    const calls = functionCalls(res.body);
    if (!calls.length) {
      const text = outputText(res.body);
      if (text) {
        const parsed = parseAgentOutput(text);
        applyStatePatch(parsed.statePatch);
        const reply = parsed.reply || text;
        return finish(reply.slice(0, 600), rounds > 1 ? "gpt_tool" : "gpt");
      }
      const direct = await fallbackDirect(ctx, userText);
      lastErr = "empty_output";
      return finish(direct ?? busyText(), direct ? "fallback_tool" : "busy");
    }

    for (const call of calls) {
      if (call.name === "query_tracking_status" || call.name === "query_order_billing") {
        const raw = String(call.args?.tracking_number ?? "").trim();
        const n = isValidTrackingNumber(raw) ? raw : lastTracking || "";
        if (n) {
          lastTracking = n;
          ctx.lastTrackingNumber = n;
          call.args.tracking_number = n;
        }
        intent = call.name;
      }
      if (call.name === CREATE_INTENT) {
        intent = CREATE_INTENT;
        if (call.args?.domestic_tracking_no) draft.domestic_tracking_no = call.args.domestic_tracking_no;
        if (call.args?.item_name) draft.item_name = call.args.item_name;
        if (call.args?.quantity != null) draft.quantity = Number(call.args.quantity);
        if (call.args?.unit_price != null) draft.unit_price = Number(call.args.unit_price);
        if (call.args?.route_id) draft.route_id = call.args.route_id;
        draft.awaiting_confirmation = call.args?.confirm !== true;
        pending = call.args?.confirm === true ? "creating" : "awaiting_confirmation";
      }

      toolRequested = call.name;
      toolsUsed.push(call.name);
      const toolStarted = Date.now();
      const result = await executeTool(call.name, call.args, ctx);
      await saveToolRun({
        agentRunId,
        conversationId,
        toolName: call.name,
        args: call.args,
        data: result.data,
        success: result.ok,
        resultCode: result.data?.result_code ?? result.data?.error ?? null,
        durationMs: Date.now() - toolStarted,
      });

      if (call.name === "transfer_to_human") transferred = true;
      if (call.name === "resolve_or_bind_customer") {
        if (result.data?.bound === true) {
          forceBindWait = false;
          // 服务端重新解析永久绑定，把权威 customer_code 同步进会话
          identity = await resolveIdentity(params.externalUserid);
          if (pending === AWAITING_BIND_CODE) {
            pending = null;
            intent = draftHasContent(draft) ? CREATE_INTENT : intent;
          }
        } else if (result.data?.bound === false) {
          forceBindWait = true;
          pending = AWAITING_BIND_CODE;
          intent = BIND_INTENT;
        }
      }
      if (call.name === CREATE_INTENT && result.data?.created) {
        pending = null;
        draft.awaiting_confirmation = false;
        createdFwNo = result.data?.fw_tracking_no ?? null;
      }


      input.push(call.raw);
      input.push({
        type: "function_call_output",
        call_id: call.call_id,
        output: JSON.stringify(result.data ?? {}).slice(0, 4000),
      });

      if (!result.ok && call.name !== "transfer_to_human") {
        return finish(TOOL_FAIL_TEXT, "gpt_tool");
      }
    }

    if (transferred) return finish(HUMAN_TRANSFER_TEXT, "transfer");
  }

  // 轮次或时间预算用尽 —— 尽量给出真实结果而不是“系统繁忙”
  const direct = await fallbackDirect(ctx, userText);
  return finish(direct ?? busyText(), direct ? "fallback_tool" : "busy");
}

/** 欢迎语：不调用业务工具，只回一次 */
export async function welcomeReply(): Promise<string> {
  return WELCOME_TEXT;
}
