import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
const source=fs.readFileSync('src/lib/delivery-queue.functions.ts','utf8');
const start=source.indexOf('    // Keep batches independent;');
const end=source.indexOf('    await logAction',start);
const code=ts.transpileModule('(async()=>{'+source.slice(start,end)+'return {inserted,skipped};})()', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const stored=[];
const admin={from(table){assert.equal(table,'delivery_queue');return {async upsert(rows,options){
 assert.equal(options.onConflict,'kind,ref_id,status');assert.equal(options.ignoreDuplicates,true);
 let count=0;
 for(const row of rows) if(!stored.some(r=>r.kind===row.kind&&r.ref_id===row.ref_id&&r.status===row.status)){stored.push({...row});count++;}
 return {error:null,count};
}};}};
const prepare=rows=>vm.runInNewContext(code,{rows,supabaseAdmin:admin,readDeliveryRows:async()=>stored.map(r=>({...r})),Set,Error});
const row=(ref_id,batch)=>({kind:'carton',ref_id,status:'pending',source_batch_id:batch,customer_code:'00123'});
await Promise.all([prepare([row('box1','batch1')]),prepare([row('box1','batch1')]),prepare([row('box2','batch2')])]);
assert.equal(stored.length,2);
assert.deepEqual(stored.map(r=>r.source_batch_id).sort(),['batch1','batch2']);
assert.equal((await prepare([row('box1','batch1')])).inserted,0);
stored[0].status='dispatched';
assert.equal((await prepare([row('box1','batch1')])).inserted,0);
await assert.rejects(vm.runInNewContext(code,{rows:[row('box3','batch3')],supabaseAdmin:admin,readDeliveryRows:async()=>{throw new Error('读取失败');},Set,Error}),/读取失败/);
assert.equal(stored.length,2);
console.log('准备派送测试通过：并发去重、同客户多批次独立、重复准备不覆盖、已派送不重新加入、读取失败停止。');
