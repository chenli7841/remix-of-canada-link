import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/receiving-differences.server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
const tables={waybills:[{id:'w',waybill_no:'SC1',carton_id:'c'}],cartons:[{id:'c',carton_no:'C1',pallet_id:'p'}],pallets:[{id:'p',pallet_no:'P1',batch_id:'b'}],batches:[{id:'b',batch_no:'B1',display_name:'7月批次'}]};
const db={from:t=>({select(){return this},in:async(_,ids)=>({data:tables[t].filter(r=>ids.includes(r.id))})})};
const result=await exports.receivingDifferenceDetails(db,[{kind:'waybill',ref_id:'w'},{kind:'carton',ref_id:'c'},{kind:'pallet',ref_id:'p'}]);
assert.ok(result.every(r=>r.batch?.batch_no==='B1'));assert.equal(result[0].carton_no,'C1');assert.equal(result[0].pallet_no,'P1');
console.log('通过：差异包裹、箱号、托盘继承原批次显示');
