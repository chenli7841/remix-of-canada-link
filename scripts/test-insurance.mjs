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
const { computeWaybillDutyBreakdown } = await load('duty.server');
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

// ---- computeWaybillDutyBreakdown: per-item quantity split ----
// forwarding_items is the whole order's item list; intake copies it verbatim
// onto every waybill's items_summary (same raw quantity on each one). A
// single item that itself spans N of its own boxes (extras.box_count) must
// have its declared value divided by N — otherwise every waybill carrying a
// piece of it gets billed the item's full value.
function dutyDb({ items = [], boxCount = 1, hsCodes = [] } = {}) {
  return { from(table) {
    if (table === 'forwarding_orders') return { select() { return { eq() { return { maybeSingle: async () => ({ data: { id: 'f', box_count: boxCount, route_id: 'r' } }) }; } }; } };
    if (table === 'forwarding_items') return { select() { return { eq: async () => ({ data: items, error: null }) }; } };
    if (table === 'hs_codes') return { select() { return { order() { return { range: async () => ({ data: hsCodes, error: null }) }; } }; } };
    if (table === 'customs_rules') return { select() { return { eq() { return { maybeSingle: async () => ({ data: null }) }; } }; } };
    if (table === 'app_settings') return { select() { return { eq() { return { maybeSingle: async () => ({ data: null }) }; } }; } };
    throw new Error(`unexpected table ${table}`);
  } };
}
test('an item split across its own boxes divides declared value by that split, not the whole order box count', async () => {
  const items = [{ id: 'i1', name: '吧椅', quantity: 1, unit_price_cad: 300, extras: { box_count: 2 } }];
  const wbSummary = { items_summary: [{ name: '吧椅', quantity: 1 }] };
  const a = await computeWaybillDutyBreakdown(dutyDb({ items, boxCount: 5 }), { forwarding_id: 'f', ...wbSummary });
  const b = await computeWaybillDutyBreakdown(dutyDb({ items, boxCount: 5 }), { forwarding_id: 'f', ...wbSummary });
  assert.equal(a.declared_cad, 150);
  assert.equal(b.declared_cad, 150);
  assert.equal(a.items[0].quantity_source, 'quantity/box_count');
});
test('explicit items_per_carton/inner_qty on an item wins over its box_count', async () => {
  const items = [{ id: 'i1', name: 'X', quantity: 10, unit_price_cad: 10, extras: { box_count: 5, inner_qty: 3 } }];
  const br = await computeWaybillDutyBreakdown(dutyDb({ items }), { forwarding_id: 'f', items_summary: [{ name: 'X', quantity: 10 }] });
  assert.equal(br.declared_cad, 30); // 3 units * $10, not 10/5=2 units
  assert.equal(br.items[0].quantity_source, 'items_per_carton');
});
test('an item without a split annotation still falls back to the waybill summary quantity', async () => {
  const items = [{ id: 'i1', name: 'Y', quantity: 4, unit_price_cad: 5, extras: null }];
  const br = await computeWaybillDutyBreakdown(dutyDb({ items }), { forwarding_id: 'f', items_summary: [{ name: 'Y', quantity: 4 }] });
  assert.equal(br.declared_cad, 20);
  assert.equal(br.items[0].quantity_source, 'quantity');
});
test('an item absent from the summary falls back to the order box count', async () => {
  const items = [{ id: 'i1', name: 'Z', quantity: 10, unit_price_cad: 1, extras: null }];
  const br = await computeWaybillDutyBreakdown(dutyDb({ items, boxCount: 5 }), { forwarding_id: 'f', items_summary: [] });
  assert.equal(br.declared_cad, 2); // 10 / 5 boxes
  assert.equal(br.items[0].quantity_source, 'quantity/box_count');
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
    // Both duty breakdown flavors now double as the single source of declared
    // value for insurance too — the stub must return declared_cad, not just duty_cad.
    computeWaybillDutyBreakdown: async () => ({ duty_cad: 0, declared_cad: 10.52 }),
    computeAnyWaybillDutyBreakdown: async () => ({ duty_cad: 0, declared_cad: 10.52 }),
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
  const wb = { id: 'w', forwarding_id: 'f', weight_kg: .32, length_cm: 30, width_cm: 18, height_cm: 6 };
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

test('measuring and recompute both price insurance off the same duty-breakdown declared value', async () => {
  const measure = extract('scan.functions', 'computeWaybillFeesCad');
  const wb = { id: 'w', forwarding_id: 'f', weight_kg: 1, length_cm: 10, width_cm: 10, height_cm: 10 };
  assert.equal((await measure(pricingDb(true), wb)).insurance_cad, +(10.52 * 0.03).toFixed(2));
  assert.equal((await measure(pricingDb(false), wb)).insurance_cad, 0);
});

test('recompute saves premium off the duty breakdown and surfaces write failure', async () => {
  const calculate = extract('orders.functions', 'computeAndPersistWaybillFees');
  function savingDb(insured, fail = false) {
    const base = pricingDb(insured);
    const saved = [];
    const admin = { from(table) {
      if (table !== 'waybills') return base.from(table);
      const q = { select() { return q; }, eq() { return q; }, maybeSingle: async () => ({ data: { id: 'w', forwarding_id: 'f', weight_kg: 1 } }), update(row) { saved.push(row); return { eq: async () => ({ error: fail ? { message: 'write failed' } : null }) }; } }; return q;
    } };
    return { admin, saved };
  }
  const yes = savingDb(true);
  await calculate(yes.admin, 'w');
  assert.equal(yes.saved[0].insurance_cad, +(10.52 * 0.03).toFixed(2));
  assert.equal(yes.saved[0].weight_snapshot.declared_cad, 10.52);
  const no = savingDb(false);
  await calculate(no.admin, 'w');
  assert.equal(no.saved[0].insurance_cad, 0);
  await assert.rejects(calculate(savingDb(true, true).admin, 'w'), /write failed/);
});
