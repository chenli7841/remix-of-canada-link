/**
 * 企业微信「EPLUS群发通知」应用接口封装（直连 qyapi.weixin.qq.com）。
 * 跟 src/lib/wechat-kf/api.server.ts 是同样的 access_token 缓存套路，但完全
 * 独立一套凭证 / 一张缓存表，互不调用。
 *
 * 重要：这里每一个会真正发请求给企业微信的函数，调用方都必须先自己检查
 * wecomNotifyEnabled()——本文件不在内部做总开关拦截，是为了让"预览"这类纯本地
 * 逻辑可以放心 import 这个文件的类型/常量而不会意外触发网络请求。真正会发请求
 * 的三个函数（getAccessToken / listExternalGroups / sendGroupMsgTemplate）
 * 在文件顶部注释里逐一标注。
 *
 * 也需要提前说明：客户群发送用的 add_group_msg_template 接口，官方语义是
 * "创建一个群发任务模板"，最终仍需要 sender 对应的企业微信成员在客户端里
 * 确认/执行发送——调用这个接口成功只代表"任务已提交"，不代表消息已经送达
 * 客户群。真正联调之前，这个假设没有被验证过，联调时需要对照企业微信最新
 * 文档重新确认一遍。
 */
import { wecomNotifyConfig } from "./config.server";

const BASE = "https://qyapi.weixin.qq.com/cgi-bin";
const TOKEN_ROW_ID = "notify";

let memToken: { token: string; expiresAt: number } | null = null;

async function admin(): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// 会发网络请求：调用方必须先确认 wecomNotifyEnabled()。
export async function getAccessToken(force = false): Promise<string> {
  const now = Date.now();
  if (!force && memToken && memToken.expiresAt > now) return memToken.token;

  const db = await admin();
  if (!force) {
    const { data } = await db
      .from("wecom_notify_token")
      .select("access_token, expires_at")
      .eq("id", TOKEN_ROW_ID)
      .maybeSingle();
    if (data?.access_token && new Date(data.expires_at).getTime() > now) {
      memToken = { token: data.access_token, expiresAt: new Date(data.expires_at).getTime() };
      return data.access_token;
    }
  }

  const { corpId, secret } = wecomNotifyConfig();
  if (!corpId || !secret) throw new Error("wecom_notify_not_configured");
  const res = await fetch(
    `${BASE}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`,
  );
  const json: any = await res.json();
  if (json?.errcode) throw new Error(`gettoken_failed_${json.errcode}:${json.errmsg ?? ""}`);

  const expiresAt = now + Math.max((Number(json.expires_in) || 7200) - 300, 60) * 1000;
  memToken = { token: json.access_token, expiresAt };
  await db.from("wecom_notify_token").upsert({
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

export type WecomExternalGroup = {
  chat_id: string;
  name: string;
  owner_userid: string | null;
  member_count: number;
};

// 会发网络请求：调用方必须先确认 wecomNotifyEnabled()。
// 客户群列表 + 详情：externalcontact/groupchat/list + externalcontact/groupchat/get。
export async function listExternalGroups(): Promise<WecomExternalGroup[]> {
  const groups: WecomExternalGroup[] = [];
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const listRes = await callApi("/externalcontact/groupchat/list", {
      status_filter: 0,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    if (listRes?.errcode) throw new Error(`groupchat_list_failed_${listRes.errcode}:${listRes.errmsg ?? ""}`);
    const chatIds: string[] = (listRes?.group_chat_list ?? []).map((g: any) => g.chat_id);
    for (const chatId of chatIds) {
      const detail = await callApi("/externalcontact/groupchat/get", { chat_id: chatId, need_name: 1 });
      if (detail?.errcode) {
        // 单个群拉详情失败不影响其它群——记下来跳过，别让一个坏数据卡住整批同步。
        continue;
      }
      const info = detail?.group_chat ?? {};
      groups.push({
        chat_id: chatId,
        name: info.name ?? "",
        owner_userid: info.owner ?? null,
        member_count: Array.isArray(info.member_list) ? info.member_list.length : 0,
      });
    }
    if (!listRes?.next_cursor) break;
    cursor = listRes.next_cursor;
  }
  return groups;
}

// 会发网络请求：调用方必须先确认 wecomNotifyEnabled()。
// 客户群发：externalcontact/add_group_msg_template —— 见文件顶部注释，这只是
// "提交群发任务"，不是"消息已送达"，调用方的返回文案不能说成已送达。
export async function sendGroupMsgTemplate(params: {
  senderUserId: string;
  chatIds: string[];
  content: string;
}): Promise<{ ok: boolean; msgid?: string; raw: any }> {
  const json = await callApi("/externalcontact/add_group_msg_template", {
    chat_type: "group",
    sender: params.senderUserId,
    chat_id_list: params.chatIds,
    text: { content: params.content },
  });
  if (json?.errcode) return { ok: false, raw: json };
  return { ok: true, msgid: json?.msgid, raw: json };
}
