import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
import {test} from 'node:test';
const source=fs.readFileSync('src/routes/_authenticated/forwarding.index.tsx','utf8');
const start=source.indexOf('    if (busy) return;');
const end=source.indexOf('\n  };',start);
const js=ts.transpileModule('(async()=>{'+source.slice(start,end)+'})()', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
for(const mode of ['partial','all','network'])test(mode+' submission preserves failed drafts and reports each outcome',async()=>{
 const state={};let n=0;
 const parcels=[{tracking_no:'A',items:[{name:'商品'}]},{tracking_no:'B',items:[{name:'商品'}]}];
 const ctx={busy:false,parcels,selectedWarehouse:{code:'YW'},selectedRoute:{code:'HP'},addressId:null,insuranceAllowed:false,insured:false,lang:'zh',note:'',setBusy:v=>state.busy=v,setSubmitResults:v=>state.results=v,setParcels:v=>state.parcels=v,setDone:v=>state.done=v,toast:{error(){},info(){}},tr:x=>x,setTimeout,sb:{rpc:async()=>{n++;if(n===1&&mode==='network')throw Error('网络中断');if(n===1&&mode==='partial')return {error:{message:'校验失败'}};return {data:{ok:true,request_no:'TEST',waybills:0}};}}};
 await vm.runInNewContext(js,ctx);
 assert.equal(state.busy,false);assert.equal(state.results.length,2);
 if(mode==='all'){assert.equal(state.done.count,2);}else{assert.equal(state.done,undefined);assert.equal(state.parcels.length,1);assert.equal(state.parcels[0].tracking_no,'A');assert.equal(state.results[0].ok,false);assert.equal(state.results[1].ok,true);}
});
test('Chinese log labels and nested details',()=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/admin-log-labels.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports});assert.equal(exports.logActionLabel('create_forwarding'),'创建集运单');assert.equal(exports.logActionLabel('scan_add_to_carton'),'扫码加入箱号');assert.equal(exports.logActionLabel('unknown_future_action'),'其他操作');assert.match(exports.logDetailsText({before:{status:'pending'}}),/修改前：状态：待处理/);});
test('order list distinguishes query failure from an empty list and cancels stale loads',async()=>{
 const src=fs.readFileSync('src/routes/_authenticated/account.tsx','utf8');const start=src.indexOf('function MyOrdersTab(');const effectStart=src.indexOf('  useEffect(() => {',start)+'  useEffect(() => {'.length;const effectEnd=src.indexOf('  }, [reloadKey]);',effectStart);const code=ts.transpileModule('(function(){'+src.slice(effectStart,effectEnd)+'})()', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const cancel of [false,true]){const state={};const query={select(){return this},order(){return Promise.resolve({error:{message:'network'},data:null})}};const cleanup=vm.runInNewContext(code,{sb:{from:()=>query},setLoadError:v=>state.error=v,setItems:v=>state.items=v});if(cancel)cleanup();await new Promise(r=>setTimeout(r,0));assert.equal(state.error,!cancel);assert.equal(state.items,null);}
});
