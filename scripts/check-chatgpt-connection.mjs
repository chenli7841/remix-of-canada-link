import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Public, read-only checks. Never send credentials or invoke business tools.
const origin = new URL(process.argv[2] ?? "https://china-to-canada-connect.lovable.app");
assert.equal(origin.protocol, "https:", "Use the deployed HTTPS site");
assert.ok(!origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash, "Pass only the website origin");
const manifest = JSON.parse(await readFile(new URL("../.lovable/mcp/manifest.json", import.meta.url), "utf8"));
const expectedIssuer = manifest.auth.issuer;
const metadataUrl = new URL("/.well-known/oauth-protected-resource", origin).href;
const mcpUrl = new URL("/mcp", origin).href;
const failures = [];

async function check(label, run) {
  try {
    await run();
    console.log(`PASS ${label}`);
  } catch (error) {
    failures.push(label);
    console.error(`FAIL ${label}: ${error.message}`);
  }
}
const get = (url) => fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) });

await check("OAuth resource metadata", async () => {
  const response = await get(metadataUrl);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.resource, mcpUrl, "OAuth resource must use the selected website domain");
  assert.deepEqual(data.authorization_servers, [expectedIssuer], "Deployed OAuth issuer must match the connected Supabase project");
});
await check("Unauthenticated MCP access", async () => {
  const response = await get(mcpUrl);
  assert.equal(response.status, 401, "MCP must reject unauthenticated requests");
  assert.ok(response.headers.get("www-authenticate")?.includes(`resource_metadata="${metadataUrl}"`), "OAuth challenge must point to this site's metadata");
});
await check("Supabase OAuth discovery", async () => {
  const response = await get(`${expectedIssuer}/.well-known/oauth-authorization-server`);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.issuer, expectedIssuer);
  assert.ok(data.authorization_endpoint && data.token_endpoint && data.jwks_uri);
  assert.ok(data.code_challenge_methods_supported?.includes("S256"));
});

console.log("These checks do not verify customer sign-in, database migrations, or tool permissions.");
process.exitCode = failures.length ? 1 : 0;
