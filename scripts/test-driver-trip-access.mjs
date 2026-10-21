import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const chain=new Proxy(function(){return chain;},{get:()=>chain});
const mod={exports:{}};
const js=ts.transpileModule(readFileSync('src/lib/driver-trips.functions.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInNewContext(js+'\nmodule.exports.checkOwnership=owned;',{module:mod,exports:mod.exports,require:id=>id==='zod'?{z:chain}:id==='@tanstack/react-start'?{createServerFn:()=>chain}:{}});
function admin(staff){const query={select(){return this},eq(){return this},single:async()=>({data:{id:'trip',driver_id:'driver-a'},error:null})};return {from:()=>query,rpc:async()=>({data:staff,error:null})};}
test('driver can access own trip',async()=>{assert.equal((await mod.exports.checkOwnership(admin(false),'driver-a','trip')).id,'trip');});
test('driver cannot access another driver trip',async()=>{await assert.rejects(mod.exports.checkOwnership(admin(false),'driver-b','trip'),/无权/);});
test('staff can manage a driver trip',async()=>{assert.equal((await mod.exports.checkOwnership(admin(true),'staff','trip')).driver_id,'driver-a');});
