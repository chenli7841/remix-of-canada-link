import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBatchWaybills } from '../src/lib/batch-waybills.server.ts';

function mock(tables, fail) {
  return { from(table) {
    let filters = [];
    const q = {
      select() { return q; }, order() { return q; },
      eq(k,v) { filters.push(r => r[k] === v); return q; },
      is(k,v) { filters.push(r => (r[k] ?? null) === v); return q; },
      in(k,vs) { filters.push(r => vs.includes(r[k])); return q; },
      async range(a,b) { return fail === table ? { error: { message: 'unavailable' } } : { data: (tables[table] ?? []).filter(r => filters.every(f => f(r))).slice(a,b+1) }; },
    }; return q;
  } };
}

test('includes direct, carton, pallet and pallet/carton; excludes stale direct links and deduplicates', async () => {
  const db = mock({
    pallets: [{id:'p',batch_id:'b'}, {id:'other',batch_id:'elsewhere'}],
    cartons: [{id:'c',batch_id:'b'}, {id:'pc',batch_id:'b',pallet_id:'p'}, {id:'foreign',batch_id:'elsewhere'}],
    waybills: [
      {id:'direct',assigned_batch_id:'b'}, {id:'carton',carton_id:'c'},
      {id:'pallet',pallet_id:'p'}, {id:'nested',carton_id:'pc',pallet_id:'p',assigned_batch_id:'b'},
      {id:'stale',assigned_batch_id:'b',pallet_id:'other'},
      {id:'foreign-carton',pallet_id:'p',carton_id:'foreign'},
    ],
  });
  assert.deepEqual((await loadBatchWaybills(db,'b')).map(w=>w.id).sort(), ['carton','direct','nested','pallet']);
});

test('loads more than 1000 waybills inside one pallet', async () => {
  const waybills = Array.from({length:1005}, (_,i)=>({id:`w${i}`,pallet_id:'p'}));
  assert.equal((await loadBatchWaybills(mock({pallets:[{id:'p',batch_id:'b'}],waybills}),'b')).length,1005);
});

test('database failures are not reported as no matching waybills', async () => {
  await assert.rejects(loadBatchWaybills(mock({},'cartons'),'b'), /cartons: unavailable/);
});
