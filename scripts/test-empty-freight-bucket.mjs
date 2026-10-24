import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWeightOrders,weightTotal} from '../src/lib/batch-weight-snapshot.ts';
import {assertSnapshotNumbers} from '../src/lib/snapshot-validation.ts';
const source=fs.readFileSync('src/lib/orders.functions.ts','utf8');
const section=source.slice(source.indexOf('// === 9. Recompute'),source.indexOf('// === 10. Customs'));
const loop=section.slice(section.indexOf('  for (const b of buckets.values())')).replaceAll(' as any','');
const run=new (Object.getPrototypeOf(async function(){}).constructor)('buckets','mergedRuleMap','schemeOf','allWbs','oMap','fMap','buildWeightOrders','weightTotal','assertSnapshotNumbers','admin','computeFreight','fx',loop);
const bucket=(extra={})=>({customer_code:'06199',route_code:'海普活动',route_id:'hp',freight:0,freight_weight_inputs:[],freight_waybill_ids:new Set(),...extra});
const exec=(rows,wbs=[])=>run(new Map(rows.map((b,i)=>[i,b])),new Map([['hp',{unit_price_cad:3}]]),()=> 'split',wbs,new Map(),new Map(),buildWeightOrders,weightTotal,assertSnapshotNumbers,null,()=>{throw Error('unexpected merged pricing')},0.2);
test('child accounting bucket does not demand duplicate freight weight',async()=>{
 const child=bucket({customs:4,insurance:2});const owner=bucket({freight_weight_inputs:[{ref:'box'}],freight_waybill_ids:new Set(['w'])});
 await exec([child,owner],[{id:'w',weight_snapshot:{chargeable_weight:2}}]);
 assert.equal(child.freight,0);assert.equal(child.customs,4);assert.equal(child.insurance,2);assert.equal(owner.freight,6);
});
test('real parcel with missing snapshot still blocks pricing',async()=>{
 await assert.rejects(exec([bucket({freight_weight_inputs:[{ref:'box'}],freight_waybill_ids:new Set(['w'])})],[{id:'w'}]),/合计计费重量/);
 await assert.rejects(exec([bucket({freight_weight_inputs:[{ref:'empty box'}]})]),/合计计费重量/);
});

