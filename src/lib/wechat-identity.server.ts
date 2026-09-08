// 微信 / 企业微信 身份 -> EPLUS 客户 的唯一解析入口。
// 所有 AI 客服接口（查询、录单）都必须经过这里拿 customer_code，
// 绝不允许请求方（大模型 / 聊天内容）直接指定 customer_code。

export type WechatIdentity = {
  visitor_biz_id?: string | null;
  external_userid?: string | null;
  chat_id?: string | null;
  /** 仅作为辅助信息记录，不参与解析 */
  group_name?: string | null;
};

export type ResolveResult = {
  found: boolean;
  result_code:
    | "customer_resolved"
    | "customer_not_bound"
    | "customer_not_found"
    | "ambiguous_customer"
    | "invalid_channel_identity";
  customer_code: string | null;
  user_id: string | null;
  customer_display_name: string | null;
  binding_source: string | null;
  verified: boolean;
  message: string;
};

// 客户姓名脱敏：张三 -> 张*，Jason Li -> J***
export function maskName(name: string): string {
  const s = String(name ?? "").trim();
  if (!s) return "";
  if (/^[\u4e00-\u9fa5]+$/.test(s)) return s[0] + "*".repeat(Math.max(s.length - 1, 1));
  return s[0] + "*".repeat(Math.max(s.length - 1, 3));
}

const clean = (v: unknown) => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s.length ? s : null;
};

export async function resolveWechatCustomer(admin: any, raw: WechatIdentity): Promise<ResolveResult> {
  const chatId = clean(raw.chat_id);
  const externalUserid = clean(raw.external_userid);
  const visitorBizId = clean(raw.visitor_biz_id);

  const base = {
    found: false,
    customer_code: null,
    user_id: null,
    customer_display_name: null,
    binding_source: null,
    verified: false,
  };

  if (!chatId && !externalUserid && !visitorBizId) {
    return {
      ...base,
      result_code: "invalid_channel_identity",
      message: "缺少可用的渠道身份（chat_id / external_userid / visitor_biz_id 至少一个）",
    };
  }

  // 群聊优先 chat_id，其次单聊 external_userid，最后 ADP visitor_biz_id。
  // 群名称、备注永远不参与这一步（可被改名 / 重名）。
  const ors: string[] = [];
  if (chatId) ors.push(`chat_id.eq.${chatId}`);
  if (externalUserid) ors.push(`external_userid.eq.${externalUserid}`);
  if (visitorBizId) ors.push(`visitor_biz_id.eq.${visitorBizId}`);

  const { data: rows, error } = await admin
    .from("wechat_identity_bindings")
    .select("id, channel_type, visitor_biz_id, external_userid, chat_id, customer_code, user_id, binding_source, verified, status")
    .or(ors.join(","));
  if (error) {
    return { ...base, result_code: "customer_not_bound", message: "绑定查询失败，请稍后重试" };
  }

  // 仅承认有效（未被后台停用/解绑）的永久绑定
  const list = ((rows ?? []) as any[]).filter((r) => (r.status ?? "active") === "active");
  if (!list.length) {
    return {
      ...base,
      result_code: "customer_not_bound",
      message: "该微信身份尚未绑定 EPLUS 客户，请客户登录网站「个人资料」生成一次性绑定码后在会话中回复",
    };
  }

  // 一个身份只能对应一个客户；出现多个不同客户号即为歧义，禁止自动录单。
  const distinct = Array.from(new Set(list.map((r) => String(r.customer_code))));
  if (distinct.length > 1) {
    return {
      ...base,
      result_code: "ambiguous_customer",
      message: `该会话关联了多个客户号（${distinct.join("、")}），请人工客服确认后再录单`,
    };
  }

  // 优先级取值（chat_id > external_userid > visitor_biz_id）
  const picked =
    (chatId && list.find((r) => r.chat_id === chatId)) ||
    (externalUserid && list.find((r) => r.external_userid === externalUserid)) ||
    list[0];

  // customer_code 必须在真实客户表中存在
  const { data: profile } = await admin
    .from("profiles")
    .select("id, customer_code, full_name, email")
    .eq("customer_code", picked.customer_code)
    .maybeSingle();
  if (!profile?.id || profile.id !== picked.user_id) {
    return {
      ...base,
      result_code: "customer_not_found",
      message: "绑定的客户号在系统中不存在或已变更，请联系人工客服",
    };
  }

  await admin
    .from("wechat_identity_bindings")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", picked.id);

  return {
    found: true,
    result_code: "customer_resolved",
    customer_code: String(profile.customer_code),
    user_id: String(profile.id),
    customer_display_name: maskName(profile.full_name || profile.customer_code),
    binding_source: picked.chat_id === chatId && chatId ? "chat_id" : picked.external_userid === externalUserid && externalUserid ? "external_userid" : "visitor_biz_id",
    verified: Boolean(picked.verified),
    message: "已解析到客户",
  };
}
