import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceDisplay} from '../src/lib/invoice-display.ts';
import {buildConfirmedBatchInvoice} from '../src/lib/confirmed-batch-invoice.ts';
const route={route_code:'AIR',chargeable_weight_kg:6.84,freight_rate_cad:15,fee_freight_cad:102.60,fee_customs_cad:3,fee_insurance_cad:2,fee_clearance_cad:4,fee_surcharge_cad:5,fee_delivery_cad:65,fee_inspection_cad:0,fee_discount_cad:1,subtotal_cad:180.60};
const invoice={fx_rate:1,total_cny:180.60,freight_cny:102.60,customs_cny:3,insurance_cny:2,other_cny:73};
test('saved batch weights and route rates survive invoice generation; other fees include tax and insurance once',()=>{
 const built=buildConfirmedBatchInvoice({subtotal_cad:180.60,fee_breakdown:{chargeable_weight_kg:6.84,per_route:[route]}});
 const d=invoiceDisplay(invoice,built.lines);
 assert.equal(d.batchWeight,6.84);assert.equal(d.freight[0].weight,6.84);assert.equal(d.freight[0].rate,15);
 assert.equal(d.freightTotal,102.60);assert.equal(d.otherTotal,78);assert.equal(d.total,180.60);assert.equal(d.mismatch,false);
 assert.deepEqual(d.other.map(r=>r.label),['关税及GST','保险','清关费','附加费','末端派送费','折扣']);
});
test('different routes keep their own rates and saved subtotals, never weight times rate',()=>{
 const routes=[{...route,fee_freight_cad:100,subtotal_cad:178},{...route,route_code:'SEA',freight_rate_cad:7,fee_freight_cad:80,subtotal_cad:158}];
 const built=buildConfirmedBatchInvoice({subtotal_cad:336,fee_breakdown:{per_route:routes}});
 const d=invoiceDisplay({...invoice,total_cny:336,freight_cny:180,customs_cny:6,insurance_cny:4,other_cny:146},built.lines);
 assert.deepEqual(d.freight.map(r=>[r.rate,r.amount]),[[15,100],[7,80]]);assert.equal(d.mismatch,false);
});
test('legacy missing weight is unknown rather than invented zero; categories render from ledger',()=>{
 const d=invoiceDisplay({fx_rate:1,total_cny:167.6,freight_cny:102.6,customs_cny:0,insurance_cny:0,other_cny:65},[{freight_cny:102.6,amount_cny:102.6},{other_cny:65,amount_cny:65,meta:{fee_type:'末端派送费'}}]);
 assert.equal(d.freight[0].weight,null);assert.equal(d.other.length,1);assert.equal(d.otherTotal,65);assert.equal(d.mismatch,false);
});
test('missing new batch weight or rate blocks generation',()=>{
 for(const key of ['chargeable_weight_kg','freight_rate_cad']) assert.throws(()=>buildConfirmedBatchInvoice({subtotal_cad:180.60,fee_breakdown:{per_route:[{...route,[key]:null}]}}),/缺失/);
});
