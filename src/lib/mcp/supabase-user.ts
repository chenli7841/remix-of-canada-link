import { createClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

export function supabaseForUser(ctx: ToolContext) {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error("Supabase MCP configuration is missing");
  }

  return createClient(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function unauthenticatedResult() {
  return {
    content: [{ type: "text" as const, text: "当前未连接有效的 EPLUS 账号，请重新连接后再操作。" }],
    structuredContent: { reason: "AUTH_REQUIRED" },
    isError: true,
  };
}

export { queryFailedResult } from "./errors";

export function permissionDeniedResult() {
  return {
    content: [{ type: "text" as const, text: "没有权限" }],
    structuredContent: { reason: "PERMISSION_DENIED" },
    isError: true,
  };
}

export function isPermissionError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "42501" || message.includes("access required") || message.includes("forbidden") || message.includes("permission");
}
