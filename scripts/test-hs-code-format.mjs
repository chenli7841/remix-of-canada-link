import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/hs-code-format.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { hsCodeDigitsOnly, isCompleteHsCode, formatHsCode, normalizeHsCodeForStorage } = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);

test("hsCodeDigitsOnly strips any separator or whitespace", () => {
  assert.equal(hsCodeDigitsOnly("0101.21.00.00"), "0101210000");
  assert.equal(hsCodeDigitsOnly(" 0101 21 00 00 "), "0101210000");
  assert.equal(hsCodeDigitsOnly(null), "");
  assert.equal(hsCodeDigitsOnly(undefined), "");
});

test("isCompleteHsCode requires exactly 10 digits", () => {
  assert.equal(isCompleteHsCode("0101.21.00.00"), true);
  assert.equal(isCompleteHsCode("0101210000"), true);
  assert.equal(isCompleteHsCode("010121000"), false);
  assert.equal(isCompleteHsCode("01012100001"), false);
  assert.equal(isCompleteHsCode(""), false);
  assert.equal(isCompleteHsCode(null), false);
});

test("formatHsCode groups whatever has been typed so far, 4-2-2-2", () => {
  assert.equal(formatHsCode("0101210000"), "0101.21.00.00");
  assert.equal(formatHsCode("0101"), "0101");
  assert.equal(formatHsCode("01012"), "0101.2");
  assert.equal(formatHsCode(""), "");
  assert.equal(formatHsCode("010121000099999"), "0101.21.00.00"); // extra digits truncated at 10
});

test("normalizeHsCodeForStorage accepts empty as null and rejects partial codes", () => {
  assert.equal(normalizeHsCodeForStorage(""), null);
  assert.equal(normalizeHsCodeForStorage(null), null);
  assert.equal(normalizeHsCodeForStorage("   "), null);
  assert.equal(normalizeHsCodeForStorage("0101.21.00.00"), "0101.21.00.00");
  assert.equal(normalizeHsCodeForStorage("0101210000"), "0101.21.00.00");
  assert.throws(() => normalizeHsCodeForStorage("0101.21"), /10 位数字/);
  assert.throws(() => normalizeHsCodeForStorage("abcd.ef.gh.ij"), /10 位数字/);
  assert.throws(() => normalizeHsCodeForStorage("0101.21.00.0099"), /10 位数字/);
});
