import { createFileRoute } from "@tanstack/react-router";

import { callbackProxyHandlers } from "@/lib/reverse-proxy";

/**
 * 透明反向代理：
 *   https://shopper.epluscanada.com/intl/channel/callback/*
 *     -> https://adp.tencentcloud.com/intl/channel/callback/*
 * GET 同步透传（URL 验证），POST 先回 200 再后台原样转发（微信 5 秒超时）。
 */
export const Route = createFileRoute("/intl/channel/callback/$")({
  server: {
    handlers: callbackProxyHandlers("https://adp.tencentcloud.com/intl/channel/callback"),
  },
});

