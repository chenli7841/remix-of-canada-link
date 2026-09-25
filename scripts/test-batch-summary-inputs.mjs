import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import test from 'node:test';

async function load(source) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const duty = await load(fs.readFileSync('src/lib/duty.server.ts', 'utf8'));
const orders = fs.readFileSync('src/lib/orders.functions.ts', 'utf8');
const ast = ts.createSourceFile('orders.ts', orders, ts.ScriptTarget.Latest, true);
const freightSource = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'computeFreight').getText(ast);
const { computeFreight } = await load(`${fs.readFileSync('src/lib/insurance.ts', 'utf8')}\nconst getFxCadPerCny=async()=>0.2; const routeInsuranceRate=async()=>3; ${freightSource}`);
const selectByIdsSource = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'selectByIds').getText(ast);
const { selectByIds } = await load(selectByIdsSource);

function fakeAdmin(data) {
  let calls = 0;
  return { get calls() { return calls; }, from(table) {
    const q = new Proxy({}, { get(_, key) {
      if (key === 'then') return (resolve) => { calls++; resolve({ data: data[table] }); };
      return () => q;
    } });
    return q;
  } };
}

test('bulk duty inputs preserve calculations and require no per-waybill queries', async () => {
  const fo = { id: 'f1', box_count: 2, route_id: 'r1' };
  const fi = [{ id: 'i1', name: 'Goods', quantity: 4, unit_price_cny: 100, hs_code: '123', extras: {} }];
  const hs = [{ hs_code: '123', name_en: 'Goods', mfn_rate: 0.1, gst_rate: 0.05 }];
  for (const enabled of [false, true]) {
    for (const threshold_cad of [0, 100]) {
      const customs = { enabled, threshold_cad };
      const admin = fakeAdmin({ forwarding_orders: fo, forwarding_items: fi, hs_codes: hs,
        customs_rules: customs, app_settings: { value: { cny_per_cad: 5 } } });
      const wb = { forwarding_id: 'f1' };
      const expected = await duty.computeWaybillDutyBreakdown(admin, wb);
      const before = admin.calls;
      for (let i = 0; i < 200; i++) {
        assert.deepEqual(await duty.computeWaybillDutyBreakdown(admin, wb, { fo, fi, hs, customs, fx: 0.2 }), expected);
      }
      assert.equal(admin.calls, before);
    }
  }
});

// A batch's id lists can run into the thousands; a single .in() over all of
// them produces a query string long enough that Supabase's edge in front of
// PostgREST rejects it with a bare "Bad Request" before any row limit or
// PostgREST error applies. selectByIds must always page below that.
function idChunkAdmin(rowsFor, { maxIdsPerCall = 200 } = {}) {
  const calls = [];
  return { calls, from(table) {
    return { select(select) {
      return { in(idCol, ids) {
        if (ids.length > maxIdsPerCall) return { data: null, error: { message: 'Bad Request' } };
        const filters = {};
        const q = {
          eq(col, val) { filters[col] = val; return q; },
          then(resolve) {
            calls.push({ table, select, idCol, ids: [...ids], filters: { ...filters } });
            let data = rowsFor(ids);
            for (const [k, v] of Object.entries(filters)) data = data.filter((r) => r[k] === v);
            resolve({ data, error: null });
          },
        };
        return q;
      } };
    } };
  } };
}
test('selectByIds pages a large id list instead of one oversized .in()', async () => {
  const ids = Array.from({ length: 733 }, (_, i) => `id-${i}`);
  const admin = idChunkAdmin((chunk) => chunk.map((id) => ({ id, val: 1 })));
  const rows = await selectByIds(admin, 'waybills', 'id,val', 'id', ids);
  assert.equal(rows.length, 733);
  assert.ok(admin.calls.every((c) => c.ids.length <= 200), 'every call must stay within the id-per-call limit');
  assert.equal(admin.calls.length, 4); // ceil(733/200)
});
test('selectByIds applies an extra filter per chunk and skips the query entirely for an empty id list', async () => {
  const admin = idChunkAdmin((chunk) => chunk.map((id) => ({ waybill_id: id, scope: id === 'a' ? 'waybill' : 'batch', amount_cny: 1 })));
  const rows = await selectByIds(admin, 'surcharges', 'waybill_id,amount_cny', 'waybill_id', ['a', 'b'], (q) => q.eq('scope', 'waybill'));
  assert.deepEqual(rows.map((r) => r.waybill_id), ['a']);
  assert.deepEqual(admin.calls[0].filters, { scope: 'waybill' });
  admin.calls.length = 0;
  assert.deepEqual(await selectByIds(admin, 'surcharges', 'waybill_id', 'waybill_id', []), []);
  assert.equal(admin.calls.length, 0);
});
test('selectByIds surfaces a chunk error instead of returning partial rows', async () => {
  const ids = Array.from({ length: 401 }, (_, i) => `id-${i}`);
  let n = 0;
  const admin = { from() { return { select() { return { in: async () => {
    n++;
    return n === 2 ? { data: null, error: { message: 'offline' } } : { data: [], error: null };
  } }; } }; } };
  await assert.rejects(selectByIds(admin, 'waybills', 'id', 'id', ids), /offline/);
});

test('preloaded freight preserves CAD/CNY and all weight modes without queries', async () => {
  for (const weight_mode of ['actual', 'volumetric', 'max']) {
    for (const unit_price_cad of [0, 15]) {
      const rule = { weight_mode, unit_price_cad, unit_price_cny: 60, min_charge_cny: 100, volumetric_divisor: 6000 };
      const admin = fakeAdmin({ freight_rules: rule, customs_rules: null });
      const expected = await computeFreight(admin, 'r1', 2, 30000, null);
      const before = admin.calls;
      const actual = await computeFreight(admin, 'r1', 2, 30000, null, false, { rule, customs: null, fx: 0.2, insuranceRate: 0 });
      assert.equal(actual.freight_cad, expected.freight_cad);
      assert.equal(actual.chargeable_weight, expected.chargeable_weight);
      assert.equal(admin.calls, before);
    }
  }
});
