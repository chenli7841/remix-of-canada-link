import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '../outputs/db-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
const db=new PGlite();
await db.exec(`
create table forwarding_orders(id integer generated always as identity,request_no text default 'test',status text,payment_status text,note text,items_desc text,insured boolean,intake_reminder boolean default false);
insert into forwarding_orders(note) values('历史备注');
create function place_forwarding(_payload jsonb,_target_user_id uuid default null) returns jsonb language plpgsql as $$
declare v_note text:=_payload->>'note';v_insured boolean:=false;v_fo_id integer;v_req_no text;
begin
insert into forwarding_orders(status, payment_status, note, items_desc, insured)
values('pending','unpaid',v_note,'test',v_insured
  ) RETURNING id, request_no into v_fo_id,v_req_no;
return jsonb_build_object('id',v_fo_id);
end $$;
`);
const migration=readFileSync('supabase/migrations/20261005120000_frontend_note_intake_reminder.sql','utf8');
await db.exec(migration);
await db.exec(migration);
for(const [payload,expected] of [
 [{note:'拆箱检查',intake_reminder:true},true],
 [{note:'   ',intake_reminder:true},false],
 [{note:null,intake_reminder:true},false],
 [{note:'[已购买保险]'},false],
 [{note:'已有其他渠道备注',intake_reminder:false},false],
]) {
 const r=await db.query('select place_forwarding($1::jsonb) result',[JSON.stringify(payload)]);
 const saved=await db.query('select intake_reminder from forwarding_orders where id=$1',[r.rows[0].result.id]);
 assert.equal(saved.rows[0].intake_reminder,expected);
}
assert.equal((await db.query('select intake_reminder from forwarding_orders where id=1')).rows[0].intake_reminder,false);
const source=readFileSync('src/routes/_authenticated/forwarding.index.tsx','utf8');
assert.match(source,/intake_reminder: note\.trim\(\)\.length > 0/);
console.log('Passed: note reminder migration, repeat migration, blank/insurance notes, existing records and frontend payload.');
await db.close();
