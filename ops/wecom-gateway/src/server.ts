import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { createShopperAuth } from "./security/auth.js";
import { IdempotencyStore } from "./idempotency-store.js";
import { WecomApiError, WecomClient } from "./wecom/client.js";
import { decryptCallback, extractEncryptedXml, verifyCallbackSignature } from "./wecom/callback-crypto.js";

type WecomService = Pick<
  WecomClient,
  "testConnection" | "listExternalGroups" | "getExternalGroupDetails" | "createGroupMessage" | "createGroupMessageWithImages" | "getGroupMessageResult"
>;

type BuildServerOptions = {
  shopperSharedSecret?: string;
  now?: () => number;
  wecomClient?: WecomService;
  allowMessageCreation?: boolean;
};

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name}_required`);
  return value.trim();
}

export function buildServer(options?: BuildServerOptions) {
  const config = loadConfig();
  let wecomClient = options?.wecomClient;
  const getWecomClient = (): WecomService => {
    if (!wecomClient) {
      wecomClient = new WecomClient({
        corpId: config.wecomCorpId,
        secret: config.wecomSecret,
        apiBaseUrl: config.wecomApiBaseUrl,
      });
    }
    return wecomClient;
  };
  const idempotency = new IdempotencyStore<{ msgid: string }>();
  const shopperAuth = createShopperAuth({
    sharedSecret: options?.shopperSharedSecret ?? config.shopperSharedSecret,
    now: options?.now,
  });
  const app = Fastify({
    bodyLimit: 26 * 1024 * 1024,
    logger: {
      level: process.env.LOG_LEVEL || "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.x-eplus-signature",
          "res.headers.set-cookie",
        ],
        censor: "[REDACTED]",
      },
    },
  });

  app.decorateRequest("rawBody", "");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      request.rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (error) {
        done(error as Error);
      }
    },
  );
  app.addContentTypeParser(["application/xml", "text/xml"], { parseAs: "string" }, (request, body, done) => {
    request.rawBody = body as string;
    done(null, body);
  });

  app.get("/health", async () => ({
    ok: true,
    service: "eplus-wecom-gateway",
    version: "0.1.0",
    time: new Date().toISOString(),
  }));

  app.get("/wecom/callback", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    const timestamp = query.timestamp ?? "";
    const nonce = query.nonce ?? "";
    const encrypted = query.echostr ?? "";
    const signature = query.msg_signature ?? "";
    if (!config.wecomCallbackToken || !config.wecomCallbackAesKey || !config.wecomCorpId) {
      return reply.code(503).send("callback_not_configured");
    }
    if (!verifyCallbackSignature({ token: config.wecomCallbackToken, timestamp, nonce, encrypted, signature })) {
      return reply.code(401).send("invalid_signature");
    }
    try {
      const echo = decryptCallback(encrypted, config.wecomCallbackAesKey, config.wecomCorpId);
      return reply.type("text/plain; charset=utf-8").send(echo);
    } catch {
      return reply.code(400).send("invalid_callback_payload");
    }
  });

  app.post("/wecom/callback", async (request, reply) => {
    const query = request.query as Record<string, string | undefined>;
    try {
      const encrypted = extractEncryptedXml(String(request.body ?? ""));
      const valid = verifyCallbackSignature({
        token: config.wecomCallbackToken,
        timestamp: query.timestamp ?? "",
        nonce: query.nonce ?? "",
        encrypted,
        signature: query.msg_signature ?? "",
      });
      if (!valid) return reply.code(401).send("invalid_signature");
      const eventXml = decryptCallback(encrypted, config.wecomCallbackAesKey, config.wecomCorpId);
      app.log.info({ callbackBytes: Buffer.byteLength(eventXml) }, "wecom_callback_received");
      return reply.type("text/plain; charset=utf-8").send("success");
    } catch {
      return reply.code(400).send("invalid_callback_payload");
    }
  });

  app.post(
    "/v1/ping",
    {
      preHandler: shopperAuth,
    },
    async () => ({ ok: true, authenticated: true }),
  );

  app.post("/v1/wecom/test", { preHandler: shopperAuth }, async () => {
    await getWecomClient().testConnection();
    return { ok: true, connected: true };
  });

  app.post("/v1/wecom/groups/sync", { preHandler: shopperAuth }, async () => {
    const groups = await getWecomClient().listExternalGroups();
    return { ok: true, groups, count: groups.length };
  });

  app.post("/v1/wecom/groups/details", { preHandler: shopperAuth }, async (request) => {
    const body = request.body as Record<string, unknown>;
    const chatIds = Array.isArray(body?.chat_ids)
      ? body.chat_ids.filter((value): value is string => typeof value === "string" && !!value.trim()).slice(0, 50)
      : [];
    if (!chatIds.length) throw new Error("chat_ids_required");
    const groups = await getWecomClient().getExternalGroupDetails(chatIds);
    return { ok: true, groups, count: groups.length };
  });

  app.post("/v1/wecom/messages", { preHandler: shopperAuth }, async (request, reply) => {
    if (!(options?.allowMessageCreation ?? config.wecomSendEnabled)) {
      return reply.code(403).send({ ok: false, error: "wecom_sending_disabled" });
    }
    try {
      const body = request.body as Record<string, unknown>;
      const requestId = requiredString(body?.request_id, "request_id");
      const senderUserId = requiredString(body?.sender_user_id, "sender_user_id");
      const content = requiredString(body?.content, "content");
      const chatIds = Array.isArray(body?.chat_ids)
        ? body.chat_ids.filter((value): value is string => typeof value === "string" && !!value.trim())
        : [];
      if (!chatIds.length) throw new Error("chat_ids_required");

      const existing = idempotency.get(requestId);
      if (existing) return { ok: true, ...existing, duplicate: true };
      const created = await getWecomClient().createGroupMessage({ senderUserId, chatIds, content });
      idempotency.set(requestId, created);
      return reply.code(201).send({ ok: true, ...created, duplicate: false });
    } catch (error) {
      if (error instanceof WecomApiError) throw error;
      return reply.code(400).send({
        ok: false,
        error: error instanceof Error ? error.message : "invalid_request",
      });
    }
  });

  app.post("/v1/wecom/messages/images", { preHandler: shopperAuth }, async (request, reply) => {
    if (!(options?.allowMessageCreation ?? config.wecomSendEnabled)) {
      return reply.code(403).send({ ok: false, error: "wecom_sending_disabled" });
    }
    try {
      const body = request.body as Record<string, unknown>;
      const requestId = requiredString(body?.request_id, "request_id");
      const senderUserId = requiredString(body?.sender_user_id, "sender_user_id");
      const content = requiredString(body?.content, "content");
      const chatIds = Array.isArray(body?.chat_ids)
        ? body.chat_ids.filter((value): value is string => typeof value === "string" && !!value.trim())
        : [];
      if (!chatIds.length) throw new Error("chat_ids_required");
      const images = Array.isArray(body?.images)
        ? body.images.map((value) => {
            const row = value as Record<string, unknown>;
            return { name: requiredString(row?.name, "image_name"), base64: requiredString(row?.base64, "image_base64") };
          })
        : [];
      if (!images.length || images.length > 9) throw new Error("images_count_invalid");
      const existing = idempotency.get(requestId);
      if (existing) return { ok: true, ...existing, duplicate: true };
      const created = await getWecomClient().createGroupMessageWithImages({ senderUserId, chatIds, content, images });
      idempotency.set(requestId, created);
      return reply.code(201).send({ ok: true, ...created, duplicate: false });
    } catch (error) {
      if (error instanceof WecomApiError) throw error;
      return reply.code(400).send({ ok: false, error: error instanceof Error ? error.message : "invalid_request" });
    }
  });

  app.post("/v1/wecom/messages/status", { preHandler: shopperAuth }, async (request, reply) => {
    try {
      const body = request.body as Record<string, unknown>;
      const msgid = requiredString(body?.msgid, "msgid");
      const senderUserId = requiredString(body?.sender_user_id, "sender_user_id");
      const result = await getWecomClient().getGroupMessageResult({ msgid, senderUserId });
      return { ok: true, ...result };
    } catch (error) {
      if (error instanceof WecomApiError) throw error;
      return reply.code(400).send({
        ok: false,
        error: error instanceof Error ? error.message : "invalid_request",
      });
    }
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof WecomApiError) {
      return reply.code(502).send({
        ok: false,
        error: "wecom_api_error",
        operation: error.operation,
        errcode: error.errcode,
        errmsg: error.errmsg,
      });
    }
    app.log.error(error);
    return reply.code(500).send({ ok: false, error: "internal_server_error" });
  });

  return app;
}

async function main() {
  const config = loadConfig();
  const app = buildServer({
    shopperSharedSecret: config.shopperSharedSecret,
    allowMessageCreation: config.wecomSendEnabled,
  });
  await app.listen({ host: config.host, port: config.port });
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error("gateway_start_failed", error instanceof Error ? error.message : "unknown");
    process.exit(1);
  });
}
