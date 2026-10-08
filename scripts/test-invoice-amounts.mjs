import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceAmountsCad } from '../src/lib/invoice-amounts.ts';
test('CAD invoices keep face amount and legacy CNY uses saved FX',()=>{
 assert.equal(invoiceAmountsCad({total_cny:229.35,fx_rate:1}).total,229.35);
 assert.equal(invoiceAmountsCad({total_cny:106,fx_rate:.2}).total,21.2);
 const invoices=[{total_cny:106,fx_rate:.2},...[229.35,112.9,116.18,91.62,74.45].map(total_cny=>({total_cny,fx_rate:1}))];
 assert.equal(Math.round(invoices.reduce((s,i)=>s+invoiceAmountsCad(i).due,0)*100)/100,645.7);
});
test('partial payments are deducted once and fully paid balances never negative',()=>{
 assert.deepEqual(invoiceAmountsCad({total_cny:100,fx_rate:.2,paid_cny:25,paid_cad:5}),{total:20,paid:5,due:15});
 assert.equal(invoiceAmountsCad({total_cny:100,fx_rate:1,paid_cad:30}).due,70);
 assert.equal(invoiceAmountsCad({total_cny:100,fx_rate:1,paid_cad:120}).due,0);
});
test('missing or invalid saved FX does not silently show zero or use current FX',()=>{
 for(const fx_rate of [null,0,undefined,NaN,-1])assert.throws(()=>invoiceAmountsCad({total_cny:100,fx_rate}));
});
