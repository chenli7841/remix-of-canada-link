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

const core=load('src/lib/express.ts');
const input=load('src/lib/partner-delivery.ts',{'./express':core});
const address={name:'Test',mobile_phone:'4165550100',region_id:'CA',province:'ON',city:'Toronto',postalcode:'M5V2T6',address:'123 Test Street'};
const request={draft:{from:address,to:address,packageType:'parcel',packages:[{lengthCm:20,widthCm:20,heightCm:20,weightKg:2}]},rule:{currency:'CAD'}};
function service(configured=true){const calls=[],payloads=[];const provider={providerConfig:()=>({configured,environment:'sandbox'}),accountUnits:async()=>{calls.push('account');return {weight:'kg',length:'cm'}},providerPayload:d=>({initiation:d.from,destination:d.to,package:d.packages}),verykRequest:async(action,payload)=>{payloads.push(payload);calls.push(action);if(action!=='shipment/quote')throw Error('unexpected action');return [{carrier_id:1,name:'UPS',services:[{id:1,name:'Ground',currency:{code:'CAD'},charge:20,tax:2,eta:''}]}]}};return {calls,payloads,svc:load('src/lib/partner-delivery.server.ts',{'./express':core,'./partner-delivery':input,'./verykship.server':provider})};}
const auth=(allowed)=>({userId:'test-user',supabase:{rpc:async()=>({data:allowed,error:null})}});
test('no order id is needed and only account/quote called',async()=>{const {svc,calls}=service();const r=await svc.testPartnerDelivery(request,auth(true));assert.equal(r.recommendation.price,20);assert.deepEqual(calls,['account','shipment/quote']);});
test('unauthorized callers never reach provider',async()=>{const {svc,calls}=service();await assert.rejects(()=>svc.testPartnerDelivery(request,auth(false)),/仅负责人/);assert.equal(calls.length,0);});
test('missing credentials fail without API requests',async()=>{const {svc,calls}=service(false);await assert.rejects(()=>svc.testPartnerDelivery(request,auth(true)),/未配置/);assert.equal(calls.length,0);});
test('missing origin rejected before provider',async()=>{const {svc,calls}=service();await assert.rejects(()=>svc.testPartnerDelivery({...request,draft:{...request.draft,from:{...address,address:''}}},auth(true)));assert.equal(calls.length,0);});
test('connection response never exposes a secret or enables purchase',async()=>{const {svc}=service();const r=await svc.deliveryConnection(auth(true),true);assert.equal(r.connected,true);assert.equal(r.purchasing,false);assert.equal('secret' in r,false);});

test('quote omits absent recipient contact without manufacturing customer data',async()=>{const {svc,payloads}=service();const {name,mobile_phone,...to}=address;await svc.testPartnerDelivery({...request,draft:{...request.draft,to}},auth(true));assert.equal('name' in payloads[0].destination,false);assert.equal('mobile_phone' in payloads[0].destination,false);assert.equal(payloads[0].initiation.name,'Test');assert.equal(payloads[0].destination.postalcode,'M5V2T6');});
