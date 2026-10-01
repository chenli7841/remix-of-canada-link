import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const module = {exports:{}};
vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/return-reminder.server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require});
const {collectReturnReminders,assertReturnReminder}=module.exports;
function fixture(extra={}) {
 const tables={pallets:[{id:'p',batch_id:'b'}],cartons:[{id:'c',pallet_id:'p'}],waybills:[{id:'w',waybill_no:'WB1',carton_id:'c',forwarding_id:'f'},{id:'w2',pallet_id:'p',forwarding_id:'f'}],forwarding_orders:[{id:'f',request_no:'FW1',return_reminder:true,note:'请退回原寄件人'}],...extra};
 const db={from(table){let result=tables[table]??[];const q={select(){return q},in(col,ids){result=result.filter(r=>ids.includes(r[col]));return q},eq(col,v){result=result.filter(r=>r[col]===v);return q},order(){return q},range(a,b){result=result.slice(a,b+1);return q},then(resolve){return Promise.resolve({data:result,error:null}).then(resolve)}};return q;}};
 return {db,tables};
}
test('pallet -> carton -> waybill inherits the order reminder and deduplicates',async()=>{const {db}=fixture();const r=await collectReturnReminders(db,{palletIds:['p']});assert.equal(r.length,1);assert.equal(r[0].number,'FW1');});
test('scan and direct carton paths both find parent order',async()=>{const {db}=fixture();assert.equal((await collectReturnReminders(db,{code:' WB1 '})).length,1);assert.equal((await collectReturnReminders(db,{cartonIds:['c']})).length,1);});
test('orders attached to a carton before waybills exist still warn',async()=>{const {db}=fixture({waybills:[],forwarding_orders:[{id:'f',request_no:'FW1',carton_id:'c',return_reminder:true}]});assert.equal((await collectReturnReminders(db,{palletIds:['p']})).length,1);});
test('batch descendants and direct forwarding intake are checked',async()=>{const {db}=fixture();assert.equal((await collectReturnReminders(db,{batchIds:['b']})).length,1);assert.equal((await collectReturnReminders(db,{forwardingIds:['f']})).length,1);});
test('unrelated and disabled orders do not warn',async()=>{const {db,tables}=fixture();assert.equal((await collectReturnReminders(db,{waybillIds:['missing']})).length,0);tables.forwarding_orders[0].return_reminder=false;await assertReturnReminder(db,'intake',{}, {forwardingIds:['f']});});
test('acknowledgement must match operation, payload and current note; flag stays enabled',async()=>{const {db,tables}=fixture();const target={forwardingIds:['f']};let warning;try{await assertReturnReminder(db,'intake',{id:'f'},target);}catch(e){warning=JSON.parse(e.message.slice('RETURN_REMINDER:'.length));}assert.ok(warning.token);const payload={id:'f',__returnReminderAck:warning.token};await assertReturnReminder(db,'intake',payload,target);await assert.rejects(()=>assertReturnReminder(db,'pack',payload,target),/RETURN_REMINDER/);await assert.rejects(()=>assertReturnReminder(db,'intake',{...payload,id:'other'},target),/RETURN_REMINDER/);tables.forwarding_orders[0].note='新增退运要求';await assert.rejects(()=>assertReturnReminder(db,'intake',payload,target),/RETURN_REMINDER/);assert.equal(tables.forwarding_orders[0].return_reminder,true);});
test('large containers are paginated, including a flagged order beyond row 1000',async()=>{const waybills=Array.from({length:1100},(_,i)=>({id:String(i),carton_id:'c',forwarding_id:i===1099?'f':null}));const {db}=fixture({waybills});assert.equal((await collectReturnReminders(db,{cartonIds:['c']})).length,1);});
test('lookup failures fail closed',async()=>{const db={from(){const q={select(){return q},in(){return q},order(){return q},range(){return Promise.resolve({error:{message:'offline'}})}};return q;}};await assert.rejects(()=>collectReturnReminders(db,{forwardingIds:['f']}),/读取失败/);});
function clientFixture(accept) {
 const m={exports:{}};let dialogs=0;
 const mocks={'@tanstack/react-start':{useServerFn:fn=>fn},'react-dom/client':{createRoot:()=>({unmount(){},render(tree){dialogs++;const buttons=[];function walk(n){if(!n||typeof n!=='object')return;if(n.type==='button')buttons.push(n);const c=n.props?.children;(Array.isArray(c)?c:[c]).forEach(walk);}walk(tree);queueMicrotask(()=>buttons[accept?1:0].props.onClick());}})}};
 vm.runInNewContext(ts.transpileModule(readFileSync('src/components/admin/useReturnReminder.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,require:id=>mocks[id]||require(id),Error,document:{createElement:()=>({remove(){}}),body:{appendChild(){}}}});
 return {use:m.exports.useReturnReminder,dialogs:()=>dialogs};
}
test('cancel in reminder card never retries the operation',async()=>{const c=clientFixture(false);let calls=0;const run=c.use(async()=>{calls++;throw new Error('RETURN_REMINDER:'+JSON.stringify({token:'t',reminders:[{id:'f',number:'FW1',note:'退运'}]}));});await assert.rejects(()=>run({data:{id:'f'}}),/已取消/);assert.equal(calls,1);assert.equal(c.dialogs(),1);});
test('confirm retries only with acknowledgement and preserves original data',async()=>{const c=clientFixture(true);const calls=[];const run=c.use(async options=>{calls.push(options.data);if(!options.data.__returnReminderAck)throw new Error('RETURN_REMINDER:'+JSON.stringify({token:'t',reminders:[{id:'f',number:'FW1',note:'退运'}]}));return {ok:true};});assert.equal((await run({data:{id:'f',waybillIds:['w']}})).ok,true);assert.equal(calls.length,2);assert.equal(calls[1].__returnReminderAck,'t');assert.equal(calls[1].waybillIds[0],'w');assert.equal(c.dialogs(),1);});
test('ordinary errors are not retried or presented as reminders',async()=>{const c=clientFixture(true);const run=c.use(async()=>{throw Error('保存失败');});await assert.rejects(()=>run({data:{}}),/保存失败/);assert.equal(c.dialogs(),0);});
