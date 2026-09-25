/**
 * 企业微信「EPLUS群发通知」应用接口封装（直连 qyapi.weixin.qq.com）。
 * 跟 src/lib/wechat-kf/api.server.ts 是同样的 access_token 缓存套路，但完全
 * 独立一套凭证 / 一张缓存表，互不调用。
 *
 * 重要：同步、发送和状态刷新由调用方检查 wecomNotifyEnabled()。管理员显式点击
 * “测试连接”时允许在总开关关闭状态下只获取一次 access_token，以便先完成可信 IP
 * 联调，再开启真实同步/发送。
 *
 * 也需要提前说明：客户群发送用的 add_msg_template 接口，官方语义是
 * "创建一个群发任务模板"，最终仍需要 sender 对应的企业微信成员在客户端里
 * 确认/执行发送——调用这个接口成功只代表"任务已提交"，不代表消息已经送达
 * 客户群。真正联调之前，这个假设没有被验证过，联调时需要对照企业微信最新
 * 文档重新确认一遍。
 */
import { wecomNotifyConfig } from "./config.server";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";

const REQUEST_TIMEOUT_MS = 12_000;
const TOKEN_ROW_ID = "notify";

let memToken: { token: string; expiresAt: number } | null = null;

async function gatewayCall<T>(path: string, payload: unknown): Promise<T | null> {
  const { gatewayUrl, gatewaySharedSecret } = wecomNotifyConfig();
  if (!gatewayUrl) return null;
  if (!gatewaySharedSecret) throw new Error("wecom_gateway_secret_not_configured");
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(18).toString("base64url");
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  const canonical = ["POST", path, timestamp, nonce, bodyHash].join("\n");
  const signature = createHmac("sha256", gatewaySharedSecret).update(canonical).digest("hex");
  const response = await fetchWithTimeout(`${gatewayUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eplus-timestamp": timestamp,
      "x-eplus-nonce": nonce,
      "x-eplus-signature": signature,
    },
    body,
  });
  const result: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error ?? `wecom_gateway_http_${response.status}`);
  return result as T;
}

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

  const { corpId, secret, apiBaseUrl } = wecomNotifyConfig();
  if (!corpId || !secret) throw new Error("wecom_notify_not_configured");
  const res = await fetchWithTimeout(
    `${apiBaseUrl}/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(secret)}`,
  );
  if (!res.ok) throw new Error(`gettoken_http_${res.status}`);
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

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("wecom_request_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function callApi(path: string, body: unknown, retry = true): Promise<any> {
  const token = await getAccessToken();
  const { apiBaseUrl } = wecomNotifyConfig();
  const res = await fetchWithTimeout(
    `${apiBaseUrl}${path}?access_token=${encodeURIComponent(token)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    if (retry && res.status >= 500) return callApi(path, body, false);
    throw new Error(`wecom_http_${res.status}`);
  }
  const json: any = await res.json();
  if (retry && (json?.errcode === 40014 || json?.errcode === 42001)) {
    await getAccessToken(true);
    return callApi(path, body, false);
  }
  return json;
}

export async function testWecomConnection(): Promise<{ ok: true }> {
  const gateway = await gatewayCall<{ ok: boolean }>("/v1/wecom/test", {});
  if (gateway) return { ok: true };
  await getAccessToken(true);
  return { ok: true };
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
  const gateway = await gatewayCall<{
    groups: Array<{ chatId: string; name: string; ownerUserId: string | null; memberCount: number }>;
  }>("/v1/wecom/groups/sync", {});
  if (gateway) {
    return gateway.groups.map((group) => ({
      chat_id: group.chatId,
      name: group.name,
      owner_userid: group.ownerUserId,
      member_count: group.memberCount,
    }));
  }
  const groups: WecomExternalGroup[] = [];
  let cursor = "";
  for (let page = 0; page < 50; page++) {
    const listRes = await callApi("/externalcontact/groupchat/list", {
      status_filter: 0,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    if (listRes?.errcode)
      throw new Error(`groupchat_list_failed_${listRes.errcode}:${listRes.errmsg ?? ""}`);
    const chatIds: string[] = (listRes?.group_chat_list ?? []).map((g: any) => g.chat_id);
    for (const chatId of chatIds) {
      const detail = await callApi("/externalcontact/groupchat/get", {
        chat_id: chatId,
        need_name: 1,
      });
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
// 客户群发：externalcontact/add_msg_template —— 见文件顶部注释，这只是
// "提交群发任务"，不是"消息已送达"，调用方的返回文案不能说成已送达。
export async function sendGroupMsgTemplate(params: {
  senderUserId: string;
  chatIds: string[];
  content: string;
}): Promise<{ ok: boolean; msgid?: string; raw: any }> {
  const gateway = await gatewayCall<{ ok: boolean; msgid: string }>("/v1/wecom/messages", {
    request_id: randomUUID(),
    sender_user_id: params.senderUserId,
    chat_ids: params.chatIds,
    content: params.content,
  });
  if (gateway) return { ok: true, msgid: gateway.msgid, raw: gateway };
  const json = await callApi("/externalcontact/add_msg_template", {
    chat_type: "group",
    sender: params.senderUserId,
    chat_id_list: params.chatIds,
    text: { content: params.content },
  });
  if (json?.errcode) return { ok: false, raw: json };
  return { ok: true, msgid: json?.msgid, raw: json };
}

export type WecomGroupSendResult = {
  status: "waiting_employee_confirmation" | "sent" | "failed";
  raw: unknown;
};

export async function getGroupMsgSendResult(params: {
  msgid: string;
  senderUserId: string;
}): Promise<WecomGroupSendResult> {
  const gateway = await gatewayCall<WecomGroupSendResult>("/v1/wecom/messages/status", {
    msgid: params.msgid,
    sender_user_id: params.senderUserId,
  });
  if (gateway) return gateway;
  const json = await callApi("/externalcontact/get_groupmsg_send_result", {
    msgid: params.msgid,
    userid: params.senderUserId,
    limit: 1000,
  });
  if (json?.errcode) throw new Error(`groupmsg_result_failed_${json.errcode}:${json.errmsg ?? ""}`);

  const rows = Array.isArray(json?.send_list) ? json.send_list : [];
  if (!rows.length) return { status: "waiting_employee_confirmation", raw: json };
  const statuses = rows.map((row: { status?: number }) => Number(row.status));
  if (statuses.some((status: number) => status >= 2)) return { status: "failed", raw: json };
  if (statuses.every((status: number) => status === 1)) return { status: "sent", raw: json };
  return { status: "waiting_employee_confirmation", raw: json };
}
