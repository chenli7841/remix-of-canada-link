import {PGlite} from '../outputs/db-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const actor='11111111-1111-1111-1111-111111111111',bad='22222222-2222-2222-2222-222222222222';
try{
 await db.exec(`create schema auth; create table auth.users(id uuid primary key); insert into auth.users values('${actor}'),('${bad}');
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function public.is_staff(uuid) returns boolean language sql as $$select $1='${actor}'::uuid$$;
 create table profiles(id uuid primary key,full_name text);insert into profiles values('${actor}','测试司机');
 create table cartons(id uuid primary key,pallet_id uuid);
 create table waybills(id uuid primary key,waybill_no text,status text,carton_id uuid,pallet_id uuid);
 create table delivery_queue(id uuid primary key,kind text,ref_id uuid,code text,status text,dispatched_at timestamptz);
 create table shipments(id uuid primary key default gen_random_uuid(),tracking_no text unique,status text);
 create table tracking_events(shipment_id uuid,status_zh text,status_en text,event_time timestamptz,source text,source_ref text);
 create table admin_action_logs(entity_type text,entity_id uuid,action text,operator_id uuid,operator_name text,note text,after jsonb);`);
 const sql=fs.readFileSync('supabase/migrations/20261005030000_delivery_dispatch_identity.sql','utf8');await db.exec(sql);await db.exec(sql);
 await db.exec(`insert into cartons values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000020');
 insert into waybills values('00000000-0000-0000-0000-000000000001','W1','arrived',null,null,null,null,null),('00000000-0000-0000-0000-000000000002','W2','arrived','00000000-0000-0000-0000-000000000010',null,null,null,null),('00000000-0000-0000-0000-000000000003','W3','delivered','00000000-0000-0000-0000-000000000010',null,null,null,null);
 insert into delivery_queue(id,kind,ref_id,code,status) values('00000000-0000-0000-0000-000000000101','waybill','00000000-0000-0000-0000-000000000001','W1','pending'),('00000000-0000-0000-0000-000000000102','pallet','00000000-0000-0000-0000-000000000020','P1','pending');`);
 await assert.rejects(db.exec(`update delivery_queue set status='dispatched',dispatched_by='${bad}'`),/有效的工作人员/);
 assert.equal((await db.query("select count(*)::int n from delivery_queue where status='pending'")).rows[0].n,2);
 await db.exec(`update delivery_queue set status='dispatched',dispatched_by='${actor}'`);
 const rows=(await db.query('select * from delivery_queue order by id')).rows;assert.equal(rows[0].dispatched_by_name,'测试司机');assert.ok(rows[0].dispatched_at);
 const wb=(await db.query('select * from waybills order by id')).rows;assert.equal(wb[0].status,'in_transit');assert.equal(wb[1].status,'in_transit');assert.equal(wb[2].status,'delivered');assert.equal(wb[1].dispatched_by_name,'测试司机');
 assert.equal((await db.query('select count(*)::int n from tracking_events')).rows[0].n,2);
 assert.equal((await db.query('select count(*)::int n from admin_action_logs')).rows[0].n,4);
 await db.exec(`update delivery_queue set status='dispatched',dispatched_by='${bad}',dispatched_at='2000-01-01'`);
 assert.equal((await db.query('select count(*)::int n from tracking_events')).rows[0].n,2);
 assert.equal((await db.query('select dispatched_by_name from delivery_queue limit 1')).rows[0].dispatched_by_name,'测试司机');
 // Fail after waybill updates: the queue, tracks and status must all roll back.
 await db.exec(`insert into waybills(id,waybill_no,status) values('00000000-0000-0000-0000-000000000004','W4','arrived');insert into delivery_queue(id,kind,ref_id,code,status) values('00000000-0000-0000-0000-000000000104','waybill','00000000-0000-0000-0000-000000000004','W4','pending'); alter table tracking_events add constraint test_failure check(status_en <> 'Out for delivery') not valid;`);
 await assert.rejects(db.exec(`update delivery_queue set status='dispatched',dispatched_by='${actor}' where code='W4'`));
 assert.equal((await db.query("select status from waybills where waybill_no='W4'")).rows[0].status,'arrived');assert.equal((await db.query("select status from delivery_queue where code='W4'")).rows[0].status,'pending');
 console.log('派送迁移测试通过：单件/整托盘、内部运单、终态保护、身份校验、人员/时间、日志/轨迹、重复点击及失败回滚。');
}finally{await db.close();}
