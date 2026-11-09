import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/receiving-scan.server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
function db(count=1){const tables={cartons:[{id:'c',carton_no:'34061-1',pallet_id:'p'}],pallets:[{id:'p',pallet_no:'PAL1',batch_id:'b'}],batches:[],forwarding_orders:[{id:'f',request_no:'FW1',domestic_tracking_no:'YT123'}],orders:[],waybills:Array.from({length:count},(_,i)=>({id:'w'+i,waybill_no:'SC'+i,forwarding_id:'f',carton_id:'c'}))};return{from(t){let rows=tables[t];return{select(){return this},eq(k,v){rows=rows.filter(r=>r[k]===v);return this},maybeSingle:async()=>({data:rows[0]}),limit:async n=>({data:rows.slice(0,n)})}},rpc:async(_,a)=>({data:a._input==='OLD' ? {kind:'forwarding',id:'f'} : a._input==='SC0' ? {kind:'waybill',id:'w0'} : null})}}
const scan=exports.resolveReceivingCode;
assert.equal((await scan(db(),'FW1')).ref_id,'w0');assert.equal((await scan(db(),'SC0')).ref_id,'w0');
assert.equal((await scan(db(),'OLD')).batchId,'b');assert.equal((await scan(db(),'34061-1')).kind,'carton');assert.equal((await scan(db(),'PAL1')).kind,'pallet');
await assert.rejects(scan(db(2),'FW1'),/多个运单/);await assert.rejects(scan(db(2),'OLD'),/多个运单/);await assert.rejects(scan(db(0),'FW1'),/尚无运单/);
console.log('通过：单运单订单等效扫描、多运单拦截、旧订单号、数字箱号、托盘及嵌套批次');

assert.equal((await scan(db(),'YT123')).ref_id,'w0');
await assert.rejects(scan(db(2),'YT123'),/多个运单/);
await assert.rejects(scan(db(),'3'),exports.ReceivingCodeError);
console.log('通过：国内单号唯一匹配、多运单拦截、未知条码分类');
