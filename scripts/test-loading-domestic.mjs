import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const records={cartons:[{id:'c1',pallet_id:'p1'}],waybills:[{id:'w1',carton_id:'c1',forwarding_id:'f1'},{id:'w2',carton_id:'c1',forwarding_id:'f1'},{id:'w3',forwarding_id:'f2'}],forwarding_orders:[{id:'f1',domestic_tracking_no:'SF123'},{id:'f2',domestic_tracking_no:null}],orders:[]};
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/loading-domestic.server.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,require:()=>({readBatchRowsByIds:async(_,table,columns,key,ids)=>records[table].filter(r=>ids.includes(r[key]))})});
test('domestic numbers resolve cartons and nested pallets, preserve repeated numbers and omit missing',async()=>{
 const result=await module.exports.loadUnitDomesticNumbers({},[{id:'box',kind:'carton',ref_id:'c1'},{id:'pallet',kind:'pallet',ref_id:'p1'},{id:'single',kind:'waybill',ref_id:'w1'},{id:'empty',kind:'waybill',ref_id:'w3'}]);
 assert.deepEqual(Array.from(result.get('box')),['SF123','SF123']);assert.deepEqual(Array.from(result.get('pallet')),['SF123','SF123']);assert.deepEqual(Array.from(result.get('single')),['SF123']);assert.equal(result.get('empty').length,0);
});
