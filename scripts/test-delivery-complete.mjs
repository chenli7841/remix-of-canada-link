import {PGlite} from '../outputs/db-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const actor=id(100);
try {
 await db.exec(`create role anon; create role authenticated; create schema auth;
 create table auth.users(id uuid primary key);insert into auth.users values('${actor}');
 create function auth.uid() returns uuid language sql as $$select null::uuid$$;
 create function public.is_staff(uuid) returns boolean language sql as $$select $1='${actor}'::uuid$$;
 create table profiles(id uuid primary key,full_name text);insert into profiles values('${actor}','测试司机');
 create table cartons(id uuid primary key,pallet_id uuid);
 create table waybills(id uuid primary key,waybill_no text,status text,carton_id uuid,pallet_id uuid,forwarding_id uuid,order_id uuid);
 create table forwarding_orders(id uuid primary key,request_no text,status text);
 create table orders(id uuid primary key,order_no text,status text);
 create table delivery_queue(id uuid primary key,kind text,ref_id uuid,code text,status text,dispatched_at timestamptz);
 create table shipments(id uuid primary key default gen_random_uuid(),tracking_no text unique,status text);
 create table tracking_events(shipment_id uuid,status_zh text,status_en text,event_time timestamptz,source text,source_ref text);
 create table admin_action_logs(entity_type text,entity_id text,action text,operator_id uuid,operator_name text,note text,after jsonb,created_at timestamptz default now());`);
 await db.exec(fs.readFileSync('supabase/migrations/20261005030000_delivery_dispatch_identity.sql','utf8'));
 const migration=fs.readFileSync('supabase/migrations/20261008020000_delivery_complete.sql','utf8');
 await db.exec(migration);await db.exec(migration);
 await db.exec(`insert into forwarding_orders values('${id(10)}','F1','arrived');insert into orders values('${id(11)}','O1','arrived');
 insert into cartons values('${id(20)}','${id(21)}');
 insert into waybills(id,waybill_no,status,carton_id,forwarding_id,order_id) values
 ('${id(1)}','W1','arrived',null,'${id(10)}','${id(11)}'),
 ('${id(2)}','W2','arrived','${id(20)}','${id(10)}','${id(11)}'),
 ('${id(3)}','W3','cancelled','${id(20)}',null,null);
 insert into delivery_queue(id,kind,ref_id,code,status) values
 ('${id(30)}','waybill','${id(1)}','W1','pending'),('${id(31)}','pallet','${id(21)}','P1','pending');`);
 await assert.rejects(db.exec(`update delivery_queue set status='dispatched' where id='${id(30)}'`),/有效的工作人员/);
 await db.exec(`update delivery_queue set status='dispatched',dispatched_by='${actor}' where id='${id(30)}'`);
 assert.equal((await db.query(`select status from waybills where id='${id(1)}'`)).rows[0].status,'delivered');
 assert.equal((await db.query('select status from orders')).rows[0].status,'arrived');
 assert.equal((await db.query('select status from forwarding_orders')).rows[0].status,'arrived');
 await db.exec(`update delivery_queue set status='dispatched',dispatched_by='${actor}' where id='${id(31)}'`);
 assert.equal((await db.query('select status from orders')).rows[0].status,'delivered');
 assert.equal((await db.query('select status from forwarding_orders')).rows[0].status,'delivered');
 assert.equal((await db.query(`select status from waybills where id='${id(3)}'`)).rows[0].status,'cancelled');
 const tracks=(await db.query(`select tracking_no,count(*)::int n,extract(epoch from max(event_time)-min(event_time))::int seconds from tracking_events join shipments on shipments.id=shipment_id group by tracking_no`)).rows;
 assert.equal(tracks.length,4);for(const t of tracks){assert.equal(t.n,2);assert.equal(t.seconds,30);}
 const logs=(await db.query(`select entity_type,entity_id,count(*)::int n,extract(epoch from max(created_at)-min(created_at))::int seconds from admin_action_logs group by entity_type,entity_id`)).rows;
 assert.equal(logs.length,6);for(const l of logs){assert.equal(l.n,2);assert.equal(l.seconds,30);}
 await db.exec(`update delivery_queue set status='dispatched',dispatched_by=null`);
 assert.equal((await db.query('select count(*)::int n from tracking_events')).rows[0].n,8);
 await db.exec(`insert into waybills(id,waybill_no,status) values('${id(4)}','W4','arrived');
 insert into delivery_queue(id,kind,ref_id,code,status) values('${id(32)}','waybill','${id(4)}','W4','pending');
 alter table tracking_events add constraint fail_complete check(status_en<>'Completed') not valid;`);
 await assert.rejects(db.exec(`update delivery_queue set status='dispatched',dispatched_by='${actor}' where id='${id(32)}'`));
 assert.equal((await db.query(`select status from waybills where id='${id(4)}'`)).rows[0].status,'arrived');
 assert.equal((await db.query(`select status from delivery_queue where id='${id(32)}'`)).rows[0].status,'pending');
 assert.equal((await db.query('select count(*)::int n from tracking_events')).rows[0].n,8);
 console.log('派送完成测试通过：运单/整托盘、订单全部完成保护、两条日志和轨迹相差30秒、重复点击去重、无身份拒绝、失败全部回滚。');
} finally {await db.close();}
