import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Extract autoMatchBatchHsCodes' real handler body plus the private helpers
// it calls (localMatch/attrs/normalizeHs/parseJson/outputText), all from
// batch-customs.functions.ts by source text — that file also pulls in
// createServerFn/zod/admin-log/etc, which don't resolve outside the app.
const file = "src/lib/batch-customs.functions.ts";
const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

function fnText(name) {
  const node = source.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `missing function ${name}`);
  return node.getText(source);
}

// autoMatchBatchHsCodes = createServerFn(...).middleware(...).inputValidator(...).handler(fn)
const varStmt = source.statements.find(
  (n) => ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => d.name.getText(source) === "autoMatchBatchHsCodes"),
);
assert.ok(varStmt, "missing autoMatchBatchHsCodes");
const decl = varStmt.declarationList.declarations[0];
let call = decl.initializer;
let handlerFn = null;
while (ts.isCallExpression(call)) {
  const expr = call.expression;
  if (ts.isPropertyAccessExpression(expr) && expr.name.text === "handler") {
    handlerFn = call.arguments[0];
    break;
  }
  call = expr.expression;
}
assert.ok(handlerFn, "could not find .handler(...) callback");
const handlerSrc = handlerFn.getText(source).replace(/import\("[^"\n]+"\)/g, "Promise.resolve(dependencies)");

const hsFormatSource = readFileSync(new URL("../src/lib/hs-code-format.ts", import.meta.url), "utf8");
const combined = [
  ts.transpileModule(hsFormatSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
  fnText("normalizeHs"),
  fnText("attrs"),
  fnText("localMatch"),
  fnText("parseJson"),
  fnText("outputText"),
  "export { normalizeHs, attrs, localMatch, parseJson, outputText };",
].join("\n\n");
const combinedJs = ts.transpileModule(combined, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const helpers = await import(`data:text/javascript;base64,${Buffer.from(combinedJs).toString("base64")}`);

function makeHandler(deps) {
  const js = ts.transpileModule(handlerSrc, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return new Function(
    "dependencies", "assertManager", "loadCustomsItems", "loadCustomsItemRows",
    "isCompleteHsCode", "normalizeHsCodeForStorage", "normalizeHs", "attrs", "localMatch", "parseJson", "outputText",
    `return ${js}`,
  )(deps, deps.assertManager, deps.loadCustomsItems, deps.loadCustomsItemRows,
    helpers.isCompleteHsCode, helpers.normalizeHsCodeForStorage, helpers.normalizeHs, helpers.attrs, helpers.localMatch, helpers.parseJson, helpers.outputText);
}

function hsRow(hs_code, name_zh) {
  return { hs_code, name_zh, name_en: null, aliases: [] };
}

test("a malformed hs_codes library row hit by local_exact match doesn't abort the rest of the batch", async () => {
  const updates = [];
  const items = [
    { id: "good1", name: "已知品名A" }, // matches a well-formed library row
    { id: "bad1", name: "坏编码品名" }, // matches the malformed library row
    { id: "good2", name: "已知品名B" }, // must still get processed after the bad one
  ];
  const hsRows = [
    hsRow("0101.21.00.00", "已知品名A"),
    hsRow("4201.00.90", "坏编码品名"), // malformed: 8 digits, not 10 — mirrors the real bad row found in production
    hsRow("0202.30.00.00", "已知品名B"),
  ];
  const handler = makeHandler({
    supabaseAdmin: { from() { return { update() { return { eq: async (col, id) => { updates.push(id); return { error: null }; } }; } }; } },
    assertManager: async () => {},
    loadCustomsItems: async () => ({ hsRows, forwardingItems: items }),
    loadCustomsItemRows: async () => ({ forwardingItems: [] }), // pretend everything resolved on refresh
  });
  const result = await handler({ data: { batchId: "b1" }, context: { supabase: {}, userId: "u1" } });
  assert.equal(result.local_matched, 2, "the two well-formed matches must still apply");
  assert.equal(result.library_errors, 1);
  assert.deepEqual(updates, ["good1", "good2"]);
});
