import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import test from 'node:test';
import assert from 'node:assert/strict';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/delivery-summary.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Map});
const item=(kind,id,other={})=>({id,ref_id:id,kind,source_batch_id:'b',customer_code:'00123',customer_user_id:'u',created_at:'2026-10-05',weight_kg:1,fee_cny:0,...other});
test('customer pallet counts once and covers its carton and waybill',()=>{
 const groups=[...exports.groupDeliveryUnits([item('pallet','p'),item('carton','c',{pallet_id:'p'}),item('waybill','w',{carton_id:'c',pallet_id:'p'})]).values()];
 assert.equal(groups.length,1);assert.equal(groups[0].count,1);assert.equal(groups[0].pallet_count,1);assert.equal(groups[0].ids.length,3);
});
test('unlabelled containers do not count or suppress independent waybills',()=>{
 const g=[...exports.groupDeliveryUnits([item('pallet','p',{customer_code:null}),item('carton','c',{customer_code:' ',pallet_id:'p'}),item('waybill','w',{carton_id:'c',pallet_id:'p'})]).values()][0];
 assert.equal(g.count,1);assert.equal(g.waybill_count,1);assert.equal(g.carton_count,0);assert.equal(g.pallet_count,0);
});
test('customer carton inside an unlabelled pallet counts once',()=>{
 const g=[...exports.groupDeliveryUnits([item('pallet','p',{customer_code:null}),item('carton','c',{pallet_id:'p'}),item('waybill','w',{carton_id:'c',pallet_id:'p'})]).values()][0];
 assert.equal(g.count,1);assert.equal(g.carton_count,1);
});
test('same customer batches stay separate with independent action IDs',()=>{
 const g=[...exports.groupDeliveryUnits([item('waybill','w'),item('waybill','v',{source_batch_id:'b2'})]).values()];
 assert.equal(g.length,2);assert.equal(g[0].ids.length,1);assert.equal(g[1].ids[0],'v');
});
test('duplicate queue entries count once but remain in status update scope',()=>{
 const g=[...exports.groupDeliveryUnits([item('waybill','w'),item('waybill','w',{id:'dup'})]).values()][0];assert.equal(g.count,1);assert.equal(g.ids.length,2);
});
test('settlement totals/weight are not guessed when missing or stale',()=>{
 assert.equal(exports.deliverySettlementSummary(null,{}).total_cad,null);
 const st={confirmed:false,snapshot_at:'2026-01-01',subtotal_cad:23,fee_breakdown:{weight_version:1,chargeable_weight_kg:10}};
 assert.equal(exports.deliverySettlementSummary(st,{fees_dirty_at:'2026-02-01'}).chargeable_weight_kg,null);
 assert.equal(exports.deliverySettlementSummary({...st,confirmed:true,is_paid:true},{}).payment_label,'已付款');
 assert.equal(exports.deliverySettlementSummary({...st,confirmed:true},{}).total_cad,23);
});
test('notes migration is rerunnable and does not expose notes publicly',async()=>{
 const {PGlite}=await import('../outputs/db-test-runtime/node_modules/@electric-sql/pglite/dist/index.js');const db=new PGlite();
 try {
  await db.exec('create role service_role; create schema auth; create table auth.users(id uuid primary key); create table public.batches(id uuid primary key);');
  const sql=fs.readFileSync('supabase/migrations/20261005010000_batch_customer_notes.sql','utf8');await db.exec(sql);await db.exec(sql);
  const r=await db.query("select relrowsecurity from pg_class where oid='public.batch_customer_notes'::regclass");assert.equal(r.rows[0].relrowsecurity,true);
  await db.exec("insert into public.batches values ('00000000-0000-0000-0000-000000000001'); insert into public.batch_customer_notes(batch_id,customer_code,note) values ('00000000-0000-0000-0000-000000000001','00123','现金结算');");
  assert.equal((await db.query('select note from public.batch_customer_notes')).rows[0].note,'现金结算');
 } finally {await db.close();}
});
test('real list response includes batch name, payment and saved billing totals',()=>{
 const src=fs.readFileSync('src/lib/delivery-queue.functions.ts','utf8');
 const start=src.indexOf('    const list = Array.from(groups.values())');const end=src.indexOf('    return { groups: list, fx };',start);
 const code=ts.transpileModule(src.slice(start,end)+'\nlist;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const result=vm.runInNewContext(code,{groups:new Map([['g',{batch_id:'b',customer_code:'00123',fee_cny:0}]]),profileMap:new Map(),addrMap:new Map(),walletMap:new Map(),batchMap:new Map([['b',{display_name:'测试批次',batch_no:'B1'}]]),settlementMap:new Map([['b:00123',{confirmed:true,is_paid:true,subtotal_cad:123,fee_breakdown:{weight_version:1,chargeable_weight_kg:45}}]]),deliverySettlementSummary:exports.deliverySettlementSummary,fx:0.2});
 assert.equal(result[0].batch_name,'测试批次');assert.equal(result[0].payment_label,'已付款');assert.equal(result[0].total_cad,123);assert.equal(result[0].chargeable_weight_kg,45);
});
test('row dispatch and cancellation submit only the chosen batch and its item IDs',async()=>{
 const src=fs.readFileSync('src/routes/admin/delivery-queue.index.tsx','utf8');
 for(const [fn,next] of [['onDispatchAll','onCancelAll'],['onCancelAll','onDeduct']]) {
  const start=src.indexOf('  const '+fn+' =');const end=src.indexOf('  const '+next+' =',start);let sent;
  const code=ts.transpileModule(src.slice(start,end)+'\n'+fn+'(g);',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  await vm.runInNewContext(code,{g:{customer_user_id:'u',customer_code:'00123',batch_id:'b',ids:['one'],count:1},window:{confirm:()=>true},bulkUpdate:async r=>sent=r.data,refresh:async()=>{}});
  assert.equal(sent.batchId,'b');assert.deepEqual(sent.ids,['one']);
 }
});
