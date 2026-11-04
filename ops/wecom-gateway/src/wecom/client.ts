export type FetchLike = typeof fetch;

export type WecomClientOptions = {
  corpId: string;
  secret: string;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
};

export type WecomGroup = {
  chatId: string;
  name: string;
  ownerUserId: string | null;
  memberCount: number;
  externalMembers?: Array<{ externalUserId: string; displayName: string }>;
};

export type GroupMessageResult = {
  status: "waiting_employee_confirmation" | "sent" | "failed";
  raw: unknown;
};

export type GroupMessageImage = { name: string; base64: string };

type TokenCache = { value: string; expiresAtMs: number } | null;

export class WecomApiError extends Error {
  constructor(
    public readonly operation: string,
    public readonly errcode: number,
    public readonly errmsg: string,
  ) {
    super(`${operation} failed (${errcode}): ${errmsg}`);
    this.name = "WecomApiError";
  }
}

export class WecomClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;
  private tokenCache: TokenCache = null;

  constructor(private readonly options: WecomClientOptions) {
    if (!options.corpId || !options.secret) throw new Error("WeCom corpId and secret are required");
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://qyapi.weixin.qq.com/cgi-bin").replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async testConnection(): Promise<void> {
    await this.getAccessToken(true);
  }

  async getAccessToken(forceRefresh = false): Promise<string> {
    const nowMs = this.now();
    if (!forceRefresh && this.tokenCache && this.tokenCache.expiresAtMs > nowMs) {
      return this.tokenCache.value;
    }
    const url = new URL(`${this.apiBaseUrl}/gettoken`);
    url.searchParams.set("corpid", this.options.corpId);
    url.searchParams.set("corpsecret", this.options.secret);
    const response = await this.fetchImpl(url, { method: "GET" });
    if (!response.ok) throw new Error(`gettoken HTTP ${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    this.assertSuccess("gettoken", body);
    const token = String(body.access_token ?? "");
    if (!token) throw new Error("gettoken response did not include access_token");
    const expiresInSeconds = Math.max(Number(body.expires_in ?? 7200) - 300, 60);
    this.tokenCache = { value: token, expiresAtMs: nowMs + expiresInSeconds * 1000 };
    return token;
  }

  async listExternalGroups(): Promise<WecomGroup[]> {
    const groups: WecomGroup[] = [];
    let cursor = "";
    for (let page = 0; page < 50; page += 1) {
      const list = await this.call("groupchat_list", "/externalcontact/groupchat/list", {
        status_filter: 0,
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      const rows = Array.isArray(list.group_chat_list) ? list.group_chat_list : [];
      for (const row of rows as Array<Record<string, unknown>>) {
        const chatId = String(row.chat_id ?? "");
        if (chatId) groups.push({ chatId, name: "", ownerUserId: null, memberCount: 0 });
      }
      cursor = String(list.next_cursor ?? "");
      if (!cursor) break;
    }
    return groups;
  }

  async getExternalGroupDetails(chatIds: string[]): Promise<WecomGroup[]> {
    const groups: WecomGroup[] = [];
    const concurrency = 10;
    for (let index = 0; index < chatIds.length; index += concurrency) {
      const batch = chatIds.slice(index, index + concurrency);
      const details = await Promise.all(
        batch.map(async (chatId) => {
          try {
            const detail = await this.call("groupchat_get", "/externalcontact/groupchat/get", {
              chat_id: chatId,
              need_name: 1,
            });
            const chat = (detail.group_chat ?? {}) as Record<string, unknown>;
            const members = Array.isArray(chat.member_list)
              ? (chat.member_list as Array<Record<string, unknown>>)
              : [];
            const memberCount = members.length;
            const group: WecomGroup = {
              chatId,
              name: String(chat.name ?? ""),
              ownerUserId: null,
              memberCount,
              externalMembers:
                memberCount <= 15
                  ? members
                      .filter((member) => Number(member.type) === 2 && member.userid)
                      .map((member) => ({
                        externalUserId: String(member.userid),
                        displayName: String(member.name ?? member.group_nickname ?? ""),
                      }))
                  : [],
            };
            return group;
          } catch {
            return null;
          }
        }),
      );
      groups.push(...details.filter((group): group is WecomGroup => group !== null));
    }
    return groups;
  }

  async createGroupMessage(params: {
    senderUserId: string;
    chatIds: string[];
    content: string;
  }): Promise<{ msgid: string }> {
    if (!params.senderUserId || !params.chatIds.length || !params.content.trim()) {
      throw new Error("senderUserId, chatIds and content are required");
    }
    const result = await this.call("add_msg_template", "/externalcontact/add_msg_template", {
      chat_type: "group",
      sender: params.senderUserId,
      chat_id_list: params.chatIds,
      text: { content: params.content },
    });
    const msgid = String(result.msgid ?? "");
    if (!msgid) throw new Error("add_msg_template response did not include msgid");
    return { msgid };
  }

  async createGroupMessageWithImages(params: {
    senderUserId: string;
    chatIds: string[];
    content: string;
    images: GroupMessageImage[];
  }): Promise<{ msgid: string }> {
    if (!params.senderUserId || !params.chatIds.length || !params.content.trim()) {
      throw new Error("senderUserId, chatIds and content are required");
    }
    if (!params.images.length || params.images.length > 9) throw new Error("images_count_invalid");
    const attachments = [];
    for (const image of params.images) {
      const mediaId = await this.uploadImage(image);
      attachments.push({ msgtype: "image", image: { media_id: mediaId } });
    }
    const result = await this.call("add_msg_template", "/externalcontact/add_msg_template", {
      chat_type: "group",
      sender: params.senderUserId,
      chat_id_list: params.chatIds,
      text: { content: params.content },
      attachments,
    });
    const msgid = String(result.msgid ?? "");
    if (!msgid) throw new Error("add_msg_template response did not include msgid");
    return { msgid };
  }

  private async uploadImage(image: GroupMessageImage, allowTokenRetry = true): Promise<string> {
    const bytes = Buffer.from(image.base64, "base64");
    if (bytes.length < 4 || bytes.length > 2 * 1024 * 1024 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
      throw new Error("image_invalid_or_too_large");
    }
    const token = await this.getAccessToken();
    const url = new URL(`${this.apiBaseUrl}/media/upload`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("type", "image");
    const form = new FormData();
    form.append("media", new Blob([bytes], { type: "image/jpeg" }), image.name.replace(/[^\w.-]+/g, "_") || "image.jpg");
    const response = await this.fetchImpl(url, { method: "POST", body: form, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error(`media_upload HTTP ${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    const errcode = Number(body.errcode ?? 0);
    if (allowTokenRetry && (errcode === 40014 || errcode === 42001)) {
      await this.getAccessToken(true);
      return this.uploadImage(image, false);
    }
    this.assertSuccess("media_upload", body);
    const mediaId = String(body.media_id ?? "");
    if (!mediaId) throw new Error("media_upload response did not include media_id");
    return mediaId;
  }

  async getGroupMessageResult(params: {
    msgid: string;
    senderUserId: string;
  }): Promise<GroupMessageResult> {
    const result = await this.call(
      "get_groupmsg_send_result",
      "/externalcontact/get_groupmsg_send_result",
      { msgid: params.msgid, userid: params.senderUserId, limit: 1000 },
    );
    const rows = Array.isArray(result.send_list) ? result.send_list : [];
    if (!rows.length) return { status: "waiting_employee_confirmation", raw: result };
    const statuses = (rows as Array<{ status?: number }>).map((row) => Number(row.status));
    if (statuses.some((status) => status >= 2)) return { status: "failed", raw: result };
    if (statuses.every((status) => status === 1)) return { status: "sent", raw: result };
    return { status: "waiting_employee_confirmation", raw: result };
  }

  private async call(
    operation: string,
    path: string,
    payload: unknown,
    allowTokenRetry = true,
  ): Promise<Record<string, unknown>> {
    const token = await this.getAccessToken();
    const url = new URL(`${this.apiBaseUrl}${path}`);
    url.searchParams.set("access_token", token);
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`${operation} HTTP ${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    const errcode = Number(body.errcode ?? 0);
    if (allowTokenRetry && (errcode === 40014 || errcode === 42001)) {
      await this.getAccessToken(true);
      return this.call(operation, path, payload, false);
    }
    this.assertSuccess(operation, body);
    return body;
  }

  private assertSuccess(operation: string, body: Record<string, unknown>): void {
    const errcode = Number(body.errcode ?? 0);
    if (errcode !== 0) {
      throw new WecomApiError(operation, errcode, String(body.errmsg ?? "unknown error"));
    }
  }
}

