import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import assert from "node:assert/strict";
const api = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync("src/lib/operations-summary.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports: api, Intl, Date, Map, Set },
);
const row = {
  user_id: "u",
  batch_no: "b",
  status: "unpaid",
  total_cny: 100,
  paid_cny: 20,
  paid_cad: 4,
  fx_rate: 0.2,
};
const result = api.summarizeReceivables(
  [
    row,
    { ...row, id: "2", total_cny: 50, paid_cny: 0, paid_cad: 0 },
    { ...row, status: "paid" },
    { ...row, status: "void" },
  ],
  [{ id: "u", customer_code: "00123" }],
  [{ user_id: "u", balance_cad: 5 }],
);
assert.equal(result[0].due_cad, 26);
assert.equal(result[0].batch_count, 1);
assert.equal(result[0].balance_cad, 5);
assert.throws(() => api.summarizeReceivables([{ ...row, fx_rate: 0 }], [], []));
const b = (id, method, date, status = "shipped") => ({
  id,
  shipping_method: method,
  actual_ship_date: date,
  status,
});
const ages = api.shippedBatchAges(
  [
    b("a", "air", "2026-09-25"),
    b("b", "air", "2026-09-24"),
    b("c", "sea", "2026-09-07"),
    b("d", "sea", "2026-09-06"),
    b("e", "air", "2026-09-01", "arrived"),
    b("f", "sea", "2026-09-01", "closed"),
    b("g", "air", "2026-09-01", "draft"),
  ],
  new Date("2026-10-08T02:00:00Z"),
);
assert.equal(ages.length, 4);
for (const a of ages) assert.equal(a.overdue, ["b", "d"].includes(a.id));
assert.equal(ages.find((a) => a.id === "a").days, 12);
assert.equal(ages[0].id, "d");
console.log(
  "Operations summary: partial payments, currency, deduplicated batches, status filters and Toronto threshold boundaries passed.",
);
