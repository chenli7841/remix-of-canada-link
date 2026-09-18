import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationFiles = [
  "20260828090000_chatgpt_app_forwarding.sql",
  "20260828100000_chatgpt_owner_read_tools.sql",
  "20260828110000_chatgpt_owner_actions.sql",
  "20260828120000_chatgpt_waybill_status.sql",
  "20260830170000_chatgpt_support_messages.sql",
  "20260830173000_route_item_transport_guidance.sql",
  "20260901120000_chatgpt_pending_intake_diagnosis.sql",
];

const sources = [];
for (const file of migrationFiles) {
  const source = await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
  assert.ok(source.trim().length > 0, `${file} must not be empty`);
  sources.push({ file, source });
}

const combined = sources.map(({ source }) => source).join("\n");
const created = [...combined.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]);
const revoked = new Set([...combined.matchAll(/REVOKE ALL ON FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]));
const granted = new Set([...combined.matchAll(/GRANT EXECUTE ON FUNCTION\s+public\.([a-z0-9_]+)\s*\(/gi)].map((m) => m[1]));

assert.equal(new Set(created).size, created.length, "ChatGPT migration function names must be unique");
for (const name of created) {
  if (name === "bump_ai_forwarding_draft_version") continue;
  assert.ok(revoked.has(name), `${name} must revoke PUBLIC/anon execution`);
  assert.ok(granted.has(name), `${name} must grant authenticated execution`);
}

for (const { file, source } of sources) {
  for (const body of source.split(/CREATE OR REPLACE FUNCTION/i).slice(1)) {
    if (/public\.bump_ai_forwarding_draft_version/i.test(body)) continue;
    assert.match(body, /SECURITY DEFINER/i, `${file} RPCs must use SECURITY DEFINER with explicit authorization checks`);
    assert.match(body, /SET search_path\s*(?:=|TO)?\s*'?public'?/i, `${file} RPCs must pin search_path to public`);
  }
}

assert.match(combined, /confirm_ai_forwarding_draft\(_draft_id uuid, _expected_version integer\)/, "Draft confirmation must accept reviewed version");
assert.match(combined, /v_draft\.version <> _expected_version/, "Draft confirmation must reject stale versions");
assert.match(combined, /draft_data->>'currency'.*CAD/s, "Forwarding drafts must enforce CAD");
assert.doesNotMatch(
  combined,
  /\b(?:w|waybills)\.domestic_tracking_no\b/i,
  "waybills.domestic_tracking_no was removed; search the linked order/forwarding instead",
);
assert.match(
  combined,
  /is_forwarding_route_visible_to_user\(v_route\.id, auth\.uid\(\)\)/,
  "Forwarding quotes must enforce customer route visibility",
);
assert.match(
  combined,
  /trg_enforce_forwarding_route_visibility[\s\S]*BEFORE INSERT OR UPDATE OF route_id, route_code, user_id/i,
  "Forwarding creation must enforce customer route visibility on the server",
);
for (const ownerOnly of [
  "chatgpt_owner_dashboard",
  "chatgpt_owner_search_customers",
  "chatgpt_owner_pending_forwardings",
  "chatgpt_owner_get_forwarding",
  "chatgpt_owner_update_forwarding_basic_info",
  "chatgpt_admin_search_audit_logs",
  "chatgpt_admin_get_audit_log",
]) {
  const body = combined.split(new RegExp(`CREATE OR REPLACE FUNCTION\\s+public\\.${ownerOnly}\\s*\\(`, "i"))[1]?.split(/CREATE OR REPLACE FUNCTION/i)[0] ?? "";
  assert.match(body, /has_role\(auth\.uid\(\),\s*'owner'/i, `${ownerOnly} must require the owner role`);
}

const forbiddenMutationName = /CREATE OR REPLACE FUNCTION\s+public\.[a-z0-9_]*(pay|recharge|topup|refund|deduct)[a-z0-9_]*\s*\(/i;
assert.doesNotMatch(combined, forbiddenMutationName, "ChatGPT migrations must not create payment mutation RPCs");

console.log(`ChatGPT migration validation passed: ${migrationFiles.length} ordered files, ${created.length - 1} protected database functions.`);
