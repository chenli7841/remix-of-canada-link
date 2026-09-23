import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

// Execute the real handlers and cryptographic helpers; only the database is mocked.
// No environment file, network request, or real payment is used.
const env = {
  OTTPAY_APP_ID: "test-app", OTTPAY_APP_KEY: "test-app-key",
  OTTPAY_MERCHANT_ID: "test-merchant", OTTPAY_SIGN_KEY: "test-sign-key",
};
function load(path, deps = {}) {
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
  });
  return exports;
}
const wallet = load("src/lib/ottpay.server.ts");
const card = load("src/lib/ottpay-hosted.server.ts");

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
    for (const status of ["processing", "init", "unknown", ""]) {
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
