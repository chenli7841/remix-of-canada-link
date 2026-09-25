/**
 * EPLUS 群发通知（企业微信客户群发，独立应用 AgentId 1000005）配置。
 * 跟 src/lib/wechat-kf 的客服凭证完全独立——单独的 CorpID/Secret，互不复用。
 * Secret 只在服务端读取，绝不写入日志或返回给客户端。
 */

export type WecomNotifyConfig = {
  corpId: string;
  agentId: string;
  secret: string;
  callbackToken: string;
  callbackAesKey: string;
  apiBaseUrl: string;
  gatewayUrl: string;
  gatewaySharedSecret: string;
};

export function wecomNotifyConfig(): WecomNotifyConfig {
  return {
    corpId: process.env["WECOM_NOTIFY_CORP_ID"] ?? "",
    agentId: process.env["WECOM_NOTIFY_AGENT_ID"] ?? "1000005",
    secret: process.env["WECOM_NOTIFY_SECRET"] ?? "",
    callbackToken: process.env["WECOM_NOTIFY_CALLBACK_TOKEN"] ?? "",
    callbackAesKey: process.env["WECOM_NOTIFY_CALLBACK_AES_KEY"] ?? "",
    apiBaseUrl: (
      process.env["WECOM_API_BASE_URL"] ?? "https://qyapi.weixin.qq.com/cgi-bin"
    ).replace(/\/$/, ""),
    gatewayUrl: (process.env["WECOM_GATEWAY_URL"] ?? "").replace(/\/$/, ""),
    gatewaySharedSecret: process.env["WECOM_GATEWAY_SHARED_SECRET"] ?? "",
  };
}

export function wecomNotifyCallbackConfigured(c: WecomNotifyConfig = wecomNotifyConfig()): boolean {
  return Boolean(c.corpId && c.callbackToken && c.callbackAesKey);
}

export function wecomNotifyConfigured(c: WecomNotifyConfig = wecomNotifyConfig()): boolean {
  return Boolean(
    (c.gatewayUrl && c.gatewaySharedSecret) ||
    (c.corpId && c.agentId && c.secret),
  );
}

/**
 * 总开关，默认关闭。在企业微信完成应用授权 + 可信出口 IP 白名单联调之前，
 * 必须保持 false——为 false 时，同步群列表 / 真实发送一律拒绝执行，
 * 只允许本地的绑定管理和发送预览（预览不调用企业微信任何接口）。
 */
export function wecomNotifyEnabled(): boolean {
  const v = (process.env["WECOM_ENABLED"] ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
