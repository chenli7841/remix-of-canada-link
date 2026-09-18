import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifestUrl = new URL("../.lovable/mcp/manifest.json", import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
const evals = JSON.parse(await readFile(new URL("../evals/chatgpt-app.json", import.meta.url), "utf8"));
const mcpSource = await readFile(new URL("../src/lib/mcp/index.ts", import.meta.url), "utf8");
const tools = manifest?.mcp?.tools ?? [];
const byName = new Map(tools.map((tool) => [tool.name, tool]));

assert.equal(manifest.path, "/mcp", "MCP endpoint must remain /mcp");
assert.equal(manifest.auth?.type, "oauth", "EPLUS MCP must require OAuth");
assert.match(manifest.auth?.issuer ?? "", /^https:\/\/[^/]+\.supabase\.co\/auth\/v1$/, "OAuth issuer must be the Supabase Auth issuer");
assert.ok(manifest.auth?.accepted_audiences?.includes("authenticated"), "OAuth must accept only authenticated EPLUS users");
assert.equal(byName.size, tools.length, "MCP tool names must be unique");
assert.match(mcpSource, /Progressive disclosure is mandatory/, "MCP must require progressive disclosure for large result sets");
assert.match(mcpSource, /more than 5 records/, "MCP must limit bulk result presentation");
assert.match(mcpSource, /For images, files, or spoken input/, "MCP must define multimodal handoff rules");
assert.match(mcpSource, /Never invent unreadable text/, "MCP must reject uncertain media extraction");
assert.match(mcpSource, /never automatically repeat a non-idempotent write/, "MCP must not retry uncertain writes");
assert.match(mcpSource, /Identity always comes from EPLUS OAuth/, "Customer identity must come from OAuth");
assert.match(mcpSource, /automatically use the address marked is_default=true/, "Forwarding creation must use the default saved address");
assert.match(mcpSource, /show only the returned routes/, "Forwarding creation must use permission-filtered route options");

const requiredTools = [
  "get_current_customer",
  "list_my_orders",
  "get_my_order",
  "list_my_forwardings",
  "get_my_forwarding",
  "track_waybill",
  "quote_forwarding_cad",
  "save_forwarding_draft",
  "confirm_forwarding_draft",
  "get_my_wallet",
  "list_my_invoices",
  "get_my_inventory",
  "get_owner_dashboard",
  "search_customers_owner",
  "set_waybill_status_manager",
  "search_eplus_knowledge",
  "list_my_support_messages",
  "send_my_support_message",
  "send_customer_support_message_admin",
];
for (const name of requiredTools) assert.ok(byName.has(name), `Required MCP tool is missing: ${name}`);

const forbiddenPaymentPattern = /(^|_)(pay|payment|recharge|topup|refund|deduct)(_|$)/i;
const forbiddenTools = tools.map((tool) => tool.name).filter((name) => forbiddenPaymentPattern.test(name));
assert.deepEqual(forbiddenTools, [], `Payment mutation tools are forbidden: ${forbiddenTools.join(", ")}`);

for (const name of ["delete_my_item", "delete_my_address", "cancel_forwarding_draft", "set_waybill_status_manager"]) {
  assert.equal(byName.get(name)?.annotations?.destructiveHint, true, `${name} must remain marked destructive`);
}
for (const name of ["confirm_forwarding_draft", "delete_my_item", "delete_my_address", "cancel_forwarding_draft", "update_forwarding_basic_info_owner", "set_waybill_status_manager", "send_my_support_message", "send_customer_support_message_admin"]) {
  assert.ok(byName.get(name)?.inputSchema?.properties?.confirmation, `${name} must require a confirmation token`);
}
assert.ok(byName.get("confirm_forwarding_draft")?.inputSchema?.properties?.expected_version, "Draft confirmation must bind to the reviewed version");
assert.equal(byName.get("save_forwarding_draft")?.annotations?.idempotentHint, false, "Draft creation is not idempotent without a draft_id");
assert.ok(!byName.get("save_forwarding_draft")?.inputSchema?.required?.includes("warehouse"), "Warehouse must not be requested from the customer");

assert.ok(evals.cases.length >= 20, "Regression suite must cover at least 20 cases");
const evalIds = new Set();
for (const testCase of evals.cases) {
  assert.ok(testCase.id && !evalIds.has(testCase.id), `Eval case id must be unique: ${testCase.id}`);
  evalIds.add(testCase.id);
  assert.ok(typeof testCase.prompt === "string" && testCase.prompt.length > 0, `${testCase.id} must have a prompt`);
  for (const toolName of [...(testCase.expected_tools ?? []), ...(testCase.forbidden_tools ?? [])]) {
    assert.ok(byName.has(toolName), `${testCase.id} references an unknown tool: ${toolName}`);
  }
}

console.log(`MCP validation passed: ${tools.length} OAuth-protected tools, ${evals.cases.length} eval cases, no payment mutation tools.`);
