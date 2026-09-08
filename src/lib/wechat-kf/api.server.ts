/**
 * 企业微信客服接口封装（直连 qyapi.weixin.qq.com，不经过腾讯云 ADP）。
 * access_token 持久化缓存并提前 5 分钟刷新。
 */
import { kfConfig } from "./config.server";

const BASE = "https://qyapi.weixin.qq.com/cgi-bin";
const TOKEN_ROW_ID = "kf";

let memToken: { token: string; expiresAt: number } | null = null;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function getAccessToken(force = false): Promise<string> {
  const now = Date.now();
  if (!force && memToken && memToken.expiresAt > now) return memToken.token;

  const db = await admin();
  if (!force) {
    const { data } = await db
      .from("wechat_kf_token")
      .select("access_token, expires_at")
      .eq("id", TOKEN_ROW_ID)
      .maybeSingle();
    if (data?.access_token && new Date(data.expires_at).getTime() > now) {
      memToken = { token: data.access_token, expiresAt: new Date(data.expires_at).getTime() };
      return data.access_token;
    }
  }

  const { corpId, secret } = kfConfig();
  const res = await fetch(`${BASE}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`);
  const json: any = await res.json();
  if (json?.errcode) throw new Error(`gettoken_failed_${json.errcode}`);

  // 提前 5 分钟过期
  const expiresAt = now + Math.max((Number(json.expires_in) || 7200) - 300, 60) * 1000;
  memToken = { token: json.access_token, expiresAt };
  await db.from("wechat_kf_token").upsert({
    id: TOKEN_ROW_ID,
    access_token: json.access_token,
    expires_at: new Date(expiresAt).toISOString(),
    updated_at: new Date().toISOString(),
  });
  return json.access_token as string;
}

async function callApi(path: string, body: unknown, retry = true): Promise<any> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json();
  if (retry && (json?.errcode === 40014 || json?.errcode === 42001)) {
    await getAccessToken(true);
    return callApi(path, body, false);
  }
  return json;
}

export async function syncMsg(params: { eventToken?: string | null; openKfid: string; limit?: number }) {
  const db = await admin();
  const { data: cur } = await db
    .from("wechat_kf_cursor")
    .select("cursor")
    .eq("open_kfid", params.openKfid)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    open_kfid: params.openKfid,
    limit: params.limit ?? 100,
    ...(cur?.cursor ? { cursor: cur.cursor } : {}),
    ...(params.eventToken ? { token: params.eventToken } : {}),
  };
  const json = await callApi("/kf/sync_msg", payload);
  if (json?.errcode) {
    console.error(`[wechat-kf] sync_msg errcode=${json.errcode}`);
    return { msgList: [] as any[], errcode: json.errcode };
  }
  if (json?.next_cursor) {
    await db.from("wechat_kf_cursor").upsert({
      open_kfid: params.openKfid,
      cursor: json.next_cursor,
      updated_at: new Date().toISOString(),
    });
  }
  return { msgList: (json?.msg_list ?? []) as any[], errcode: 0 };
}

export async function sendText(openKfid: string, toUser: string, content: string) {
  const json = await callApi("/kf/send_msg", {
    touser: toUser,
    open_kfid: openKfid,
    msgtype: "text",
    text: { content },
  });
  if (json?.errcode) console.error(`[wechat-kf] send_msg text errcode=${json.errcode}`);
  return json;
}

export async function sendMenu(
  openKfid: string,
  toUser: string,
  headContent: string,
  items: Array<{ id: string; content: string }>,
  tailContent?: string,
) {
  const json = await callApi("/kf/send_msg", {
    touser: toUser,
    open_kfid: openKfid,
    msgtype: "msgmenu",
    msgmenu: {
      head_content: headContent,
      list: items.map((i) => ({ type: "click", click: { id: i.id, content: i.content } })),
      ...(tailContent ? { tail_content: tailContent } : {}),
    },
  });
  if (json?.errcode) console.error(`[wechat-kf] send_msg menu errcode=${json.errcode}`);
  return json;
}

/** 下载客服消息中的图片到内存（不落盘、不生成公开 URL） */
export async function downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/media/get?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`);
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  if (contentType.includes("application/json")) throw new Error("media_download_failed");
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, contentType };
}

/** 通用客服接口调用（带 access_token 失效自动重试），供 GPT 快速通道使用 */
export async function kfApiCall(path: string, body: unknown): Promise<any> {
  return callApi(path, body);
}
