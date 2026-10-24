import fs from 'node:fs';import ts from 'typescript';import assert from 'node:assert/strict';
const source=fs.readFileSync('src/lib/driver-route-addresses.ts','utf8');const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const exp={};new Function('exports',js)(exp);const {resolveDriverRouteAddresses:resolve,driverRouteMapKey:key}=exp;
const route={origin:'Warehouse',plans:[{origin:'Warehouse',stops:[{address:'Old',customers:[{customer_code:'1',address:'Old',ids:['a'],groups:[{ids:['a'],address:'Old'}]},{customer_code:'2',address:'Old',ids:['b'],groups:[]}]}]}]};
const next=resolve(route,[{ids:['a'],address:'New',city:'Toronto',phone:'123'}]);assert.equal(next.plans[0].stops.length,2);assert.equal(next.plans[0].stops[0].customers[0].groups[0].address,'New');assert.equal(next.plans[0].stops[1].address,'Old');assert.equal(route.plans[0].stops[0].address,'Old');assert.notEqual(key({id:'t',route}),key({id:'t',route:next}));
const many={origin:'Warehouse',plans:[{origin:'Warehouse',stops:Array.from({length:22},(_,i)=>({address:'A'+i,customers:[{ids:[String(i)],address:'A'+i}]}))}]};const split=resolve(many,[{ids:['20'],address:'Moved'}]);assert.equal(split.plans.length,2);assert.equal(split.plans[1].origin,'Moved');assert.equal(split.plans[0].stops.length,21);assert.equal(split.plans.flatMap(p=>p.stops).length,22);assert.equal(resolve(null,[]),null);console.log('PASS: shared-stop split, nested address, immutable source, map invalidation, 21-stop boundary and next-plan origin');

const partial={origin:'W',plans:[{origin:'W',stops:[{address:'Old',customers:[{customer_code:'1',address:'Old',ids:['a','b'],groups:[{batch_id:'one',ids:['a'],address:'Old'},{batch_id:'two',ids:['b'],address:'Old'}]}]}]}]};
const moved=resolve(partial,[{ids:['a'],address:'New',city:'Toronto'}]);assert.deepEqual(moved.plans[0].stops.map(s=>s.customers[0].ids),[['a'],['b']]);assert.equal(moved.plans[0].stops[1].customers[0].groups[0].batch_id,'two');
const groupJs=ts.transpileModule(fs.readFileSync('src/lib/delivery-summary.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const groupExports={};new Function('exports',groupJs)(groupExports);
const mk=(id,address)=>({id,kind:'waybill',ref_id:id,source_batch_id:'batch',customer_code:'00001',customer_user_id:'user',created_at:'2026',address_snapshot:{line1:address}});
const groups=[...groupExports.groupDeliveryUnits([mk('a','First'),mk('b','Second')]).values()];assert.equal(groups.length,2);assert.deepEqual(groups[0].address_versions,{a:{line1:'First'}});console.log('PASS: partial customer move preserves other batch; frozen addresses group separately and carry concurrency versions');

const navRoute={plans:[{stops:[{customers:[{customer_code:'1',ids:['a']}]},{customers:[{customer_code:'2',ids:['b']},{customer_code:'3',ids:['c']}]}]},{stops:[{customers:[{customer_code:'2',ids:['d']}]}]}]};
const navItems=[{queue_id:'a',unit:{status:'pending'}},{queue_id:'b',unit:{status:'dispatched'}},{queue_id:'c',unit:{status:'cancelled'}},{queue_id:'d',unit:{status:'pending'}}];
const nav=exp.pendingCustomerNeighbors(navRoute,navItems,{customer_code:'2',ids:['b']});
assert.equal(nav.previous.customer.customer_code,'1');assert.deepEqual(nav.next.customer.ids,['d']);assert.equal(nav.next.planIndex,1);assert.equal(nav.next.stopIndex,0);
assert.equal(exp.pendingCustomerNeighbors(navRoute,navItems,{customer_code:'1',ids:['a']}).previous,null);
assert.equal(exp.pendingCustomerNeighbors(navRoute,navItems,{customer_code:'2',ids:['d']}).next,null);
assert.equal(exp.pendingCustomerNeighbors(navRoute,[],{customer_code:'2',ids:['b']}).next,null);
console.log('PASS: navigation skips completed/cancelled customers, preserves completed anchor, distinguishes repeated customer addresses and map letters');
