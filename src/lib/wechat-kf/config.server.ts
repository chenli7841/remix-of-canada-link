/**
 * 微信客服本地快速通道配置。
 * 所有密钥只在服务端函数内读取，绝不写入日志或返回给客户端。
 */

export type KfConfig = {
  corpId: string;
  secret: string;
  token: string;
  aesKey: string;
};

export function kfConfig(): KfConfig {
  const corpId = process.env["WECOM_CORP_ID"] ?? "";
  const secret = process.env["WECOM_KF_SECRET"] ?? "";
  const token = process.env["WECOM_KF_TOKEN"] ?? "";
  const aesKey = process.env["WECOM_KF_AES_KEY"] ?? "";
  return { corpId, secret, token, aesKey };
}

export function kfConfigured(c: KfConfig = kfConfig()): boolean {
  return Boolean(c.corpId && c.secret && c.token && c.aesKey);
}

/** 总开关：默认关闭，设为 "1"/"true" 才启用本地快速通道（回滚只需改回 0） */
export function kfEnabled(): boolean {
  const v = (process.env["WXKF_FAST_PATH_ENABLED"] ?? "").toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/** 测试模式白名单：逗号分隔的 external_userid，非空时只处理名单内客户，其余转 ADP */
export function kfTestUsers(): string[] {
  return (process.env["WXKF_FAST_PATH_TEST_USERS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}


export function ocrConfig() {
  return {
    secretId: process.env["TENCENT_SECRET_ID"] ?? "",
    secretKey: process.env["TENCENT_SECRET_KEY"] ?? "",
    region: process.env["TENCENT_OCR_REGION"] ?? "ap-guangzhou",
  };
}
