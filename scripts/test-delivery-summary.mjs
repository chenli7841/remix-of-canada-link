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
  const extraSql=fs.readFileSync('supabase/migrations/20261005020000_delivery_extra_fee.sql','utf8');await db.exec(extraSql);await db.exec(extraSql);
  const r=await db.query("select relrowsecurity from pg_class where oid='public.batch_customer_notes'::regclass");assert.equal(r.rows[0].relrowsecurity,true);
  await db.exec("insert into public.batches values ('00000000-0000-0000-0000-000000000001'); insert into public.batch_customer_notes(batch_id,customer_code,note) values ('00000000-0000-0000-0000-000000000001','00123','现金结算');");
  await db.exec("update public.batch_customer_notes set extra_fee_cny=0;");
  const saved=(await db.query('select note,extra_fee_cny from public.batch_customer_notes')).rows[0];assert.equal(saved.note,'现金结算');assert.equal(Number(saved.extra_fee_cny),0);
  await assert.rejects(db.exec('update public.batch_customer_notes set extra_fee_cny=-1'));
 } finally {await db.close();}
});
test('real list response includes batch name, payment and saved billing totals',()=>{
 const src=fs.readFileSync('src/lib/delivery-queue.functions.ts','utf8');
 const start=src.indexOf('    const list = Array.from(groups.values())');const end=src.indexOf('    return { groups: list, fx };',start);
 const code=ts.transpileModule(src.slice(start,end)+'\nlist;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const result=vm.runInNewContext(code,{groups:new Map([['g',{batch_id:'b',customer_code:'00123',fee_cny:35}]]),paidFees:new Set(['delivery-extra:b:00123']),extraFeeMap:new Map([['b:00123',0]]),settlementNoteMap:new Map([['b:00123','月结']]),profileMap:new Map(),addrMap:new Map(),walletMap:new Map(),batchMap:new Map([['b',{display_name:'测试批次',batch_no:'B1'}]]),settlementMap:new Map([['b:00123',{confirmed:true,is_paid:true,subtotal_cad:123,fee_breakdown:{weight_version:1,chargeable_weight_kg:45}}]]),deliverySettlementSummary:exports.deliverySettlementSummary,fx:0.2});
 assert.equal(result[0].extra_fee_paid,true);assert.equal(result[0].fee_cny,0);assert.equal(result[0].fee_cad,0);assert.equal(result[0].batch_name,'测试批次');assert.equal(result[0].payment_label,'已付款');assert.equal(result[0].total_cad,123);assert.equal(result[0].chargeable_weight_kg,45);assert.equal(result[0].settlement_note,'月结');
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

test('extra fee rejects negative, invalid or overprecision amounts and accepts zero',()=>{
 const src=fs.readFileSync('src/lib/batch-customer-notes.functions.ts','utf8');const start=src.indexOf('.inputValidator(',src.indexOf('export const saveDeliveryExtraFee'))+'.inputValidator('.length;const end=src.indexOf(').handler',start);
 const js=ts.transpileModule('const validate='+src.slice(start,end)+';validate;', {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const validate=vm.runInNewContext(js,{Number,Math,Error});
 for(const amountCny of [-1,NaN,Infinity,1.001,'1',10000000000]) assert.throws(()=>validate({batchId:'b',customerCode:'00123',amountCny}));
 for(const amountCny of [0,0.01,123.45]) assert.equal(validate({batchId:'b',customerCode:'00123',amountCny}).amountCny,amountCny);
});

test('extra fee reference prevents a second debit for the same customer and batch',async()=>{
 const {PGlite}=await import('../outputs/db-test-runtime/node_modules/@electric-sql/pglite/dist/index.js');const db=new PGlite();
 try {
  await db.exec(`create table wallet_transactions(id serial primary key, ref_no text, amount_cad numeric); create table balances(value numeric); insert into balances values(100); create function debit() returns trigger language plpgsql as $$ begin update balances set value=value-new.amount_cad; return new; end $$; create trigger debit after insert on wallet_transactions for each row execute function debit();`);
  const migration=fs.readFileSync('supabase/migrations/20260909160000_wallet_recharge_apps.sql','utf8');
  await db.exec(migration.match(/CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_ref_no_unique[\s\S]*?;/)[0]);
  await db.query('insert into wallet_transactions(ref_no,amount_cad) values ($1,10)',['delivery-extra:b:00123']);
  await assert.rejects(db.query('insert into wallet_transactions(ref_no,amount_cad) values ($1,10)',['delivery-extra:b:00123']));
  assert.equal(Number((await db.query('select value from balances')).rows[0].value),90);
  await db.query('insert into wallet_transactions(ref_no,amount_cad) values ($1,10)',['delivery-extra:b2:00123']);
  assert.equal(Number((await db.query('select value from balances')).rows[0].value),80);
 } finally {await db.close();}
});
