/**
 * 绑定码优先处理器。
 *
 * 当会话处于「等待绑定码」状态时，下一条客户消息必须先经过本模块，
 * 优先级高于运单号识别、GPT 意图判断与任何物流查询工具。
 *
 * 日志规范：只记录状态与 result_code，绝不记录完整绑定码。
 */
import { resolveOrBindCustomer, type ToolCtx } from "./agent-tools.server";
import type { CreateOrderDraft, GptSession } from "./gpt-session.server";

export const AWAITING_BIND_CODE = "awaiting_bind_code";
export const BIND_INTENT = "bind_customer";

export const BIND_PROMPT_TEXT =
  "请登录 EPLUS 系统生成 6 位绑定码后发给我，绑定成功后我会继续为您办理。";
export const BIND_INVALID_TEXT = "绑定码无效，请核对后重新发送；绑定码为6位数字。";
export const BIND_EXPIRED_TEXT = "绑定码已过期，请登录系统重新生成绑定码后发送。";
export const BIND_CANCELLED_TEXT = "已取消本次创建操作。如需重新办理，随时告诉我。";

const CANCEL_RE = /^(取消|退出|不绑定了|不绑定|算了|不用了)$/;

/** 会话是否处于等待绑定码状态 */
export function isAwaitingBindCode(session: Pick<GptSession, "pending_action" | "current_intent">): boolean {
  return session.pending_action === AWAITING_BIND_CODE || session.current_intent === BIND_INTENT;
}

/** 只提取 6 位绑定码；不做任何日志输出 */
export function extractBindCode(text: string): string | null {
  const s = String(text ?? "").trim();
  if (/^\d{6}$/.test(s)) return s;
  const labeled = s.match(/绑定码[^0-9A-Za-z]{0,8}([0-9]{6})/) ?? s.match(/([0-9]{6})[^0-9]{0,4}绑定码/);
  if (labeled) return labeled[1]!;
  // 后台生成的绑定码为 6 位大写字母数字组合，等待状态下也允许
  const alnum = s.toUpperCase().match(/(?:^|绑定码[^0-9A-Z]{0,8})([0-9A-Z]{6})(?:$|\s)/);
  if (alnum && /[A-Z]/.test(alnum[1]!) && /^[0-9A-Z]{6}$/.test(alnum[1]!)) return alnum[1]!;
  return null;
}

export function isCancel(text: string): boolean {
  return CANCEL_RE.test(String(text ?? "").trim());
}

export type BindGateOutcome =
  | { kind: "not_applicable" }
  | { kind: "reply"; reply: string; clearDraft?: boolean; keepWaiting?: boolean }
  | { kind: "bound"; draft: CreateOrderDraft };

/**
 * 在等待绑定码状态下处理客户消息。
 * 返回 not_applicable 时才允许继续常规 GPT 流程。
 */
export async function handleBindGate(params: {
  text: string;
  ctx: ToolCtx;
  draft: CreateOrderDraft;
}): Promise<BindGateOutcome> {
  const { text, ctx, draft } = params;

  if (isCancel(text)) {
    console.info("[wxkf-gpt] bind_gate action=cancel");
    return { kind: "reply", reply: BIND_CANCELLED_TEXT, clearDraft: true };
  }

  const code = extractBindCode(text);
  if (!code) {
    console.info("[wxkf-gpt] bind_gate action=no_code");
    return { kind: "reply", reply: BIND_INVALID_TEXT, keepWaiting: true };
  }

  const result = await resolveOrBindCustomer(ctx, code);
  const resultCode = String(result.data?.result_code ?? "bind_failed");
  console.info(`[wxkf-gpt] bind_gate action=bind result_code=${resultCode}`);

  if (result.data?.bound) return { kind: "bound", draft };
  if (resultCode === "expired_bind_code")
    return { kind: "reply", reply: BIND_EXPIRED_TEXT, keepWaiting: true };
  if (resultCode === "invalid_bind_code" || resultCode === "required_field_missing")
    return { kind: "reply", reply: BIND_INVALID_TEXT, keepWaiting: true };
  return {
    kind: "reply",
    reply: String(result.data?.message ?? BIND_INVALID_TEXT),
    keepWaiting: true,
  };
}

/** 绑定成功后，用已收集的草稿生成继续录单的提示（不重复询问已提供信息） */
export function resumeDraftText(draft: CreateOrderDraft): string {
  const known: string[] = [];
  if (draft.domestic_tracking_no) known.push(`国内快递单号 ${draft.domestic_tracking_no}`);
  if (draft.item_name) known.push(`品名 ${draft.item_name}`);
  if (draft.quantity != null) known.push(`数量 ${draft.quantity}`);
  if (draft.unit_price != null) known.push(`单价 ${draft.unit_price}`);
  if (draft.route_name) known.push(`线路 ${draft.route_name}`);
  const missing: string[] = [];
  if (!draft.domestic_tracking_no) missing.push("国内快递单号");
  if (!draft.item_name) missing.push("品名");
  if (draft.quantity == null) missing.push("数量");
  if (draft.unit_price == null) missing.push("单价");
  if (!draft.route_id) missing.push("线路");

  const head = "绑定成功。";
  if (!known.length && !missing.length) return `${head}请问需要我帮您办理什么？`;
  const kept = known.length ? `已记录：${known.join("，")}。` : "";
  const ask = missing.length ? `还需要提供：${missing.join("、")}。` : "我这就为您整理确认内容。";
  return `${head}${kept}${ask}`;
}
