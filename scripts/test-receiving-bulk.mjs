import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
const source = fs.readFileSync('src/lib/receiving-bulk.server.ts', 'utf8');
const exports = {};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports, Date, Map, Error });
function database({ status = 'matched', failRead = false, failWrite = false, batch = 'b' } = {}) {
  const tables = {
    pallets: [{ id: 'p', batch_id: 'b', pallet_no: 'PAL1' }],
    cartons: [{ id: 'c', pallet_id: 'p', carton_no: 'BOX1' }],
    waybills: Array.from({length: 1101}, (_, i) => ({ id: String(i).padStart(4, '0'), waybill_no: 'WB' + i, carton_id: 'c', ...(i === 0 ? { assigned_batch_id: 'b' } : {}) })),
    receivings: [{ id: 'r', batch_id: batch, status }],
    receiving_scans: [{ receiving_id: 'r', kind: 'waybill', ref_id: '0000', operator_id: 'original', scanned_at: 'original' }],
  };
  let writes = 0;
  return { tables, get writes(){ return writes; }, from(table) {
    let filtered = tables[table];
    const query = {
      select(){ return this; }, order(){ return this; },
      in(col, ids){ filtered = filtered.filter(r => ids.includes(r[col])); return this; },
      eq(col, value){ filtered = filtered.filter(r => r[col] === value); return this; },
      single(){ return Promise.resolve({data: filtered[0]}); },
      range(a,b){ return Promise.resolve(failRead ? {error: {message: 'read failed'}} : {data: filtered.slice(a,b+1)}); },
      upsert(rows, options){
        writes++;
        assert.equal(options.ignoreDuplicates, true);
        if(failWrite) return Promise.resolve({error: {message: 'write failed'}});
        for(const row of rows) if(!tables.receiving_scans.some(s => s.receiving_id === row.receiving_id && s.kind === row.kind && s.ref_id === row.ref_id)) tables.receiving_scans.push(row);
        return Promise.resolve({error: null});
      },
    }; return query;
  }};
}
test('includes nested contents, every page, and deduplicates direct/nested links', async()=>{
 const db=database(); const r=await exports.recordAllReceivingScans(db,'r','b','staff');
 assert.equal(r.waybills,1101);assert.equal(r.cartons,1);assert.equal(r.pallets,1);assert.equal(db.tables.receiving_scans.length,1103);
 await exports.recordAllReceivingScans(db,'r','b','second');
 assert.equal(db.tables.receiving_scans.length,1103);assert.equal(db.tables.receiving_scans[0].operator_id,'original');assert.equal(db.tables.receiving_scans[0].scanned_at,'original');
});
for(const opts of [{status:'confirmed'},{status:'closed'},{batch:'changed'},{failRead:true}]) test('refuses invalid state or failed reads '+JSON.stringify(opts),async()=>{
 const db=database(opts);await assert.rejects(exports.recordAllReceivingScans(db,'r','b','staff'));assert.equal(db.writes,0);
});
test('write failure does not report success',async()=>{await assert.rejects(exports.recordAllReceivingScans(database({failWrite:true}),'r','b','staff'),/一键匹配失败/);});
test('either confirmation can cancel without making a request',async()=>{
 const src=fs.readFileSync('src/routes/admin/receivings.$receivingId.tsx','utf8');
 const start=src.indexOf('  const onMatchAll = async () => {');const end=src.indexOf('  const onConfirm',start);
 const code=ts.transpileModule(src.slice(start,end)+'\nonMatchAll();',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 for(const answers of [[false],[true,false],[true,true]]) {
  let calls=0,confirms=0;
  await vm.runInNewContext(code,{busy:false,isFinal:false,r:{batch_id:'b'},receivingId:'r',window:{confirm:()=>answers[confirms++]},setBusy(){},matchAll:async()=>{calls++;return{counts:{waybills:1,cartons:0,pallets:0}}},setLog(){},refresh:async()=>{},alert(){},Date});
  assert.equal(calls,answers.every(Boolean)?1:0);assert.equal(confirms,answers.length);
 }
});
