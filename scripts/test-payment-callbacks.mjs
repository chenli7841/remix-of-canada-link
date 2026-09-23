import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";
import { createRequire } from "node:module";

const requireQr = createRequire(import.meta.url);

test("Payment QR renders without loading pngjs, zlib, or stream", () => {
  const loaded = Object.keys(requireQr.cache);
  assert.ok(!loaded.some((path) => /[\\/]pngjs[\\/]/.test(path)));
  for (const text of ["weixin://wxpay/bizpayurl?pr=TEST123", "https://example.com/pay?x=1&y=中文"]) {
    const url = paymentQr.paymentQrDataUrl(text);
    assert.ok(url.startsWith("data:image/svg+xml;charset=utf-8,"));
    const svg = decodeURIComponent(url.split(",")[1]);
    assert.match(svg, /<svg[^>]+width="320"/);
    assert.match(svg, /<path[^>]+stroke="#000000"/);
    assert.ok(!svg.includes(text), "Payload must be encoded as QR modules, not interpolated into SVG");
  }
});

test("Payment QR works for new orders, retries, and concurrent duplicate orders", async () => {
  for (const scenario of ["new", "retry", "concurrent"]) {
    let requests = 0;
    const payInfo = "weixin://wxpay/bizpayurl?pr=TEST123";
    const prior = { ref_no: "TEST", status: "pending", provider_payment_id: "pid", pay_session: { mode: "qr", pay_info: payInfo } };
    const query = {
      select() { return this; }, eq() { return this; }, order() { return this; },
      limit() { return this; }, gte() { return this; },
      then(resolve) { resolve({ data: scenario === "retry" ? [prior] : [] }); },
      async maybeSingle() { return { data: prior }; },
      async insert() { return { error: scenario === "concurrent" ? { code: "23505" } : null }; },
    };
    const api = load("src/lib/ottpay.functions.ts", {
      "@tanstack/react-start": { createServerFn: () => ({
        middleware() { return this; }, inputValidator() { return this; }, handler(fn) { return fn; },
      }) },
      "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
      "@/integrations/supabase/client.server": { supabaseAdmin: { from: () => query } },
      "@/lib/orders.functions": { getFxCadPerCny: async () => 0.2 },
      "@/lib/ottpay.server": { ...wallet, ottPost: async () => { requests++; return { payInfo, paymentId: "pid" }; } },
      "@tanstack/react-start/server": { getRequestHeader: () => "Desktop" },
      "@/lib/payment-qr.server": paymentQr,
    });
    const result = await api.startOttTopup({ data: { amountCad: 2, channel: "wechat", device: "desktop", idempotencyKey: "test" }, context: { userId: "user" } });
    assert.equal(result.mode, "qr");
    assert.equal(result.qrDataUrl, paymentQr.paymentQrDataUrl(payInfo));
    assert.equal(requests, scenario === "retry" ? 0 : 1);
  }
});

// Execute the real handlers and cryptographic helpers; only the database is mocked.
// No environment file, network request, or real payment is used.
const env = {
  OTTPAY_APP_ID: "test-app", OTTPAY_APP_KEY: "test-app-key",
  OTTPAY_MERCHANT_ID: "test-merchant", OTTPAY_SIGN_KEY: "test-sign-key",
};
function load(path, deps = {}, runtime = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports, Buffer, Request, Response, process: { env }, console: { warn() {}, error() {} },
    require(id) {
      if (id === "crypto") return crypto;
      if (!(id in deps)) throw new Error(`Unexpected dependency: ${id}`);
      return deps[id];
    },
    ...runtime,
  });
  return exports;
}
const wallet = load("src/lib/ottpay.server.ts");
const card = load("src/lib/ottpay-hosted.server.ts");
const paymentQr = load("src/lib/payment-qr.server.ts", {
  "qrcode/lib/core/qrcode.js": requireQr("qrcode/lib/core/qrcode.js"),
  "qrcode/lib/renderer/svg-tag.js": requireQr("qrcode/lib/renderer/svg-tag.js"),
});

test("Hosted encryption supports runtimes requiring a Buffer IV and preserves ECB ciphertext", () => {
  const strictCrypto = {
    ...crypto,
    createCipheriv(algorithm, key, iv) {
      assert.ok(Buffer.isBuffer(iv), "Deployment runtime requires a Buffer IV");
      assert.equal(iv.length, 0, "ECB must use an empty IV");
      return crypto.createCipheriv(algorithm, key, iv);
    },
  };
  const api = load("src/lib/ottpay-hosted.server.ts", {}, {
    require: (id) => { assert.equal(id, "crypto"); return strictCrypto; },
  });
  const data = { orderId: "TEST", txnAmt: "200", merchant_id: "test-merchant" };
  const encrypted = api.encryptHosted(data);
  const key = crypto.createHash("md5").update(encrypted.md5 + env.OTTPAY_SIGN_KEY)
    .digest("hex").toUpperCase().slice(8, 24);
  const legacy = crypto.createCipheriv("aes-128-ecb", Buffer.from(key), null);
  const expected = Buffer.concat([legacy.update(JSON.stringify(data), "utf8"), legacy.final()]).toString("base64");
  assert.equal(encrypted.data, expected);
  assert.equal(JSON.stringify(api.decryptHosted(encrypted)), JSON.stringify(data));
});

test("CMP only settles captured funds with matching identity and amount", async () => {
  const tx = { id: "tx", ref_no: "TEST", amount_cad: 2, provider_payment_id: "pid", note: null };
  const valid = { paymentStatus: "success", stateCode: "P00003", paymentId: "pid", reference: "TEST", totalAmount: "200" };
  for (const [patch, decision] of [
    [{}, "settle"],
    [{ paymentStatus: "authorized", stateCode: "P00002" }, "pending"],
    [{ stateCode: "P00012" }, "refund"],
    [{ stateCode: "P00016" }, "refund"],
    [{ totalAmount: undefined }, "mismatch"],
    [{ totalAmount: "0" }, "mismatch"],
    [{ totalAmount: "201" }, "mismatch"],
    [{ totalAmount: "NaN" }, "mismatch"],
    [{ paymentId: "other" }, "mismatch"],
    [{ reference: "other" }, "mismatch"],
    [{ paymentStatus: "authorized" }, "pending"],
  ]) {
    const api = load("src/lib/ottpay-reconcile.server.ts", {
      "@/lib/ottpay.server": { ottPost: async () => ({ ...valid, ...patch }) },
    });
    assert.equal((await api.verifyOttRecharge(tx)).decision, decision, JSON.stringify(patch));
  }
  const api = load("src/lib/ottpay-reconcile.server.ts", {
    "@/lib/ottpay.server": { ottPost: async () => ({ ...valid, reference: null }) },
  });
  assert.equal((await api.verifyOttRecharge({ ...tx, provider_payment_id: null })).decision, "mismatch");
});

test("OTT nested authorization codes are explained without exposing the response", async () => {
  for (const code of [10003, 10005, 20004]) {
    const api = load("src/lib/ottpay.server.ts", {}, {
      fetch: async () => new Response(JSON.stringify({ status: "ERROR", result: {
        code, errorMessage: "DO_NOT_EXPOSE_SECRET", token: "DO_NOT_EXPOSE_TOKEN",
      } }), { status: 400 }),
    });
    await assert.rejects(api.ottToken(), (error) => {
      assert.match(error.message, new RegExp(`代码 ${code}`));
      assert.doesNotMatch(error.message, /DO_NOT_EXPOSE/);
      return true;
    });
  }
});

test("Hosted polling verifies identity and amount before writing and propagates write errors", async () => {
  for (const scenario of ["valid", "authorized", "wrong-order", "wrong-amount", "missing-amount", "db-error"]) {
    let writes = 0;
    const response = { order_status: "success", order_id: "TEST", total_amount: "200" };
    if (scenario === "authorized") response.order_status = "authorized";
    if (scenario === "wrong-order") response.order_id = "OTHER";
    if (scenario === "wrong-amount") response.total_amount = "201";
    if (scenario === "missing-amount") delete response.total_amount;
    const query = {
      select() { return this; }, eq() { return this; },
      async maybeSingle() { return { data: { id: "tx", status: "pending", amount_cad: 2, note: "hosted=1" } }; },
      update() { writes++; return this; },
      then(resolve) { resolve({ error: scenario === "db-error" ? { message: "offline" } : null }); },
    };
    const api = load("src/lib/ottpay.functions.ts", {
      "@tanstack/react-start": { createServerFn: () => ({
        middleware() { return this; }, inputValidator() { return this; }, handler(fn) { return fn; },
      }) },
      "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
      "@/integrations/supabase/client.server": { supabaseAdmin: { from: () => query } },
      "@/lib/ottpay-hosted.server": { ...card, hostedPost: async () => response },
    });
    const run = () => api.syncOttTopup({ data: { reference: "TEST" }, context: { userId: "user" } });
    if (scenario === "valid") assert.equal((await run()).status, "completed");
    else if (scenario === "authorized") assert.equal((await run()).status, "pending");
    else await assert.rejects(run(), /不匹配|保存失败/);
    assert.equal(writes, ["valid", "db-error"].includes(scenario) ? 1 : 0, scenario);
  }
});

test("OTT trims copied credentials and caches a successful token", async () => {
  let calls = 0;
  const api = load("src/lib/ottpay.server.ts", {}, {
    process: { env: { ...env, OTTPAY_APP_ID: " test-app\n", OTTPAY_APP_KEY: " test-app-key\r\n" } },
    fetch: async (url, options) => {
      calls++;
      assert.equal(url, "https://ecom-api.ottpay.com/api/v1/auth/token");
      assert.deepEqual(JSON.parse(options.body), { appId: "test-app", appKey: "test-app-key" });
      return Response.json({ status: "SUCCESS", result: { token: "test-token", expired: Date.now() + 600000 } });
    },
  });
  assert.equal(await api.ottToken(), "test-token");
  assert.equal(await api.ottToken(), "test-token");
  assert.equal(calls, 1);
});

test("OTT blank credentials fail before making a request", async () => {
  const api = load("src/lib/ottpay.server.ts", {}, {
    process: { env: { ...env, OTTPAY_APP_KEY: " \n" } },
    fetch: () => { assert.fail("No request should be sent"); },
  });
  await assert.rejects(api.ottToken(), /未配置/);
});

test("OTT non-JSON errors retain HTTP status without disclosing raw response", async () => {
  const api = load("src/lib/ottpay.server.ts", {}, {
    fetch: async () => new Response("<html>DO_NOT_EXPOSE</html>", { status: 502 }),
  });
  await assert.rejects(api.ottToken(), (error) => {
    assert.match(error.message, /HTTP 502/);
    assert.doesNotMatch(error.message, /DO_NOT_EXPOSE/);
    return true;
  });
});

function fixture(channel) {
  const state = {
    row: { id: "test-tx", status: "pending", amount_cad: 2, provider_payment_id: null },
    readError: null, updateError: null, credits: 0,
  };
  const db = { from(table) {
    assert.equal(table, "wallet_transactions");
    let patch;
    const filters = [];
    const query = {
      select() { return query; },
      eq(key, value) { filters.push([key, value]); return query; },
      async maybeSingle() { return { data: state.row && { ...state.row }, error: state.readError }; },
      update(value) { patch = value; return query; },
      then(resolve) {
        if (!state.updateError && state.row && filters.every(([key, value]) => state.row[key] === value)) {
          if (patch.status === "completed" && state.row.status !== "completed") state.credits++;
          Object.assign(state.row, patch);
        }
        resolve({ error: state.updateError });
      },
    };
    return query;
  } };
  const { Route } = load(`src/routes/api/public/hooks/${channel}.ts`, {
    "@tanstack/react-router": { createFileRoute: () => (route) => route },
    "@/integrations/supabase/client.server": { supabaseAdmin: db },
    "@/lib/ottpay.server": wallet,
    "@/lib/ottpay-hosted.server": card,
  });
  const send = async (info = {}, format = "json", tamper = false) => {
    const payload = card.encryptHosted({
      reference: "TEST", order_id: "TEST", order_status: "success", amount: "200", ...info,
    });
    if (tamper) payload.md5 = "0".repeat(32);
    let body, headers;
    if (format === "form") {
      body = new URLSearchParams(payload);
    } else if (format === "multipart") {
      body = new FormData();
      for (const [key, value] of Object.entries(payload)) body.set(key, value);
    } else {
      headers = { "content-type": "application/json" };
      body = format === "malformed" ? "{" : JSON.stringify(payload);
    }
    return Route.server.handlers.POST({ request: new Request("https://test.invalid/callback", {
      method: "POST", headers, body,
    }) });
  };
  return { state, send };
}

for (const channel of ["ottpay", "ottpay-card"]) {
  for (const format of ["json", "form", "multipart"]) {
    test(`${channel}: ${format} signed callback completes once`, async () => {
      const { state, send } = fixture(channel);
      assert.equal((await send({}, format)).status, 200);
      assert.equal(state.row.status, "completed");
      assert.equal((await send({}, format)).status, 200);
      assert.equal(state.credits, 1);
    });
  }
  test(`${channel}: processing and unknown notifications allow later success`, async () => {
    const { state, send } = fixture(channel);
    for (const status of ["processing", "init", "authorized", "authorised", "unknown", ""]) {
      assert.equal((await send({ order_status: status })).status, 200);
      assert.equal(state.row.status, "pending");
    }
    await send();
    assert.equal(state.row.status, "completed");
    assert.equal(state.credits, 1);
  });
  test(`${channel}: explicit failure never credits`, async () => {
    const { state, send } = fixture(channel);
    await send({ order_status: "failure" });
    assert.equal(state.row.status, "failed");
    assert.equal(state.credits, 0);
  });
  test(`${channel}: invalid or mismatched amounts never credit`, async () => {
    for (const amount of ["", "NaN", "Infinity", "0", "-200", "200.5", "199", "201", "300"]) {
      const { state, send } = fixture(channel);
      await send({ amount });
      assert.equal(state.row.status, "pending", amount);
      assert.equal(state.credits, 0);
    }
  });
  test(`${channel}: malformed payload and tampered signature rejected`, async () => {
    const { state, send } = fixture(channel);
    assert.equal((await send({}, "malformed")).status, 400);
    assert.equal((await send({}, "json", true)).status, 401);
    assert.equal(state.credits, 0);
  });
  test(`${channel}: database read failure and missing row request retry`, async () => {
    const { state, send } = fixture(channel);
    state.readError = { message: "offline" };
    assert.equal((await send()).status, 503);
    state.readError = null;
    state.row = null;
    assert.equal((await send()).status, 503);
    assert.equal(state.credits, 0);
  });
  test(`${channel}: failed database write can retry successfully`, async () => {
    const { state, send } = fixture(channel);
    state.updateError = { message: "offline" };
    assert.equal((await send()).status, 503);
    assert.equal(state.row.status, "pending");
    state.updateError = null;
    assert.equal((await send()).status, 200);
    assert.equal(state.credits, 1);
  });
  test(`${channel}: concurrent callbacks credit once`, async () => {
    const { state, send } = fixture(channel);
    const responses = await Promise.all([send(), send()]);
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal(state.credits, 1);
  });
}
