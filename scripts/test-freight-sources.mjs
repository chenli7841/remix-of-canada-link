import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';
const compiled = await transform(readFileSync('src/lib/freight-allocation.ts','utf8'), { loader:'ts', format:'esm' });
const { allocateContainerFreight: allocate } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}`);
const sum = result => [...result.values()].reduce((n,r)=>n+Math.round(r.freight_cad*100),0);
test('ordinary four-waybill order preserves CAD 8.70 without parcel minimums',()=>{
  assert.equal(sum(allocate([1.5,1.8,1.5,3.9].map((freight_cad,i)=>({id:String(i),freight_cad})),[],[])),870);
});
test('merged pallet overrides merged carton and leaves exactly once',()=>{
  const result=allocate([{id:'a',freight_cad:2,carton_id:'c'},{id:'b',freight_cad:4,pallet_id:'p'}],
    [{id:'c',pallet_id:'p',billing_mode:'merged',self_freight_cad:10}], [{id:'p',billing_mode:'merged',self_freight_cad:15}]);
  assert.equal(sum(result),1500); assert.equal(result.get('a').source,'p'); assert.equal(result.get('a').freight_cad,5);
});
test('split pallet respects merged carton and ordinary siblings',()=>{
  const result=allocate([{id:'a',freight_cad:2,carton_id:'c'},{id:'b',freight_cad:4,pallet_id:'p'}],
    [{id:'c',pallet_id:'p',billing_mode:'merged',self_freight_cad:10}], [{id:'p',billing_mode:'split',self_freight_cad:99}]);
  assert.equal(sum(result),1400);
});
test('allocation cents conserve total, remain stable across input order, and deduplicate leaves',()=>{
  const leaves=['a','b','c'].map(id=>({id,freight_cad:1,carton_id:'x'}));
  const cartons=[{id:'x',billing_mode:'merged',self_freight_cad:10}];
  const a=allocate(leaves,cartons,[]), b=allocate([...leaves].reverse().concat(leaves[0]),cartons,[]);
  assert.deepEqual(a,b);assert.equal(sum(a),1000);assert.equal(a.get('a').freight_cad,3.34);
});
test('missing basis and zero-basis nonzero container cannot silently create bills',()=>{
  assert.throws(()=>allocate([{id:'a',freight_cad:null}],[],[]));
  assert.throws(()=>allocate([{id:'a',freight_cad:0,carton_id:'c'}],[{id:'c',billing_mode:'merged',self_freight_cad:5}],[]));
});

const measuredModule = await transform(readFileSync('src/lib/measured-freight.ts','utf8'), {loader:'ts',format:'esm'});
const {measuredFreight} = await import('data:text/javascript;base64,'+Buffer.from(measuredModule.code).toString('base64'));
test('measurement ignores all legacy minimum fields',()=>{
 const rule={unit_price_cad:3,volumetric_divisor:5000,min_charge_waybill_cad:2,min_charge_batch_cad:50,min_charge_cny:100};
 const amounts=[.5,.6,.5,1.3].map(weight=>measuredFreight(rule,{weight,length:10,width:10,height:10},.2).freight_cad);
 assert.deepEqual(amounts,[1.5,1.8,1.5,3.9]);
});
test('measurement uses dimensional weight and explicit pallet pricing',()=>{
 assert.equal(measuredFreight({unit_price_cad:3,volumetric_divisor:5000},{weight:1,length:50,width:50,height:50},.2).freight_cad,75);
 assert.equal(measuredFreight({pricing_mode:'pallet',pallet_unit_price_cad:30,pallet_max_length_cm:100,pallet_max_width_cm:100,pallet_max_height_cm:200,pallet_max_weight_kg:1000},{weight:100,length:150,width:100,height:100},.2).freight_cad,60);
});
