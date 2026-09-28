import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeightOrders, weightTotal, savedChargeableWeight } from '../src/lib/batch-weight-snapshot.ts';
import { assertSnapshotNumbers, assertBatchWeightSnapshot } from '../src/lib/snapshot-validation.ts';
test('stored weights aggregate by order, deduplicating waybills without recalculation', () => {
 const w={id:'w1',forwarding_id:'f',waybill_no:'WB1',weight_kg:999,weight_snapshot:{chargeable_weight:1.25},payment_status:'paid'};
 const rows=buildWeightOrders([w,w,{...w,id:'w2',weight_snapshot:{chargeable_weight:2.5}}],new Map(),new Map([['f',{request_no:'ORDER1'}]]));
 assert.equal(rows.length,1);assert.equal(rows[0].chargeable_weight_kg,3.75);assert.equal(rows[0].no,'ORDER1');
});
test('missing weight propagates and identifies the waybill; zero is valid', () => {
 const rows=buildWeightOrders([{id:'w',forwarding_id:'f',waybill_no:'WB-MISSING'},{id:'w2',forwarding_id:'f',weight_snapshot:{chargeable_weight:0}}],new Map(),new Map([['f',{request_no:'ORDER1'}]]));
 assert.equal(rows[0].chargeable_weight_kg,null);
 assert.throws(()=>assertBatchWeightSnapshot('09013',[{weight_orders:rows}]),/WB-MISSING/);
 assert.equal(savedChargeableWeight({weight_snapshot:{chargeable_weight:0}}),0);
});
test('all malformed and missing numeric values are rejected; explicit zero accepted', () => {
 for(const value of [null,undefined,'','  ',NaN,Infinity,-1,true]){
 assert.throws(()=>assertSnapshotNumbers('运单 TEST',{计费重量:value}),/计费重量/);
 assert.equal(weightTotal([{chargeable_weight_kg:value}]),null);
 }
 assert.doesNotThrow(()=>assertSnapshotNumbers('未投保',{保费:0}));
 assert.equal(weightTotal([{chargeable_weight_kg:'1.25'},{chargeable_weight_kg:2}]),3.25);
});
test('empty container cannot produce an apparently complete snapshot',()=>{
 assert.throws(()=>assertBatchWeightSnapshot('09013',[{pallet_count:1,weight_orders:[]}]),/订单关联/);
});
