import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
async function load(file) {
  const source = readFileSync(new URL(`../src/lib/${file}.ts`, import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const { insuranceCad, uniqueWaybills, supportsInsurance } = await load('insurance');
const { routeInsuranceRate } = await load('insurance-rate.server');
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
    computeAnyWaybillDutyBreakdown: async () => ({ duty_cad: 0 }),
    buildInvoiceLineMeta: async () => null,
  };
  return new Function('insuranceCad', 'getFxCadPerCny', 'dependencies', 'routeInsuranceRate', `${js};return ${name}`)(insuranceCad, dependencies.getFxCadPerCny, dependencies, routeInsuranceRate);
}
function pricingDb(insured, cargoType = 'general') {
  return { from(table) {
    let columns;
    const values = {
      shipping_routes: { cargo_type: cargoType },
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

test('sensitive cargo blocks insurance even with an old 100 percent rate and opt-in', async () => {
  assert.equal(supportsInsurance({ cargo_type: 'sensitive' }), false);
  assert.equal(supportsInsurance({ cargo_type: 'general' }), true);
  assert.equal(supportsInsurance(null), false);
  assert.equal(await routeInsuranceRate(pricingDb(true, 'sensitive'), 'r', 100), 0);
  const preview = extract('orders.functions', 'computeFreight');
  assert.equal((await preview(pricingDb(true, 'sensitive'), 'r', 1, 3240, 55, true)).insurance_cad, 0);
  const measure = extract('scan.functions', 'computeWaybillFeesCad');
  assert.equal((await measure(pricingDb(true, 'sensitive'), { forwarding_id: 'f', weight_kg: 1 })).insurance_cad, 0);
  const rows = await effectiveWaybillInsurance(db([{ id: 'f', insured: true, shipping_routes: { cargo_type: 'sensitive' } }]), [{ forwarding_id: 'f', payment_status: 'unpaid', insurance_cad: 55 }]);
  assert.equal(rows[0].insurance_cad, 0);
});


test('invoice records stored premium, including zero, without consulting eligibility', async () => {
  const invoice = extract('invoices.functions', 'computeWaybillFees');
  function invoiceDb(premium, hasRule = true) {
    return { from(table) {
      assert.notEqual(table, 'shipping_routes');
      const data = { waybills: { forwarding_id: 'f', insurance_cad: premium, weight_kg: 1 }, forwarding_orders: { route_id: 'r', insured: false, declared_value_cad: 9999 }, freight_rules: hasRule ? { insurance_rate_pct: 100, unit_price_cny: 1, extra_fee_cny: 0, min_charge_cny: 0 } : null }[table];
      const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data }) }; return q;
    } };
  }
  assert.equal((await invoice(invoiceDb(0), 'w', .2)).insurance_cny, 0);
  assert.equal((await invoice(invoiceDb(4.5), 'w', .2)).insurance_cny, 22.5);
  assert.equal((await invoice(invoiceDb(4.5, false), 'w', .2)).insurance_cny, 22.5);
  await assert.rejects(invoice(invoiceDb(4.5), 'w', 0));
});
