import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { test } from 'node:test';
function setup(rows, fail=false) {
 const calls=[]; const parents=[]; const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/batch-status-sync.server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:()=>({loadBatchWaybills:async()=>rows})});
 const admin={from:()=>({update(value){let ids,states;return {in(key,v){if(key==='id')ids=v;else states=v;return this;},async select(){calls.push({value,ids,states});return {data:ids.map(id=>({id})),error:fail?{message:'failed'}:null};}};}}),rpc:async(_,args)=>{parents.push(args);return {error:null};}};
 return {run:status=>module.exports.syncBatchWaybillStatus(admin,'batch',status),calls,parents};
}
test('shipping advances packed children and preserves downstream states',async()=>{
 const s=setup(['packed','received','shipped','arrived','in_transit','ready_pickup','delivered','cancelled'].map((status,i)=>({id:String(i),status,forwarding_id:'parent'})));
 assert.equal(await s.run('shipped'),2);assert.deepEqual([...s.calls[0].ids],['0','1']);assert.equal(s.parents.length,1);
});
test('arrival advances shipped children; retry repairs parent even with no child update',async()=>{
 const s=setup([{id:'a',status:'shipped',order_id:'order'}]);assert.equal(await s.run('arrived'),1);
 const retry=setup([{id:'a',status:'shipped',forwarding_id:'parent'}]);assert.equal(await retry.run('shipped'),0);assert.equal(retry.parents.length,1);
});
test('sync failures propagate and do not report success',async()=>{const s=setup([{id:'a',status:'packed'}],true);await assert.rejects(s.run('shipped'),/failed/);});
test('non logistics transitions do not change children',async()=>{const s=setup([{id:'a',status:'packed'}]);assert.equal(await s.run('draft'),0);assert.equal(s.calls.length,0);assert.equal(s.parents.length,0);});

