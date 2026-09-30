import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
function setup(staff=true,dbError=false){
 const writes=[];const module={exports:{}};
 const db={from(table){const q={select(){return q},eq(k,v){q.id=v;return q},update(value){writes.push({table,value});return q},single:async()=>({data:{note:'检查配件',intake_reminder:true},error:dbError?{}:null})};return q;}};
 const builder=()=>{let schema;return {middleware(){return this},inputValidator(s){schema=s;return this},handler(fn){return data=>fn({data:schema.parse(data),context:{userId:'staff',supabase:{rpc:async()=>({data:staff})}}})}}};
 const mocks={'@tanstack/react-start':{createServerFn:builder},'@/integrations/supabase/auth-middleware':{requireSupabaseAuth:{}},'@/integrations/supabase/client.server':{supabaseAdmin:db}};
 vm.runInNewContext(ts.transpileModule(readFileSync('src/lib/intake-reminder.functions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:id=>mocks[id]||require(id)});
 return {...module.exports,writes};
}
const target={kind:'forwarding',id:'11111111-1111-4111-8111-111111111111'};
test('separate buttons update only their own field',async()=>{const s=setup();await s.saveOrderNoteOnly({...target,note:'新备注'});await s.saveOrderReminderOnly({...target,intake_reminder:false});assert.deepEqual(Object.keys(s.writes[0].value),['note']);assert.deepEqual(Object.keys(s.writes[1].value),['intake_reminder']);});
test('cannot erase saved note while reminder is enabled',async()=>{const s=setup();await assert.rejects(()=>s.saveOrderNoteOnly({...target,note:''}),/先关闭特别提醒/);assert.equal(s.writes.length,0);});
test('staff saves note and flag together, and can disable reminder',async()=>{const s=setup();await s.saveIntakeReminder({...target,note:'检查配件',intake_reminder:true});await s.saveIntakeReminder({...target,note:'保留备注',intake_reminder:false});assert.equal(s.writes[0].table,'forwarding_orders');assert.equal(s.writes[1].value.intake_reminder,false);});
test('empty reminder and malformed targets cannot write',()=>{const s=setup();assert.throws(()=>s.saveIntakeReminder({...target,note:' ',intake_reminder:true}));assert.throws(()=>s.readIntakeReminder({...target,kind:'waybill'}));assert.equal(s.writes.length,0);});
test('nonstaff cannot read or edit notes',async()=>{const s=setup(false);await assert.rejects(()=>s.readIntakeReminder(target),/工作人员/);await assert.rejects(()=>s.saveIntakeReminder({...target,note:'x',intake_reminder:true}),/工作人员/);assert.equal(s.writes.length,0);});
test('database failures block reminder checks rather than silently skipping',async()=>{const s=setup(true,true);await assert.rejects(()=>s.readIntakeReminder(target),/读取失败/);await assert.rejects(()=>s.saveIntakeReminder({...target,note:'x',intake_reminder:true}),/保存失败/);});
