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

 await db.exec('alter table receiving_scans add column code text; alter table receiving_scans add column operator_id uuid; alter table receiving_scans add column scanned_at timestamptz; create unique index scan_unique on receiving_scans(receiving_id,kind,ref_id); alter table cartons add column carton_no text; alter table pallets add column pallet_no text;');
 await db.exec(`update cartons set carton_no='C1';update pallets set pallet_no='P1';delete from receiving_scans;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261109120000_receiving_multiple_batches.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261109140000_receiving_hierarchy.sql','utf8'));
 const scan=(kind,ref,remove=false)=>db.query(`select scan_receiving_hierarchy('${id(1)}','${kind}','${id(ref)}','${id(99)}',${remove})`);
 const has=async(kind,ref)=>(await db.query(`select count(*)::int n from receiving_scans where kind='${kind}' and ref_id='${id(ref)}'`)).rows[0].n;

 await db.exec(fs.readFileSync('supabase/migrations/20261109190000_receiving_merge_batch.sql','utf8'));
 await db.exec(`insert into batches values('${id(40)}','OTHER','shipped'); insert into pallets values('${id(43)}','${id(40)}','P43');insert into cartons values('${id(44)}',null,'${id(43)}','C44');
 insert into waybills(id,waybill_no,assigned_batch_id,carton_id,status) values('${id(41)}','EXTRA','${id(40)}',null,'shipped'),('${id(42)}','NESTED',null,'${id(44)}','shipped');
 insert into receiving_scans(receiving_id,kind,ref_id,code) values('${id(1)}','waybill','${id(41)}','EXTRA');`);
 const merge=(batch=40,actor=99)=>db.query(`select merge_receiving_batch('${id(1)}','waybill','${id(41)}','${id(batch)}','${id(actor)}')`);
 await assert.rejects(merge(2),/所属批次/);await assert.rejects(merge(40,98),/权限/);
 await merge();assert.equal(await has('waybill',42),1);assert.equal(await has('carton',44),1);assert.equal(await has('pallet',43),1);assert.equal(await has('waybill',11),0);
 assert.deepEqual((await db.query('select batch_ids from receivings')).rows[0].batch_ids.sort(),[id(2),id(40)].sort());
 const n=(await db.query('select count(*)::int n from receiving_scans')).rows[0].n;await merge();assert.equal((await db.query('select count(*)::int n from receiving_scans')).rows[0].n,n);
 assert.equal((await db.query(`select status from batches where id='${id(40)}'`)).rows[0].status,'shipped');
 await db.exec(`update receivings set status='confirmed'`);await assert.rejects(merge(),/已确认/);
 console.log('通过：整批加入、内部明细、其他批次不误确认、旧批次保留、重复调用、过期批次及权限保护');
}finally{await db.close();}
