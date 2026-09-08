/**
 * GPT 返回状态（state_patch）的服务端校验与合并。
 *
 * 职责边界：
 * - GPT 负责理解意图、决定状态变化；
 * - 本模块只做安全校验：拒绝非法字段、拒绝把绑定码等非单号写入 last_tracking_number、
 *   拒绝 GPT 伪造或覆盖服务端确认的客户身份。
 *
 * 日志规范：只记录被拒绝的字段名，不记录字段值。
 */

/** 允许 GPT 修改的会话状态字段 */
const ALLOWED_KEYS = new Set([
  "current_intent",
  "pending_action",
  "awaiting_field",
  "last_tracking_number",
  "create_order_draft",
  "awaiting_confirmation",
]);

/** 永远由服务端决定、GPT 不得写入的字段 */
const FORBIDDEN_KEYS = new Set(["customer_code", "customer_bound", "user_id", "external_userid", "verified"]);

const DRAFT_KEYS = new Set([
  "domestic_tracking_no",
  "item_name",
  "quantity",
  "unit_price",
  "route_id",
  "route_name",
  "awaiting_confirmation",
]);

const EMPTY_VALUES = new Set(["", "无", "none", "null", "n/a", "未知"]);

export type StatePatch = {
  current_intent?: string | null;
  pending_action?: string | null;
  awaiting_field?: string | null;
  last_tracking_number?: string | null;
  create_order_draft?: Record<string, any> | null;
  awaiting_confirmation?: boolean | null;
};

/**
 * last_tracking_number 只接受明确的国内快递单号 / FW 集运单号 / 国际单号。
 * 6 位绑定码这类短码一律拒绝。
 */
export function isValidTrackingNumber(value: unknown): boolean {
  const s = String(value ?? "").trim().toUpperCase();
  if (!s) return false;
  if (/^FW[0-9A-Z]{4,}$/.test(s)) return true;
  if (/^[0-9]{8,30}$/.test(s)) return true;
  if (/^[A-Z]{2,4}[0-9]{8,}$/.test(s)) return true;
  return false;
}

function normStr(v: unknown): string | null {
  if (v === null) return null;
  const s = String(v ?? "").trim();
  if (!s || EMPTY_VALUES.has(s.toLowerCase())) return null;
  return s.slice(0, 60);
}

/** 校验并裁剪 GPT 返回的 state_patch */
export function sanitizeStatePatch(raw: any): { patch: StatePatch; rejected: string[] } {
  const patch: StatePatch = {};
  const rejected: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { patch, rejected };

  for (const [k, v] of Object.entries(raw)) {
    if (FORBIDDEN_KEYS.has(k)) {
      rejected.push(k);
      continue;
    }
    if (!ALLOWED_KEYS.has(k)) {
      rejected.push(k);
      continue;
    }
    if (k === "last_tracking_number") {
      if (v === null || normStr(v) === null) patch.last_tracking_number = null;
      else if (isValidTrackingNumber(v)) patch.last_tracking_number = String(v).trim().toUpperCase();
      else rejected.push(k);
      continue;
    }
    if (k === "create_order_draft") {
      if (v === null) {
        patch.create_order_draft = null;
        continue;
      }
      if (typeof v !== "object" || Array.isArray(v)) {
        rejected.push(k);
        continue;
      }
      const draft: Record<string, any> = {};
      for (const [dk, dv] of Object.entries(v as Record<string, any>)) {
        if (!DRAFT_KEYS.has(dk)) {
          rejected.push(`create_order_draft.${dk}`);
          continue;
        }
        draft[dk] = dv;
      }
      patch.create_order_draft = draft;
      continue;
    }
    if (k === "awaiting_confirmation") {
      patch.awaiting_confirmation = v === true ? true : v === false || v === null ? false : null;
      if (patch.awaiting_confirmation === null) rejected.push(k);
      continue;
    }
    (patch as any)[k] = normStr(v);
  }
  if (rejected.length) console.info(`[wxkf-gpt] state_patch_rejected fields=${rejected.join(",")}`);
  return { patch, rejected };
}

/**
 * 解析 GPT 最终输出。支持约定的 JSON 结构；
 * 非 JSON 时整段作为回复，state_patch 视为空。
 */
export function parseAgentOutput(text: string): { reply: string; statePatch: any } {
  const raw = String(text ?? "").trim();
  if (!raw) return { reply: "", statePatch: null };
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1]! : raw).trim();
  if (!candidate.startsWith("{")) return { reply: raw, statePatch: null };
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && typeof parsed.reply === "string") {
      return { reply: String(parsed.reply).trim(), statePatch: parsed.state_patch ?? null };
    }
  } catch {
    /* 非 JSON：按纯文本处理 */
  }
  return { reply: raw, statePatch: null };
}

/** 草稿中是否还有客户真实提供过的内容（仅 awaiting_confirmation 不算） */
export function draftHasContent(draft: Record<string, any> | null | undefined): boolean {
  if (!draft) return false;
  return Object.entries(draft).some(
    ([k, v]) => k !== "awaiting_confirmation" && v !== null && v !== undefined && v !== "",
  );
}
