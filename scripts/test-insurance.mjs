import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
async function load(file) {
  const source = readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { insuranceCad, uniqueWaybills } = await load('insurance');
const { effectiveWaybillInsurance } = await load('insurance.server');
test('uninsured 10.52 CAD shipment is zero; insured rounds to 0.32', () => {
  assert.equal(insuranceCad(10.52, 3, false), 0);
  assert.equal(insuranceCad(10.52, 3, true), 0.32);
  assert.equal(insuranceCad(10.52, 3, 'false'), 0);
  assert.equal(insuranceCad(-1, 3, true), 0);
});
function db(choices, error = null) {
  return { from() { return { select() { return { in: async () => ({ data: choices, error }) }; } }; } };
}
test('exclude old unpaid uninsured amounts, preserve insured, paid and shop records', async () => {
  const rows = [
    { id: 'a', forwarding_id: 'no', insurance_cad: .32, payment_status: 'unpaid' },
    { id: 'b', forwarding_id: 'yes', insurance_cad: .32, payment_status: 'unpaid' },
    { id: 'c', forwarding_id: 'no', insurance_cad: .32, payment_status: 'paid' },
    { id: 'd', insurance_cad: 5 },
  ];
  const result = await effectiveWaybillInsurance(db([{ id: 'no', insured: false }, { id: 'yes', insured: true }]), rows);
  assert.deepEqual(result.map(r => r.insurance_cad), [0, .32, .32, 5]);
  assert.equal(rows[0].insurance_cad, .32);
});
test('missing parent or failed insurance lookup prevents billing', async () => {
  const rows = [{ forwarding_id: 'x', insurance_cad: 1 }];
  await assert.rejects(effectiveWaybillInsurance(db([], { message: 'offline' }), rows));
  await assert.rejects(effectiveWaybillInsurance(db([]), rows));
});
test('overlapping direct and carton membership charges a waybill only once', () => {
  const a = { id: 'a', insurance_cad: .32 };
  const result = uniqueWaybills([a, { id: 'b', insurance_cad: 1 }, a]);
  assert.equal(result.reduce((s, w) => s + w.insurance_cad, 0), 1.32);
});

function extract(file, name) {
  const text = readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  assert.ok(fn, `missing ${name}`);
  const js = ts.transpileModule(fn.getText(ast).replace(/^export /, '').replace(/import\("[^"\n]+"\)/g, 'Promise.resolve(dependencies)'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const dependencies = {
    getFxCadPerCny: async () => .19,
    computeWaybillDeclaredCad: () => 10.52,
    computeWaybillDutyBreakdown: async () => ({ duty_cad: 0 }),
  };
  return new Function('insuranceCad', 'getFxCadPerCny', 'dependencies', `${js};return ${name}`)(insuranceCad, dependencies.getFxCadPerCny, dependencies);
}
function pricingDb(insured) {
  return { from(table) {
    let columns;
    const values = {
      forwarding_orders: { route_id: 'r', declared_value_cad: 10.52, box_count: 1, insured },
      forwarding_items: [],
      freight_rules: { insurance_rate_pct: 3, unit_price_cad: 3, min_charge_waybill_cad: 2, volumetric_divisor: 5000 },
      customs_rules: { enabled: false },
    };
    const result = () => {
      const row = values[table];
      return { data: row && !Array.isArray(row) && columns !== '*' ? Object.fromEntries(columns.split(',').map(k => [k.trim(), row[k.trim()]])) : row };
    };
    const q = { select(c) { columns = c; return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, maybeSingle: async () => result(), then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); } };
    return q;
  } };
}
test('real measuring fee calculator reads insured and respects both choices', async () => {
  const calculate = extract('scan.functions', 'computeWaybillFeesCad');
  const wb = { forwarding_id: 'f', weight_kg: .32, length_cm: 30, width_cm: 18, height_cm: 6 };
  assert.equal((await calculate(pricingDb(false), wb)).insurance_cad, 0);
  assert.equal((await calculate(pricingDb(true), wb)).insurance_cad, .32);
});
test('real freight preview calculator requires explicit insurance opt-in', async () => {
  const calculate = extract('orders.functions', 'computeFreight');
  assert.equal((await calculate(pricingDb(false), 'r', .32, 3240, 10.52)).insurance_cad, 0);
  assert.equal((await calculate(pricingDb(true), 'r', .32, 3240, 10.52, true)).insurance_cad, .32);
});
