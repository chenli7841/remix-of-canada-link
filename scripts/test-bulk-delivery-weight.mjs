import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as snapshots from '../src/lib/batch-weight-snapshot.ts';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/bulk-delivery-weight.ts','utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports, require: () => snapshots });
const { deliveryWeightsByCustomer: weights } = exports;

test('uses saved total even when actual and dimensional weights would cross the trigger', () => {
  const row = { customer_code:'00123',chargeable_weight_kg:12,weight_kg:1,volume_m3:0.001 };
  assert.equal(weights([row]).get('00123').weight,12);
  assert.equal(weights([{...row,chargeable_weight_kg:3,weight_kg:100}]).get('00123').weight,3);
});
test('multiple routes produce one customer total and preserve delivery evidence', () => {
  const totals = weights([
    {customer_code:'00123',chargeable_weight_kg:6,fee_delivery_cad:5},
    {customer_code:'00123',chargeable_weight_kg:4},
  ]);
  assert.equal(totals.size,1);
  assert.equal(totals.get('00123').weight,10);
  assert.equal(totals.get('00123').hadDelivery,true);
});
test('missing or invalid saved weight never falls back to dimensions or zero', () => {
  for (const value of [null,undefined,'',false,-1,NaN,Infinity]) {
    assert.throws(()=>weights([{customer_code:'00123',chargeable_weight_kg:value,weight_kg:10}]),/00123/);
  }
  assert.equal(weights([{customer_code:'00123',chargeable_weight_kg:0}]).get('00123').weight,0);
});
test('confirmed and unrelated comparison customers do not require a weight', () => {
  const rows=[{customer_code:'00123',chargeable_weight_kg:7},{customer_code:'00456',chargeable_weight_kg:null}];
  assert.equal(weights(rows,new Set(['00456'])).size,1);
  assert.equal(weights(rows,new Set(),new Set(['00123'])).size,1);
  const current=weights([{customer_code:'00123',chargeable_weight_kg:3}]);
  assert.equal(current.get('00123').weight + weights(rows,new Set(),new Set(current.keys())).get('00123').weight,10);
});
