/**
 * 微信客服 → Lovable → GPT 独立快速通道（不经过腾讯云 ADP）。
 *
 * 日志规范：仅记录 消息哈希前 8 位 / 类型 / 是否去重 / 各步骤耗时 /
 * 微信 errcode / OpenAI HTTP 状态。禁止记录正文、token、密钥、
 * 完整 external_userid 或解密后的 XML。
 */
import { getAccessToken, kfApiCall, sendText } from "./api.server";
import { GPT_BUSY_TEXT, WELCOME_TEXT, runAgent } from "./agent.server";
import { xmlValue } from "./crypto.server";

export { WELCOME_TEXT };

export function shortHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (Math.imul(31, h) + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0").slice(0, 8);
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** 原子去重：true 表示本次首次处理该 msgid */
async function claimMsg(msgid: string): Promise<boolean> {
  const db = await admin();
  const { data, error } = await db.rpc("wechat_kf_msg_claim", { _msgid: msgid });
  if (error) return false;
  return Boolean(data);
}

/** 首次会话：true 表示本次应发送欢迎菜单 */
async function claimWelcome(openKfid: string, externalUserid: string): Promise<boolean> {
  const db = await admin();
  const { data, error } = await db.rpc("wechat_gpt_claim_welcome", {
    _open_kfid: openKfid,
    _external_userid: externalUserid,
  });
  if (error) return false;
  return Boolean(data);
}

/** 处理锁：同一 open_kfid 同时只允许一个同步任务 */
async function acquireLock(openKfid: string, ttlSeconds = 60): Promise<boolean> {
  const db = await admin();
  const { data, error } = await db.rpc("wechat_kf_try_lock", {
    _open_kfid: openKfid,
    _ttl_seconds: ttlSeconds,
  } as never);
  if (error) return false;
  return Boolean(data);
}

async function releaseLock(openKfid: string): Promise<void> {
  const db = await admin();
  await db.rpc("wechat_kf_release_lock", { _open_kfid: openKfid } as never);
}

async function readCursorRow(openKfid: string): Promise<{ cursor: string | null; exists: boolean }> {
  const db = await admin();
  const { data } = await db.from("wechat_kf_cursor").select("cursor").eq("open_kfid", openKfid).maybeSingle();
  return { cursor: data?.cursor ?? null, exists: Boolean(data) };
}

async function writeCursor(openKfid: string, cursor: string) {
  const db = await admin();
  await db.from("wechat_kf_cursor").upsert({
    open_kfid: openKfid,
    cursor,
    updated_at: new Date().toISOString(),
  });
}

/** 首次初始化：把历史 msgid 直接写入去重表，永不回复 */
async function markBootstrapIgnored(msgids: string[]): Promise<void> {
  if (!msgids.length) return;
  const db = await admin();
  await db
    .from("wechat_kf_msg_dedup")
    .upsert(msgids.map((msgid) => ({ msgid })), { onConflict: "msgid", ignoreDuplicates: true });
}

type KfMessage = {
  msgid?: string;
  open_kfid?: string;
  external_userid?: string;
  origin?: number;
  send_time?: number;
  msgtype?: string;
  text?: { content?: string; menu_id?: string };
  image?: { media_id?: string };

  event?: { event_type?: string; open_kfid?: string; external_userid?: string };
};

/** 拉取全部新消息（自动翻页，游标持久化）。bootstrap=true 表示本次是首次初始化。 */
export async function fetchNewMessages(
  openKfid: string,
  eventToken?: string | null,
): Promise<{ messages: KfMessage[]; bootstrap: boolean }> {
  const all: KfMessage[] = [];
  const row = await readCursorRow(openKfid);
  const bootstrap = !row.exists || !row.cursor;
  let cursor = row.cursor;
  for (let page = 0; page < 20; page++) {
    const json: any = await kfApiCall("/kf/sync_msg", {
      open_kfid: openKfid,
      limit: 100,
      ...(cursor ? { cursor } : {}),
      ...(eventToken && page === 0 ? { token: eventToken } : {}),
    });
    if (json?.errcode) {
      console.info(`[wxkf-gpt] sync_msg errcode=${json.errcode}`);
      break;
    }
    for (const m of json?.msg_list ?? []) all.push(m as KfMessage);
    if (json?.next_cursor) {
      cursor = json.next_cursor as string;
      await writeCursor(openKfid, cursor);
    }
    if (!json?.has_more) break;
  }
  return { messages: all, bootstrap };
}



/** 图片消息：下载 → OCR，失败时返回 null（不阻断主流程） */
async function imageOcrText(mediaId: string): Promise<{ text: string; confidence: number } | null> {
  try {
    const { downloadMedia } = await import("./api.server");
    const { runOcr } = await import("./ocr.server");
    const { bytes } = await downloadMedia(mediaId);
    const r = await runOcr(bytes);
    if (!r.text.trim()) return null;
    return { text: r.text, confidence: r.avgConfidence };
  } catch (e) {
    console.info(`[wxkf-gpt] ocr_failed ${(e as Error)?.name ?? "error"}`);
    return null;
  }
}

/** 处理单条客户消息 */
export async function handleMessage(m: KfMessage, baseUrl: string): Promise<void> {
  const startedAt = Date.now();
  const msgid = m.msgid ?? "";
  const hash = shortHash(msgid || JSON.stringify({ t: m.msgtype, o: m.open_kfid }));
  const type = m.msgtype ?? "unknown";

  const openKfid = m.open_kfid ?? m.event?.open_kfid ?? "";
  const externalUserid = m.external_userid ?? m.event?.external_userid ?? "";
  if (!openKfid || !externalUserid) return;

  // 只处理客户发来的消息（origin=3），避免客服/系统消息触发循环
  const isEnter = type === "event" && m.event?.event_type === "enter_session";
  if (!isEnter && m.origin !== 3) {
    console.info(`[wxkf-gpt] skipped hash=${hash} type=${type} reason=not_customer`);
    return;
  }

  if (msgid) {
    const first = await claimMsg(msgid);
    if (!first) {
      console.info(`[wxkf-gpt] handled hash=${hash} type=${type} dedup=true`);
      return;
    }
  }

  const { ensureConversation, saveMessage } = await import("./records.server");
  const conv = await ensureConversation({ openKfid, externalUserid });
  const conversationId = conv?.id ?? null;

  const reply = async (text: string, replyTo: string | null, status: string) => {
    const res: any = await sendText(openKfid, externalUserid, text);
    await saveMessage({
      conversationId,
      direction: "out",
      messageType: "text",
      text,
      replyToMessageId: replyTo,
      processingStatus: status,
      wechatErrcode: res?.errcode ?? 0,
    });
    return res;
  };

  if (isEnter) {
    const firstTime = await claimWelcome(openKfid, externalUserid);
    if (firstTime) {
      const res = await reply(WELCOME_TEXT, null, "welcome");
      console.info(
        `[wxkf-gpt] handled hash=${hash} type=enter_session dedup=false action=welcome wx_errcode=${res?.errcode ?? 0} took_ms=${Date.now() - startedAt}`,
      );
    } else {
      console.info(`[wxkf-gpt] handled hash=${hash} type=enter_session dedup=false action=skip_welcome`);
    }
    return;
  }

  if (type !== "text" && type !== "image") {
    const inId = await saveMessage({
      conversationId,
      msgid: msgid || null,
      direction: "in",
      origin: m.origin ?? null,
      messageType: type,
      sendTime: m.send_time ?? null,
      processingStatus: "unsupported",
    });
    await reply("目前该通道仅支持文字和图片咨询，请用文字描述您的问题。", inId, "unsupported");
    console.info(`[wxkf-gpt] handled hash=${hash} type=${type} dedup=false action=unsupported took_ms=${Date.now() - startedAt}`);
    return;
  }

  // 图片消息：先识别，识别文本进入 GPT 上下文
  let ocr: { text: string; confidence: number } | null = null;
  if (type === "image") {
    ocr = await imageOcrText(m.image?.media_id ?? "");
  }

  const inMessageId = await saveMessage({
    conversationId,
    msgid: msgid || null,
    direction: "in",
    origin: m.origin ?? null,
    messageType: type,
    text: type === "text" ? (m.text?.content ?? "").trim() : null,
    mediaId: type === "image" ? (m.image?.media_id ?? null) : null,
    ocrText: ocr?.text ?? null,
    ocrConfidence: ocr?.confidence ?? null,
    sendTime: m.send_time ?? null,
    processingStatus: "received",
  });

  if (type === "image" && !ocr) {
    await reply("图片没有识别成功，请重新拍摄清晰一些，或直接用文字发送单号。", inMessageId, "ocr_failed");
    console.info(`[wxkf-gpt] handled hash=${hash} type=image dedup=false action=ocr_failed took_ms=${Date.now() - startedAt}`);
    return;
  }

  // 首次进入文字消息（未收到 enter_session）时只发一次欢迎语，不调用业务工具
  const firstTime = await claimWelcome(openKfid, externalUserid);
  if (firstTime) {
    const res = await reply(WELCOME_TEXT, inMessageId, "welcome");
    console.info(
      `[wxkf-gpt] handled hash=${hash} type=${type} dedup=false action=welcome wx_errcode=${res?.errcode ?? 0} took_ms=${Date.now() - startedAt}`,
    );
    return;
  }

  const r = await runAgent({
    text: type === "text" ? (m.text?.content ?? "").trim() : "我发送了一张图片，请根据识别内容处理。",
    openKfid,
    externalUserid,
    baseUrl,
    conversationId,
    userMessageId: inMessageId,
    ocrText: ocr?.text ?? null,
  });
  await reply(r.reply, inMessageId, r.via);
  console.info(
    `[wxkf-gpt] handled hash=${hash} type=${type} dedup=false action=${r.via} rounds=${r.rounds} openai_status=${r.status ?? "n/a"} openai_err=${r.err ?? "none"} agent_ms=${r.ms} took_ms=${Date.now() - startedAt}`,
  );
}


/** 后台任务：解析事件 XML → 加锁 → 拉取消息 → 处理 */
export async function processGptCallback(plainXml: string, baseUrl = ""): Promise<{ handled: number }> {
  const startedAt = Date.now();
  const event = xmlValue(plainXml, "Event");
  const openKfid = xmlValue(plainXml, "OpenKfId");
  const token = xmlValue(plainXml, "Token");

  if (event !== "kf_msg_or_event" || !openKfid) {
    console.info(`[wxkf-gpt] callback_ignored type=${event ?? "unknown"}`);
    return { handled: 0 };
  }

  const locked = await acquireLock(openKfid);
  if (!locked) {
    console.info(`[wxkf-gpt] callback_skipped reason=locked took_ms=${Date.now() - startedAt}`);
    return { handled: 0 };
  }

  let handled = 0;
  try {
    await getAccessToken();
    const { messages, bootstrap } = await fetchNewMessages(openKfid, token);

    let queue = messages;
    if (bootstrap) {
      // 只处理本次同步中最新的一条客户消息，其余历史消息全部标记为已处理，永不回复
      const customer = messages.filter((m) => m.origin === 3 && m.msgid);
      let latest: KfMessage | null = null;
      for (const m of customer) {
        if (!latest || (m.send_time ?? 0) >= (latest.send_time ?? 0)) latest = m;
      }
      const ignored = messages.map((m) => m.msgid).filter((id): id is string => Boolean(id) && id !== latest?.msgid);
      await markBootstrapIgnored(ignored);
      queue = latest ? [latest] : [];
      console.info(
        `[wxkf-gpt] bootstrap total=${messages.length} bootstrap_ignored=${ignored.length} process=${queue.length}`,
      );
    }

    for (const m of queue) {
      try {
        await handleMessage(m, baseUrl);
        handled += 1;
      } catch (e) {
        console.error(`[wxkf-gpt] handle_failed ${(e as Error)?.name ?? "error"}`);
      }
    }
    console.info(
      `[wxkf-gpt] callback_done bootstrap=${bootstrap} messages=${messages.length} handled=${handled} took_ms=${Date.now() - startedAt}`,
    );
  } finally {
    await releaseLock(openKfid);
  }
  return { handled };
}


export const GPT_LANE_FALLBACK_TEXT = GPT_BUSY_TEXT;
