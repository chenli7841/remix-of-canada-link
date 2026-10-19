import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync('src/lib/wecom-daily-notify.server.ts','utf8'), {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {recordWecomRechargeFailure} = await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
function database(status='cancelled') {
  const tables={wallet_transactions:[{id:'tx1',user_id:'u1',type:'recharge',status,created_at:'2026-10-19T16:30:00Z',amount_cad:25,channel:'card'}],profiles:[{id:'u1',customer_code:'01971'}],wecom_daily_notification_events:[],wecom_daily_notification_drafts:[]};
  const admin={from(table){let filters=[],single=false;const q={select(){return q},eq(k,v){filters.push(x=>x[k]===v);return q},order(){return q},single(){single=true;return q},maybeSingle(){single=true;return q},upsert(row,options){const key=options.onConflict.split(',');const existing=tables[table].find(x=>key.every(k=>x[k]===row[k]));if(existing){if(!options.ignoreDuplicates)Object.assign(existing,row)}else tables[table].push({...row});return Promise.resolve({error:null})},then(resolve){let rows=tables[table].filter(x=>filters.every(f=>f(x)));return Promise.resolve({data:single?rows[0]??null:rows,error:null}).then(resolve)}};return q}};
  return {admin,tables};
}
test('failure renders time, CAD, channel and result without changing wallet transaction',async()=>{
 const {admin,tables}=database();const before=JSON.stringify(tables.wallet_transactions);
 await recordWecomRechargeFailure(admin,'tx1');
 const text=tables.wecom_daily_notification_drafts[0].rendered_content;
 for(const expected of ['【余额】','2026/10/19','12:30','CAD 25.00','信用卡','充值不成功'])assert.ok(text.includes(expected),text);
 assert.equal(JSON.stringify(tables.wallet_transactions),before);
 await recordWecomRechargeFailure(admin,'tx1');assert.equal(tables.wecom_daily_notification_events.length,1);
 assert.equal(tables.wecom_daily_notification_drafts[0].sections.rechargeFailures.length,1);
});
test('pending and completed transactions cannot generate failure notices',async()=>{
 for(const status of ['pending','completed']){const {admin,tables}=database(status);await assert.rejects(recordWecomRechargeFailure(admin,'tx1'));assert.equal(tables.wecom_daily_notification_events.length,0)}
});
test('retry of submitted notice does not create a duplicate',async()=>{
 const {admin,tables}=database();await recordWecomRechargeFailure(admin,'tx1');tables.wecom_daily_notification_drafts[0].status='submitted';await recordWecomRechargeFailure(admin,'tx1');assert.equal(tables.wecom_daily_notification_events.length,1);assert.equal(tables.wecom_daily_notification_drafts.length,1);
});
