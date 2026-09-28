import test from 'node:test';
import assert from 'node:assert/strict';
import {buildConfirmedBatchInvoice,assertConfirmedInvoice} from '../src/lib/confirmed-batch-invoice.ts';
function snapshot(){return {subtotal_cad:10.55,fee_breakdown:{per_route:[{route_code:'SEA',chargeable_weight_kg:6.84,freight_rate_cad:15,subtotal_cad:10.55,fee_freight_cad:5.55,fee_customs_cad:0,fee_insurance_cad:0,fee_clearance_cad:0,fee_surcharge_cad:2,fee_delivery_cad:5,fee_inspection_cad:1,fee_discount_cad:3}]}};}
test('includes all batch categories and applies discount exactly once',()=>{
 const inv=buildConfirmedBatchInvoice(snapshot());assert.equal(inv.total_cad,10.55);assert.equal(inv.lines.find(l=>l.meta.fee_type==='附加费').amount_cny,2);assert.equal(inv.lines.find(l=>l.meta.fee_type==='折扣').amount_cny,-3);
 assert.equal(Math.round(inv.lines.reduce((s,l)=>s+l.amount_cny,0)*100),1055);
});
test('missing data fails, zero insurance remains an explicit line',()=>{
 const s=snapshot();s.fee_breakdown.per_route[0].fee_surcharge_cad=null;assert.throws(()=>buildConfirmedBatchInvoice(s),/附加费/);
 assert.equal(buildConfirmedBatchInvoice(snapshot()).lines.find(l=>l.meta.fee_type==='保险').amount_cny,0);
});
test('mismatched snapshot cannot produce an invoice',()=>{
 const s=snapshot();s.subtotal_cad=10.85;assert.throws(()=>buildConfirmedBatchInvoice(s),/总额不一致/);
});
test('payment requires a bound confirmed invoice and exactly the displayed amount',()=>{
 const s={confirmed:true,subtotal_cad:10.55,fee_breakdown:{billing_version:2,invoice_id:'inv'}};
 const i={id:'inv',status:'unpaid',total_cny:10.55,fx_rate:1};
 assert.equal(assertConfirmedInvoice(s,i,10.55),10.55);
 assert.throws(()=>assertConfirmedInvoice(s,i,10.85),/页面金额/);
 assert.throws(()=>assertConfirmedInvoice(s,null,10.55),/缺少/);
 assert.throws(()=>assertConfirmedInvoice({...s,confirmed:false},i),/缺少/);
 assert.throws(()=>assertConfirmedInvoice(s,{...i,id:'other'}),/关联/);
 assert.throws(()=>assertConfirmedInvoice(s,{...i,status:'void'}),/状态/);
});
test('zero exchange rate and missing amounts never become zero payable',()=>{
 const s={confirmed:true,subtotal_cad:0,fee_breakdown:{billing_version:2,invoice_id:'inv'}};
 assert.throws(()=>assertConfirmedInvoice(s,{id:'inv',status:'unpaid',total_cny:null,fx_rate:1}),/不一致/);
 assert.throws(()=>assertConfirmedInvoice(s,{id:'inv',status:'unpaid',total_cny:10,fx_rate:0}),/不一致/);
});
