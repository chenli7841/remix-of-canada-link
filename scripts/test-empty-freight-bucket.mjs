import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateContainerFreight } from '../src/lib/freight-allocation.ts';
import { weightTotal, buildWeightOrders } from '../src/lib/batch-weight-snapshot.ts';
import { assertSnapshotNumbers } from '../src/lib/snapshot-validation.ts';
test('missing measured freight blocks bill generation instead of falling back to the parent order',()=>{
 assert.throws(()=>allocateContainerFreight([{id:'w',freight_cad:null}],[],[]),/量尺称重/);
});
test('a real parcel with no weight snapshot cannot produce a confirmed weight',()=>{
 const orders=buildWeightOrders([{id:'w',freight_cad:3}],new Map(),new Map());
 assert.throws(()=>assertSnapshotNumbers('计费明细',{计费重量:weightTotal(orders)}),/计费重量/);
});
test('no duplicate freight for a leaf referenced by both its carton and pallet',()=>{
 const w={id:'w',carton_id:'c',pallet_id:'p',freight_cad:4};
 const result=allocateContainerFreight([w,w],[{id:'c',pallet_id:'p',billing_mode:'merged',self_freight_cad:8}],[{id:'p',billing_mode:'merged',self_freight_cad:12}]);
 assert.equal(result.size,1);assert.equal(result.get('w').freight_cad,12);
});
