// Isolated test dependency, without changing the application's dependencies:
// npm install --prefix outputs/db-test-runtime --no-package-lock --ignore-scripts @electric-sql/pglite
// node scripts/test-domestic-tracking.mjs
import { PGlite } from '../outputs/db-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function public.is_staff(uuid) returns boolean language sql as $$ select $1::text like '22222222%' $$;
create table profiles(id uuid primary key, full_name text, email text);
create table forwarding_orders(id uuid primary key default gen_random_uuid(), user_id uuid, request_no text, domestic_tracking_no text, status text);
create table orders(id uuid primary key default gen_random_uuid(), domestic_tracking_no text, status text);
create table admin_action_logs(entity_type text,entity_id uuid,action text,after jsonb,operator_id uuid,operator_name text,note text);
insert into forwarding_orders(domestic_tracking_no) values('HIST'),(' hist ');
insert into profiles values('11111111-1111-1111-1111-111111111111','Customer','c@example.test'),('22222222-2222-2222-2222-222222222222','Staff','s@example.test');
`);
await db.exec(await readFile(new URL('../supabase/migrations/20261001020000_domestic_tracking_identity.sql',import.meta.url),'utf8'));
let checks = 0;
async function rejected(sql, pattern = /国内单号已被其他订单使用/) {
  await assert.rejects(db.exec(sql), pattern); checks++;
}
await rejected("insert into forwarding_orders(domestic_tracking_no) values('hist')");
await db.exec("update forwarding_orders set status='received' where upper(trim(domestic_tracking_no))='HIST'");
assert.equal((await db.query('select count(*)::int n from forwarding_orders')).rows[0].n,2); checks++;
await db.exec("insert into orders(domestic_tracking_no) values(' ABC123 ')");
await rejected("insert into forwarding_orders(domestic_tracking_no) values('abc123')");
await rejected("insert into orders(domestic_tracking_no) values('ABC123')");
await rejected("update forwarding_orders set domestic_tracking_no='ABC123'");
await db.exec("update orders set status='cancelled'");
await rejected("insert into forwarding_orders(domestic_tracking_no) values('ABC123')");
await db.exec("update orders set domestic_tracking_no='NEW123'; insert into forwarding_orders(domestic_tracking_no) values('ABC123')"); checks++;
await db.exec("delete from orders; insert into orders(domestic_tracking_no) values('NEW123')"); checks++;
await db.exec("insert into orders(domestic_tracking_no) values(null),(''),('   ')"); checks++;
await db.exec("set test.uid='11111111-1111-1111-1111-111111111111'; insert into forwarding_orders(domestic_tracking_no,created_by,creation_source) values('SELF','22222222-2222-2222-2222-222222222222','staff')");
let row=(await db.query("select * from forwarding_orders where domestic_tracking_no='SELF'")).rows[0];
assert.equal(row.created_by,'11111111-1111-1111-1111-111111111111'); assert.equal(row.creation_source,'customer'); checks++;
await db.exec("update forwarding_orders set created_by=null,creation_source='system_api' where domestic_tracking_no='SELF'");
assert.equal((await db.query("select creation_source from forwarding_orders where domestic_tracking_no='SELF'")).rows[0].creation_source,'customer'); checks++;
await db.exec("set test.uid='22222222-2222-2222-2222-222222222222'; insert into forwarding_orders(domestic_tracking_no) values('STAFF')");
assert.equal((await db.query("select creation_source from forwarding_orders where domestic_tracking_no='STAFF'")).rows[0].creation_source,'staff'); checks++;
await db.exec("set test.uid=''; insert into forwarding_orders(domestic_tracking_no) values('API')");
row=(await db.query("select * from forwarding_orders where domestic_tracking_no='API'")).rows[0];
assert.equal(row.created_by,null); assert.equal(row.creation_source,'system_api'); checks++;
assert.equal((await db.query("select created_by from forwarding_orders where domestic_tracking_no='HIST'")).rows[0].created_by,null); checks++;
assert.equal((await db.query("select count(*)::int n from admin_action_logs where action='create_forwarding'")).rows[0].n,4); checks++;
await db.exec("begin; insert into orders(domestic_tracking_no) values('ROLLBACK'); rollback; insert into orders(domestic_tracking_no) values('ROLLBACK')"); checks++;
await rejected("update orders set id=gen_random_uuid()", /订单 ID 不允许修改/);
await db.exec("set role authenticated");
await rejected("select * from domestic_tracking_claims", /permission denied/);
await db.close();
console.log(`${checks} database checks passed`);
