import { PGlite } from '../outputs/db-test-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { allocateContainerFreight } from '../src/lib/freight-allocation.ts';
import { buildConfirmedBatchInvoice, assertConfirmedInvoice } from '../src/lib/confirmed-batch-invoice.ts';

// Isolated database only. Run production confirmation/cancellation SQL and freeze
// triggers; payment transport and production customer records are not touched.
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const batch = id(1), customer = id(2), operator = id(3);
let checks = 0;
async function rejects(sql, args, pattern) {
  await assert.rejects(db.query(sql, args), pattern); checks++;
}
try {
  await db.exec(`
    create schema auth;
    create function auth.role() returns text language sql as $$select 'service_role'::text$$;
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create function is_staff(uuid) returns boolean language sql as $$select $1='${operator}'::uuid$$;
    create table batches(id uuid primary key,batch_no text,fees_dirty_at timestamptz);
    create table profiles(id uuid primary key,customer_code text unique);
    create table invoices(id uuid primary key default gen_random_uuid(),invoice_no text default gen_random_uuid()::text,
      user_id uuid,type text,status text,batch_no text,subtotal_cny numeric,total_cny numeric,freight_cny numeric,
      customs_cny numeric,insurance_cny numeric,other_cny numeric,fx_rate numeric,currency text,due_date date,
      created_by uuid,note text,paid_cad numeric default 0,paid_cny numeric default 0);
    create table invoice_items(id uuid primary key default gen_random_uuid(),invoice_id uuid,description text,
      amount_cny numeric,freight_cny numeric,customs_cny numeric,insurance_cny numeric,other_cny numeric,meta jsonb);
    create table offline_payments(invoice_id uuid);
    create table batch_settlements(batch_id uuid,customer_code text,confirmed boolean,confirmed_by uuid,
      confirmed_at timestamptz,subtotal_cad numeric,waybill_count integer,carton_count integer,pallet_count integer,
      route_codes text,is_paid boolean,fee_breakdown jsonb,snapshot_at timestamptz,calc_version integer,
      primary key(batch_id,customer_code));
    insert into batches values('${batch}','TEST-FREIGHT',null);
    insert into profiles values('${customer}','TEST-CUSTOMER');
  `);
  const migration = fs.readFileSync('supabase/migrations/20260928200000_confirmed_batch_invoice_workflow.sql','utf8');
  await db.exec(migration.slice(0,migration.indexOf('CREATE OR REPLACE FUNCTION public.settle_confirmed_batch_invoice_v2')));
  await db.exec(migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.protect_confirmed_batch_snapshot_v2')));
  const leaves = [1.5,1.8,1.5,3.9].map((freight_cad,i)=>({id:id(10+i),carton_id:id(20),freight_cad}));
  const carton = {id:id(20),billing_mode:'split',self_freight_cad:7.2,pallet_id:id(21)};
  const pallet = {id:id(21),billing_mode:'split',self_freight_cad:6};
  function snapshot() {
    const allocation = allocateContainerFreight(leaves,[carton],[pallet]);
    const freight = [...allocation.values()].reduce((sum,row)=>sum+Math.round(row.freight_cad*100),0)/100;
    const total = +(freight+5).toFixed(2);
    return {subtotal_cad:total,waybill_count:4,carton_count:1,pallet_count:1,route_codes:'HP',
      fee_breakdown:{chargeable_weight_kg:2.9,per_route:[{route_code:'HP',chargeable_weight_kg:2.9,
        freight_rate_cad:3,fee_freight_cad:freight,fee_customs_cad:0,fee_insurance_cad:0,
        fee_clearance_cad:0,fee_surcharge_cad:0,fee_delivery_cad:5,fee_inspection_cad:0,
        fee_discount_cad:0,subtotal_cad:total}]}};
  }
  async function confirm(s, extra={}) {
    const p={batch_id:batch,customer_code:'TEST-CUSTOMER',operator_id:operator,expected_dirty_at:null,
      snapshot:s,lines:buildConfirmedBatchInvoice(s).lines,...extra};
    return (await db.query('select confirm_batch_invoice_v2($1::jsonb) result',[JSON.stringify(p)])).rows[0].result;
  }
  const split = snapshot(); assert.equal(split.subtotal_cad,13.7); checks++;
  const first = await confirm(split);
  const stored = (await db.query('select * from batch_settlements')).rows[0];
  const invoice = (await db.query('select * from invoices where id=$1',[first.invoice_id])).rows[0];
  assert.equal(assertConfirmedInvoice(stored,invoice,13.7),13.7); checks++;
  assert.equal((await confirm(split)).invoice_id,first.invoice_id); checks++;
  await rejects('update batch_settlements set subtotal_cad=1',[],/冻结/);
  await rejects('update invoices set total_cny=1 where id=$1',[first.invoice_id],/冻结/);
  await rejects('delete from invoice_items where invoice_id=$1',[first.invoice_id],/不能修改/);
  carton.billing_mode='merged';
  const merged = snapshot(); assert.equal(merged.subtotal_cad,12.2); checks++;
  assert.equal((await confirm(merged)).invoice_id,first.invoice_id);
  assert.equal(Number((await db.query('select total_cny from invoices where id=$1',[first.invoice_id])).rows[0].total_cny),13.7); checks++;
  await db.query('select cancel_batch_invoice_v2($1,$2,$3)',[batch,'TEST-CUSTOMER',operator]);
  assert.equal((await db.query('select status from invoices where id=$1',[first.invoice_id])).rows[0].status,'void'); checks++;
  const second = await confirm(merged); assert.notEqual(second.invoice_id,first.invoice_id); checks++;
  const current = (await db.query('select * from invoices where id=$1',[second.invoice_id])).rows[0];
  assert.equal(Number(current.total_cny),12.2); checks++;
  assert.equal(Number((await db.query('select sum(amount_cny) total from invoice_items where invoice_id=$1',[second.invoice_id])).rows[0].total),12.2); checks++;
  pallet.billing_mode='merged'; assert.equal(snapshot().subtotal_cad,11); checks++;
  await db.query('select cancel_batch_invoice_v2($1,$2,$3)',[batch,'TEST-CUSTOMER',operator]);
  const broken = snapshot();
  await assert.rejects(confirm(broken,{lines:[{description:'bad',amount_cny:1,freight_cny:1,customs_cny:0,insurance_cny:0,other_cny:0}]}),/不一致/); checks++;
  assert.equal(Number((await db.query("select count(*) n from invoices where status='unpaid'")).rows[0].n),0); checks++;
  await db.query('update batches set fees_dirty_at=now()');
  await assert.rejects(confirm(snapshot()),/发生变化/); checks++;
  await db.query('update batches set fees_dirty_at=null');
  const third=await confirm(snapshot());
  // Exercise guards for a fully settled fixture; this does not simulate a wallet transfer.
  await rejects("update invoices set status='paid',paid_cad=1,paid_cny=1 where id=$1",[third.invoice_id],/实收金额/);
  await db.query("update invoices set status='paid',paid_cad=total_cny,paid_cny=total_cny where id=$1",[third.invoice_id]);
  await rejects('select cancel_batch_invoice_v2($1,$2,$3)',[batch,'TEST-CUSTOMER',operator],/已有收款/);
  await assert.rejects(confirm(snapshot()),/已付款/); checks++;
  console.log(`${checks} lifecycle checks passed: allocation → confirmation → frozen invoice → cancellation → new invoice, nested override, stale/mismatched rejection, paid guards. Isolated database; no real payments or messages.`);
} finally { await db.close(); }
