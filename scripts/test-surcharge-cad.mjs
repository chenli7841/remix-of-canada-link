import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { sumSurchargesCad } from '../src/lib/surcharge-currency.ts';

test('CAD amounts preserve cents, zero and negative adjustments',()=>{
  assert.equal(sumSurchargesCad([{amount_cny:10.71}]),10.71);
  assert.equal(sumSurchargesCad([{amount_cny:10.71},{amount_cny:-5},{amount_cny:0}]),5.71);
});

test('customer carton preserves imported CAD fees even with a 0.2 CNY exchange rate',async()=>{
  const exports={};
  const builder={middleware(){return this},inputValidator(){return this},handler(){return ()=>{}}};
  const mocks={
    './insurance':{uniqueWaybills:x=>x},
    './insurance.server':{effectiveWaybillInsurance:async(_,rows)=>rows},
    './surcharge-currency':{sumSurchargesCad},
    '@tanstack/react-start':{createServerFn:()=>builder},
    '@/integrations/supabase/auth-middleware':{requireSupabaseAuth:{}},
    '@/lib/orders.functions':{getFxCadPerCny:async()=>0.2},
  };
  const source=fs.readFileSync('src/lib/cartons.functions.ts','utf8')+'\nexport {feeTotalsForCarton};';
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:id=>{if(!mocks[id])throw Error(id);return mocks[id]}});
  const db={from(table){const filters={};const q={select(columns){assert.ok(!columns.includes('amount_cad'),'do not query nonexistent surcharge column');return q},eq(k,v){filters[k]=v;return q},in(){return q},then(resolve){return Promise.resolve({data:table==='waybills'?[{id:'w',weight_kg:1,payment_status:'unpaid'}]:filters.scope==='waybill'?[{amount_cny:10.71}]:[]}).then(resolve)}};return q;}};
  const actual=await exports.feeTotalsForCarton(db,{id:'box',customer_code:'00123',self_weight_kg:1});
  assert.equal(actual.child_surcharge_cad,10.71);
  assert.equal(actual.total_fee_cad,10.71);
  assert.equal(actual.fx_rate,0.2);
});
