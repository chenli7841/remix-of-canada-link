import{PGlite}from'../outputs/db-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';import fs from'node:fs';import assert from'node:assert/strict';
const db=new PGlite(),id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
try{
await db.exec(`create role anon;create role authenticated;create role service_role;
create function is_staff(uuid)returns boolean language sql as $$select $1='${id(9)}'::uuid$$;
create table batches(id uuid primary key,batch_no text,display_name text,shipping_method text,planned_ship_date date,status text,notes text);
create table receivings(id uuid primary key,status text,included_units jsonb);
create table waybills(id uuid primary key,carton_id uuid,pallet_id uuid,assigned_batch_id uuid,user_id uuid,payment_status text,freight_cad numeric,status text);
create table cartons(id uuid primary key,batch_id uuid,pallet_id uuid,customer_user_id uuid,customer_code text);
create table pallets(id uuid primary key,batch_id uuid,customer_user_id uuid,customer_code text);
create table profiles(id uuid primary key,customer_code text);
create table admin_action_logs(entity_type text,entity_id text,action text,operator_id uuid,before jsonb,after jsonb,note text);
create table delivery_queue(id uuid default gen_random_uuid() primary key,kind text,ref_id uuid,code text,customer_user_id uuid,customer_code text,source_receiving_id uuid,source_batch_id uuid,added_by uuid,status text,created_at timestamptz default now(),unique(kind,ref_id,status));
create function logistics_unit_waybills(k text,r uuid)returns setof waybills language sql as $$select * from waybills where (k='waybill' and id=r)or(k='carton' and carton_id=r)or(k='pallet' and pallet_id=r)$$;
insert into profiles values('${id(8)}','00008');
insert into cartons values('${id(2)}','${id(4)}',null,'${id(8)}','00008');
insert into waybills values('${id(3)}','${id(2)}',null,'${id(4)}','${id(8)}','paid',25,'delivered');
insert into receivings values('${id(1)}','confirmed','[{"kind":"carton","ref_id":"${id(2)}","code":"C2","batch_id":"${id(4)}","handling_status":"pending_special"}]');`);
await db.exec(fs.readFileSync('supabase/migrations/20261111170000_special_handling_operations.sql','utf8'));
const run=()=>db.query(`select transfer_receiving_special_units('${id(1)}','${id(9)}') r`);
assert.deepEqual((await run()).rows[0].r,{batch_id:'c5ec1a10-1111-4111-8111-000000000001',units:1,queue_added:1});
assert.equal((await run()).rows[0].r.units,0);
assert.deepEqual((await db.query('select payment_status,freight_cad,status from waybills')).rows[0],{payment_status:'paid',freight_cad:'25',status:'delivered'});
assert.equal((await db.query('select kind from delivery_queue')).rows[0].kind,'carton');
await assert.rejects(db.query(`select transfer_receiving_special_units('${id(1)}','${id(7)}')`),/权限/);
await assert.rejects(db.query("update batches set status='closed'"),/不可关闭/);
console.log('PASS: whole carton, preserved payment/fees/status, retry, permissions, permanent batch');
}finally{await db.close();}
