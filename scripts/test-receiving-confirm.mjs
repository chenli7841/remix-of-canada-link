import {PGlite} from '../outputs/db-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const call=(r=1,actor=99,b=2)=>`select confirm_receiving_atomic('${id(r)}','${id(b)}','${id(actor)}',null) result`;
try {
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create function is_staff(uuid) returns boolean language sql as $$select $1='${id(99)}'::uuid$$;
 create table profiles(id uuid,full_name text,email text);
 create table receivings(id uuid primary key,batch_id uuid,status text,warehouse_code text,receiving_no text,confirmed_at timestamptz);
 create table batches(id uuid primary key,batch_no text,status text);
 create table cartons(id uuid primary key,batch_id uuid,pallet_id uuid);
 create table pallets(id uuid primary key,batch_id uuid);
 create table waybills(id uuid primary key,assigned_batch_id uuid,carton_id uuid,pallet_id uuid,forwarding_id uuid,order_id uuid,status text,waybill_no text);
 create table forwarding_orders(id uuid primary key,status text);
 create table orders(id uuid primary key,status text);
 create table receiving_scans(receiving_id uuid,kind text,ref_id uuid);
 create table shipments(id uuid default gen_random_uuid() primary key,tracking_no text unique,status text);
 create table tracking_events(shipment_id uuid,status_zh text,status_en text,location_zh text,location_en text,event_time timestamptz,source text,source_ref text);
 create table admin_action_logs(entity_type text,entity_id text,action text,operator_id uuid,operator_name text,note text,before jsonb,after jsonb);
 insert into profiles values('${id(99)}','收货员','staff@example.com');
 insert into receivings values('${id(1)}','${id(2)}','matched','YYZ','RCV1',null);
 insert into batches values('${id(2)}','B1','shipped');
 insert into pallets values('${id(3)}','${id(2)}');
 insert into cartons values('${id(4)}',null,'${id(3)}');
 insert into forwarding_orders values('${id(5)}','shipped'),('${id(6)}','shipped');
 insert into orders values('${id(7)}','shipped');
 insert into waybills values
 ('${id(10)}',null,'${id(4)}',null,'${id(5)}',null,'shipped','W10'),
 ('${id(11)}','${id(2)}',null,null,'${id(6)}',null,'shipped','W11'),
 ('${id(12)}','${id(2)}',null,null,'${id(6)}',null,'shipped','W12'),
 ('${id(13)}',null,null,'${id(3)}',null,'${id(7)}','shipped','W13'),
 ('${id(14)}','${id(2)}',null,null,null,null,'delivered','W14'),
 ('${id(15)}','${id(2)}',null,null,null,null,'in_transit','W15');
 insert into receiving_scans select '${id(1)}','waybill',id from waybills where waybill_no<>'W12';`);
 await db.exec(fs.readFileSync('supabase/migrations/20261008010000_confirm_receiving_atomic.sql','utf8'));
 await assert.rejects(db.query(call(1,98)),/没有收货操作权限/);
 await assert.rejects(db.query(call(1,99,77)),/匹配批次已变化/);
 // Any failure rolls back statuses, logs, shipment rows and receiving confirmation.
 await db.exec("alter table tracking_events add constraint force_failure check(status_zh <> '已到件')");
 await assert.rejects(db.query(call()));
 assert.equal((await db.query('select status from batches')).rows[0].status,'shipped');
 assert.equal((await db.query('select count(*)::int n from admin_action_logs')).rows[0].n,0);
 assert.equal((await db.query("select count(*)::int n from waybills where status='arrived'")).rows[0].n,0);
 await db.exec('alter table tracking_events drop constraint force_failure');
 assert.deepEqual((await db.query(call())).rows[0].result,{ok:true,orders_updated:2,waybills_updated:3});
 assert.equal((await db.query('select status from batches')).rows[0].status,'arrived');
 assert.equal((await db.query(`select status from forwarding_orders where id='${id(6)}'`)).rows[0].status,'shipped');
 assert.equal((await db.query("select status from waybills where waybill_no='W12'")).rows[0].status,'shipped');
 assert.equal((await db.query("select status from waybills where waybill_no='W15'")).rows[0].status,'in_transit');
 assert.equal((await db.query('select count(*)::int n from tracking_events')).rows[0].n,3);
 assert.equal((await db.query('select count(*)::int n from admin_action_logs')).rows[0].n,7);
 assert.equal((await db.query(call())).rows[0].result.already_confirmed,true);
 assert.equal((await db.query('select count(*)::int n from tracking_events')).rows[0].n,3);
 assert.equal((await db.query("select has_function_privilege('authenticated','confirm_receiving_atomic(uuid,uuid,uuid,text)','execute') allowed")).rows[0].allowed,false);
 // An outer scan alone must not silently receive its contents.
 await db.exec(`insert into receivings values('${id(20)}','${id(2)}','matched','YYZ','RCV2',null);insert into receiving_scans values('${id(20)}','carton','${id(4)}');`);
 await assert.rejects(db.query(call(20)),/没有已扫描确认/);
 console.log('通过：箱托嵌套、扫描范围、父订单收齐判断、下游保护、权限、重复确认、中文日志及失败回滚。');
} finally { await db.close(); }
