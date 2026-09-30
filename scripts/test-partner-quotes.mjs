import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import crypto from "node:crypto";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const js = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(
    js,
    {
      module,
      exports: module.exports,
      require: (id) => (id in mocks ? mocks[id] : require(id)),
      console,
      process: { env: {} },
      Buffer,
      URLSearchParams,
      AbortSignal,
      ...globals,
    },
    { filename: path },
  );
  return module.exports;
}


const express=load('src/lib/express.ts');
const weight=load('src/components/partner/partner-weight.ts');
const duty=load('src/components/partner/partner-duty.ts');
const model=load('src/lib/partner-quote.ts',{'./express':express,'@/components/partner/partner-weight':weight,'@/components/partner/partner-duty':duty});
const cfg={name:'海普门到门',code:'SEA',method:'sea',cargo:'general',enabled:true,allowQuote:true,allowOrder:false,editors:'管理员',audience:'指定同行客户',customers:'09013',domesticRate:'30',domesticDensity:'200',domesticCurrency:'USD',seaRate:'325',seaDensity:'300',seaCurrency:'USD',portRate:'10',portCurrency:'CAD',fx:'1.35',originName:'Test',originPhone:'4165550100',originStreet:'Test',originCity:'Toronto',originProvince:'ON',originPostal:'M5V1A1',carrier:''};
const id='11111111-1111-4111-8111-111111111111';
const to={name:'Test',mobile_phone:'4165550100',address:'Test',city:'Saint-Hyacinthe',province:'QC',postalcode:'J2T1X3',region_id:'CA'};
const raw={routeId:id,to,items:[{name:'硬顶凉亭',hsId:id,value:1000,count:5,specs:[[215,35,29,39],[177,39,30,27.6],[261,32,24,48],[165,64,10,57.4],[118,64,17,48.2]].map(([lengthCm,widthCm,heightCm,weightKg])=>({lengthCm,widthCm,heightCm,weightKg,count:1}))}]};
const input=model.quoteInputSchema.parse(raw),hs=[{id,hs_code:'TEST',mfn_rate:.05,gst_rate:.05,anti_dumping_rate:0}];
test('gazebo: five packages use actual kg for volume fees and individually rounded chargeable kg',()=>{const q=model.baseQuote(cfg,input,hs);assert.equal(q.packages.length,5);assert.ok(Math.abs(q.actual-220.2)<1e-8);assert.equal(q.chargeable,228);assert.ok(Math.abs(q.volume-.859747)<1e-9);assert.equal(q.fees[0].amount,44.59);assert.equal(q.fees[3].amount,100);});
test('missing rate, FX or HS data never becomes zero',()=>{assert.throws(()=>model.baseQuote({...cfg,portRate:''},input,hs),/费用参数/);assert.throws(()=>model.baseQuote({...cfg,fx:''},input,hs),/汇率/);assert.throws(()=>model.baseQuote(cfg,input,[]),/税率缺失/);});
test('reject inconsistent count and limit quote size before API calls',()=>{assert.throws(()=>model.quoteInputSchema.parse({...raw,items:[{...raw.items[0],count:6}]}));assert.throws(()=>model.quoteInputSchema.parse({...raw,items:Array.from({length:21},()=>raw.items[0])}));});
function service(allowedCode='09013',failSnapshot=false){const calls=[];const db={from(table){let write;const q={select(){return q},eq(){return q},in(){return q},insert(v){write=v;return q},maybeSingle:async()=>({data:table==='profiles'?{customer_code:allowedCode}:{id,config:cfg},error:null}),single:async()=>{calls.push({table,write});return {data:{id},error:failSnapshot?{}:null}},then(resolve){return Promise.resolve({data:hs,error:null}).then(resolve)}};return q;}};const api={quotePartnerDelivery:async(v)=>{calls.push(v);return {rates:[{key:'a',carrier:'Test',service:'Ground',price:50,currency:'CAD'}],expiresAt:new Date(Date.now()+600000).toISOString()}}};const svc=load('src/lib/partner-quote.server.ts',{'./partner-quote':model,'@/integrations/supabase/client.server':{supabaseAdmin:db},'./partner-delivery.server':api});return {svc,calls};}
const auth={userId:id,supabase:{rpc:async()=>({data:false,error:null})}};
test('unassigned customer cannot call provider',async()=>{const {svc,calls}=service('OTHER');await assert.rejects(()=>svc.createQuote(auth,raw),/无权/);assert.equal(calls.length,0);});
test('server uses stored origin, all boxes and current rates, then persists snapshot',async()=>{const {svc,calls}=service();const q=await svc.createQuote(auth,{...raw,fees:[{amount:0}],from:{address:'forged'}});assert.equal(calls[0].draft.from.address,'Test');assert.equal(calls[0].draft.packages.length,5);assert.equal(calls[1].table,'partner_quote_snapshots');assert.equal(q.fees[3].amount,100);assert.equal(q.id,id);});
test('snapshot failure does not report a saved quote',async()=>{const {svc}=service('09013',true);await assert.rejects(()=>svc.createQuote(auth,raw),/快照保存失败/);});

test('customers cannot save or enable routes',async()=>{const {svc,calls}=service();await assert.rejects(()=>svc.saveRoute(auth,{config:cfg}),/仅负责人/);assert.equal(calls.length,0);});
