import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/lib/forwarding-loading.server.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { getForwardingLoading } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
function db(tables, fail) {
  return { from(table) { return { select() { return { async in(_key, ids) {
    return { data: (tables[table] ?? []).filter(row => ids.includes(row.id)), error: table === fail ? { message: 'failure' } : null };
  } }; } }; } };
}
const wb = (carton_id = null, pallet_id = null, assigned_batch_id = null) => ({ carton_id, pallet_id, assigned_batch_id });

test('nested and direct membership: all batches, unique containers, actual names and numbers', async () => {
  const result = await getForwardingLoading(db({
    cartons: [{ id: 'c1', display_name: '服装箱', carton_no: 'BOX001', pallet_id: 'p1', batch_id: 'b1' }],
    pallets: [{ id: 'p1', display_name: '多伦多托盘', pallet_no: 'PAL001', batch_id: 'b2' }, { id: 'p2', display_name: '散货托盘', pallet_no: 'PAL002', batch_id: null }],
    batches: ['b1', 'b2', 'b3'].map(id => ({ id, display_name: `海运${id}`, batch_no: `BAT${id}` })),
  }), [wb('c1'), wb('c1', 'p1'), wb(null, 'p2', 'b3'), wb()]);
  assert.deepEqual(result.cartons, [{ id: 'c1', name: '服装箱', number: 'BOX001', missing: false }]);
  assert.equal(result.pallets.length, 2);
  assert.deepEqual(new Set(result.batches.map(b => b.id)), new Set(['b1', 'b2', 'b3']));
  assert.equal(result.unassignedWaybills, 1);
  assert.equal(result.totalWaybills, 4);
});
test('missing references and blank names stay distinguishable from no membership', async () => {
  const result = await getForwardingLoading(db({ pallets: [{ id: 'p1', display_name: ' ', pallet_no: 'PAL001', batch_id: null }] }), [wb('missing', 'p1')]);
  assert.equal(result.cartons[0].missing, true);
  assert.equal(result.pallets[0].name, null);
  assert.equal(result.pallets[0].number, 'PAL001');
});
test('failed lookups never appear as unassigned', async () => {
  await assert.rejects(getForwardingLoading(db({}, 'cartons'), [wb('c1')]), /装载信息读取失败/);
});
test('empty order requires no container queries', async () => {
  const result = await getForwardingLoading({ from() { throw new Error('unexpected query'); } }, []);
  assert.equal(result.totalWaybills, 0);
  assert.deepEqual(result.batches, []);
});
test('large orders fetch every container across chunks', async () => {
  const cartons = Array.from({ length: 451 }, (_, i) => ({ id: `c${i}`, display_name: null, carton_no: `BOX${i}`, pallet_id: null, batch_id: null }));
  const result = await getForwardingLoading(db({ cartons }), cartons.map(c => wb(c.id)));
  assert.equal(result.cartons.length, 451);
  assert.ok(result.cartons.every(c => !c.missing));
});
