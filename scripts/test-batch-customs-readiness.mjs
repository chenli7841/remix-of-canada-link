import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

function load(path, deps = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const exports = {};
  const vm = require("node:vm");
  vm.runInNewContext(compiled, {
    exports, Buffer, console,
    require(id) {
      if (!(id in deps)) throw new Error(`Unexpected dependency: ${id}`);
      return deps[id];
    },
  });
  return exports;
}
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const hsFormat = load("src/lib/hs-code-format.ts");

// selectByIds is exported from orders.functions.ts, which pulls in a huge
// dependency graph (createServerFn etc.) we don't want to load here — pull
// just that one function out by source text instead, same technique the
// other test scripts use for private/simple helpers.
function extractFunction(file, name) {
  const text = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const node = source.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `missing ${name} in ${file}`);
  const js = ts.transpileModule(node.getText(source).replace(/^export /, ""), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  return js;
}
const selectByIdsSrc = extractFunction("src/lib/orders.functions.ts", "selectByIds");
const selectByIdsMod = await import(
  `data:text/javascript;base64,${Buffer.from(`${selectByIdsSrc}\nexport { selectByIds };`).toString("base64")}`
);
const { selectByIds } = selectByIdsMod;

function idChunkAdmin(rowsFor, maxIdsPerCall = 200) {
  const calls = [];
  return { calls, from(table) {
    return { select(select) {
      return { in(idCol, ids) {
        if (ids.length > maxIdsPerCall) return { data: null, error: { message: "Bad Request" } };
        calls.push({ table, ids: [...ids] });
        return { data: rowsFor(table, ids), error: null };
      } };
    } };
  } };
}

test("a batch with 700+ forwarding orders no longer silently sees zero items", async () => {
  const forwardingIds = Array.from({ length: 709 }, (_, i) => `f${i}`);
  // Only f0..f9 actually have an item, to prove pagination doesn't drop rows.
  const items = forwardingIds.slice(0, 10).map((id, i) => ({ id: `item${i}`, forwarding_id: id, hs_code: i < 5 ? "0101.21.00.00" : null }));
  const admin = idChunkAdmin((table, ids) => {
    if (table !== "forwarding_items") return [];
    const set = new Set(ids);
    return items.filter((it) => set.has(it.forwarding_id));
  });
  const rows = await selectByIds(admin, "forwarding_items", "*", "forwarding_id", forwardingIds);
  assert.equal(rows.length, 10);
  assert.equal(admin.calls.every((c) => c.ids.length <= 200), true);
  const missing = rows.filter((r) => !hsFormat.isCompleteHsCode(r.hs_code)).length;
  assert.equal(missing, 5); // real completeness, not the old "0 items -> 0 missing" false-positive
});

test("readiness reads stored hs_code directly and never treats a 6-digit or malformed value as complete", () => {
  const rows = [
    { hs_code: "0101.21.00.00" },
    { hs_code: "0101210000" },
    { hs_code: "010121" },
    { hs_code: null },
    { hs_code: "" },
  ];
  const missing = rows.filter((r) => !hsFormat.isCompleteHsCode(r.hs_code)).length;
  assert.equal(missing, 3);
});
