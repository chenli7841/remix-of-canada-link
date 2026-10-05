import {PGlite} from '../outputs/db-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db=new PGlite();
try {
 await db.exec('create role anon; create role authenticated; create role service_role;');
 const sql=fs.readFileSync('supabase/migrations/20261005090000_delivery_maps_monthly_limit.sql','utf8');
 await db.exec(sql);await db.exec(sql);
 await db.exec('set role authenticated');
 await assert.rejects(db.query('select reserve_delivery_maps_call()'),/permission denied/);
 await assert.rejects(db.query('select * from delivery_maps_monthly_usage'),/permission denied/);
 await db.exec('reset role; set role service_role');
 assert.equal((await db.query('select reserve_delivery_maps_call() n')).rows[0].n,1);
 await db.exec('reset role; update delivery_maps_monthly_usage set used=999;');
 const last=await Promise.allSettled([db.query('select reserve_delivery_maps_call() n'),db.query('select reserve_delivery_maps_call() n')]);
 assert.equal(last.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(last.filter(r=>r.status==='rejected').length,1);
 assert.equal((await db.query('select used from delivery_maps_monthly_usage')).rows[0].used,1000);
 await assert.rejects(db.query('select reserve_delivery_maps_call()'),/DELIVERY_MAPS_MONTHLY_LIMIT/);
 await db.exec("update delivery_maps_monthly_usage set month=(month-interval '1 month')::date");
 assert.equal((await db.query('select reserve_delivery_maps_call() n')).rows[0].n,1);
 assert.equal((await db.query('select count(*)::int n from delivery_maps_monthly_usage')).rows[0].n,2);
 console.log('限量迁移测试通过：重复执行、权限隔离、1000 次硬上限、竞争请求不超限、新月份重新计数。');
} finally {await db.close();}
