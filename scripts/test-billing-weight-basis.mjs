import test from 'node:test';
import assert from 'node:assert/strict';
import {billingWeight} from '../src/lib/batch-weight-snapshot.ts';
import {assertBatchWeightSnapshot} from '../src/lib/snapshot-validation.ts';
test('merged weight follows freight max of totals instead of sum of individual maxima',()=>{
 const orders=[{chargeable_weight_kg:10},{chargeable_weight_kg:10}];
 assert.equal(billingWeight('split',orders),20);
 assert.equal(billingWeight('merged',orders,{chargeable_weight:11}),11);
});
test('container freight weight replaces children and missing merged weight never falls back',()=>{
 assert.equal(billingWeight('merged',[{chargeable_weight_kg:43.719}],{chargeable_weight:35.02}),35.02);
 assert.equal(billingWeight('merged',[{chargeable_weight_kg:43.719}]),null);
 assert.equal(billingWeight('split',[{chargeable_weight_kg:null}]),null);
});
test('merged invoice validates its own weight, not excluded child snapshots',()=>{
 const row={billing_weight_basis:'merged_freight_snapshot',chargeable_weight_kg:35.02,weight_orders:[{chargeable_weight_kg:null}],subtotal_cad:10,fee_freight_cad:10,fee_customs_cad:0,fee_insurance_cad:0,fee_clearance_cad:0,fee_surcharge_cad:0};
 assert.doesNotThrow(()=>assertBatchWeightSnapshot('test',[row]));
 assert.throws(()=>assertBatchWeightSnapshot('test',[{...row,chargeable_weight_kg:null}]),/合并计费重量/);
});
