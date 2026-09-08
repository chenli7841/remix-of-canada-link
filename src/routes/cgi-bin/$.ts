import { createFileRoute } from "@tanstack/react-router";

import { proxyHandlers } from "@/lib/reverse-proxy";

/**
 * 透明反向代理：
 *   https://shopper.epluscanada.com/cgi-bin/*
 *     -> https://qyapi.weixin.qq.com/cgi-bin/*
 */
export const Route = createFileRoute("/cgi-bin/$")({
  server: {
    handlers: proxyHandlers("https://qyapi.weixin.qq.com/cgi-bin"),
  },
});
