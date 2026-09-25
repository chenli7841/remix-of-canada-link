import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

// Pull the pure grouping/merging helpers out of batch-customs.functions.ts
// by source text — that file also pulls in createServerFn/zod/admin-log/etc,
// which don't resolve outside the app; only these functions are needed here.
const source = readFileSync(new URL("../src/lib/batch-customs.functions.ts", import.meta.url), "utf8");
const ast = ts.createSourceFile("batch-customs.ts", source, ts.ScriptTarget.Latest, true);
function fnText(name) {
  const node = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(node, `missing ${name}`);
  return node.getText(ast);
}
const combined = [
  "export function hsCodeDigitsOnly(v){return String(v??'').replace(/\\D/g,'');}",
  "const OVERSIZE_MAX_SIDE_CM = 200; const OVERSIZE_MAX_WEIGHT_KG = 200; const OVERSIZE_MAX_VOLUME_M3 = 1;",
  fnText("volumeM3"),
  fnText("isOversize"),
  fnText("hs6"),
  fnText("pickDominantHs6"),
  fnText("mergeCandidates"),
  "export { volumeM3, isOversize, hs6, pickDominantHs6, mergeCandidates };",
].join("\n\n");
const js = ts.transpileModule(combined, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const mod = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const { isOversize, hs6, pickDominantHs6, mergeCandidates } = mod;

test("hs6 extracts the first 6 digits regardless of separators", () => {
  assert.equal(hs6("0101.21.00.00"), "010121");
  assert.equal(hs6("0101210000"), "010121");
  assert.equal(hs6(null), "");
  assert.equal(hs6(""), "");
});

test("isOversize trips independently on any side, weight, or volume threshold", () => {
  assert.equal(isOversize({ length_cm: 199, width_cm: 50, height_cm: 50, weight_kg: 50 }), false);
  assert.equal(isOversize({ length_cm: 201, width_cm: 50, height_cm: 50, weight_kg: 50 }), true);
  assert.equal(isOversize({ length_cm: 50, width_cm: 50, height_cm: 50, weight_kg: 201 }), true);
  assert.equal(isOversize({ length_cm: 200, width_cm: 200, height_cm: 300, weight_kg: 1 }), true); // 12 m3 > 1
  assert.equal(isOversize({ length_cm: 50, width_cm: 50, height_cm: 50, weight_kg: 50 }), false);
});

test("pickDominantHs6: a single group needs no comparison", () => {
  const items = [{ hs_code: "0101.21.00.00", declared_value_cad: 10, quantity_per_waybill: 1 }];
  assert.equal(pickDominantHs6(items, 5, 0.1), "010121");
});

test("pickDominantHs6: 2x dominance on any metric wins outright, checked volume-first", () => {
  // Group A has 2x the declared value of B; volume/weight/qty are tied, so
  // value is the only metric where a 2x gap exists.
  const items = [
    { hs_code: "010101", declared_value_cad: 20, quantity_per_waybill: 1 },
    { hs_code: "020202", declared_value_cad: 10, quantity_per_waybill: 1 },
  ];
  assert.equal(pickDominantHs6(items, 10, 1), "010101");
});

test("pickDominantHs6: no 2x dominance anywhere falls back to volume > weight > qty > value priority", () => {
  // Value-proportional volume/weight are identical (equal value share), so
  // the tiebreak must fall through the priority chain to quantity.
  const items = [
    { hs_code: "010101", declared_value_cad: 10, quantity_per_waybill: 5 },
    { hs_code: "020202", declared_value_cad: 10, quantity_per_waybill: 1 },
  ];
  assert.equal(pickDominantHs6(items, 10, 1), "010101");
});

test("pickDominantHs6 returns null when nothing has a usable hs_code", () => {
  assert.equal(pickDominantHs6([{ hs_code: null, declared_value_cad: 5, quantity_per_waybill: 1 }], 1, 1), null);
  assert.equal(pickDominantHs6([], 1, 1), null);
});

test("mergeCandidates sums matching non-standalone lines but never merges a standalone (oversize) one", () => {
  const a = { code: "010101", items: [{ hs_code: "010101", declared_value_cad: 10, quantity_per_waybill: 1 }], packages: 1, weightKg: 5, volM3: 0.1 };
  const b = { code: "010101", items: [{ hs_code: "010101", declared_value_cad: 20, quantity_per_waybill: 2 }], packages: 1, weightKg: 7, volM3: 0.2 };
  const oversize = { code: "010101", items: [{ hs_code: "010101", declared_value_cad: 999, quantity_per_waybill: 1 }], packages: 1, weightKg: 300, volM3: 2, standalone: { kind: "waybill", ref: "W1" } };
  const merged = mergeCandidates([a, b, oversize]);
  assert.equal(merged.length, 2); // one merged line + the standalone line
  const mergedLine = merged.find((l) => !l.standalone);
  assert.equal(mergedLine.packages, 2);
  assert.equal(mergedLine.weightKg, 12);
  assert.equal(+mergedLine.volM3.toFixed(1), 0.3);
  assert.equal(mergedLine.items.length, 2);
  const standaloneLine = merged.find((l) => l.standalone);
  assert.equal(standaloneLine.packages, 1);
  assert.equal(standaloneLine.standalone.ref, "W1");
});
