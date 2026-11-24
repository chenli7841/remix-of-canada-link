import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBatchWaybills, loadCustomerBatchWaybills } from '../src/lib/batch-waybills.server.ts';

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

test('customer batches resolve nested containers and exclude other customers and stale assignments', async () => {
 const db=mock({cartons:[{id:'c',batch_id:'oct',pallet_id:'p'},{id:'loose',batch_id:'nov'},{id:'empty',batch_id:null}],pallets:[{id:'p',batch_id:'oct-new'}],waybills:[
  {id:'nested',user_id:'mine',carton_id:'c',assigned_batch_id:'old'},
  {id:'carton',user_id:'mine',carton_id:'loose'},
  {id:'pallet',user_id:'mine',pallet_id:'p'},
  {id:'direct',user_id:'mine',assigned_batch_id:'direct-batch'},
  {id:'moved',user_id:'mine',carton_id:'empty',assigned_batch_id:'old'},
  {id:'foreign',user_id:'other',carton_id:'c'},
 ]});
 assert.deepEqual((await loadCustomerBatchWaybills(db,'mine')).map(w=>[w.id,w.assigned_batch_id]),[['nested','oct-new'],['carton','nov'],['pallet','oct-new'],['direct','direct-batch']]);
});
test('customer batch lookup pages all leaves and fails closed on container errors',async()=>{
 const tables={cartons:[{id:'c',batch_id:'oct'}],waybills:Array.from({length:1005},(_,i)=>({id:`w${i}`,user_id:'mine',carton_id:'c'}))};
 assert.equal((await loadCustomerBatchWaybills(mock(tables),'mine')).length,1005);
 await assert.rejects(loadCustomerBatchWaybills(mock(tables,'cartons'),'mine'),/cartons: unavailable/);
});
