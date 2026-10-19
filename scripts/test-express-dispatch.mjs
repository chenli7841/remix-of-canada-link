import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import { test } from 'node:test';
const require = createRequire(import.meta.url);
function load(file, mocks={}) {
  const module={exports:{}};
  vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,require:id=>mocks[id]??require(id),console,Date,Map,Set});
  return module.exports;
}
const core=load('src/lib/express.ts');
const carton='11111111-1111-4111-8111-111111111111', waybill='22222222-2222-4222-8222-222222222222';
function setup({staff=true,existing=false,group=false,records=[]}={}) {
  const writes=[];
  const db={from(table){
    let filters={},value;
    const query={select(){return query;},eq(k,v){filters[k]=v;return query;},in(){return query;},order(){return query;},limit(){return query;},maybeSingle(){return query;},single(){return query;},upsert(v){value=v;return query;},update(v){value=v;return query;},then(resolve){
      if(value){writes.push({table,value});return Promise.resolve(resolve({data:{id:carton},error:null}));}
      let data=[];
      if(table==='cartons' && filters.carton_no==='BOX1')data=[{id:carton}];
      if(table==='express_dispatch_drafts')data=existing?{id:carton}:null;
      if(table==='delivery_queue')data=[{kind:'carton',ref_id:carton},{kind:'waybill',ref_id:waybill}];
      return Promise.resolve(resolve({data,error:null}));
    }};return query;
  }};
  const ctx=async source=>({allowedToShip:true,units:[{source}],coverage:source.kind==='carton'?[`carton:${carton}`,`waybill:${waybill}`]:[`waybill:${waybill}`],ownerId:null});
  let schema;
  const builder={middleware(){return builder;},inputValidator(s){schema=s;return builder;},handler(fn){return data=>fn({data:schema.parse(data),context:{userId:carton,supabase:{rpc:async()=>({data:staff})}}});}};
  const api=load('src/lib/express-dispatch.functions.ts',{
    '@tanstack/react-start':{createServerFn:()=>builder},
    '@/integrations/supabase/auth-middleware':{requireSupabaseAuth:{}},
    './express':core,
    './express-context.server':{expressDb:db,expressContext:ctx},
    './express-service.server':{getExpressWorkspace:async source=>({number:'BOX1',source,allowedToShip:true,destination:{...core.emptyAddress,address:'123 Main'},settings:{origin:core.emptyAddress},packageType:'parcel',packages:[{lengthCm:0,widthCm:0,heightCm:0,weightKg:0}],records})},
    './delivery-queue.functions':{loadDeliveryGroups:async()=>({groups:group?[{key:'g',ids:[carton,waybill],customer_code:'00123',full_name:'Recipient',phone:'123',editable_address:{line1:'123 Main',city:'Toronto',province:'ON',country:'CA',postal_code:'M1A1A1'}}]:[]})},
  });
  return {run:api.expressDispatch,writes};
}
test('staff authorization is required before scanner/database access',async()=>{const s=setup({staff:false});await assert.rejects(s.run({action:'scan',code:'BOX1'}),/仅员工/);assert.equal(s.writes.length,0);});
test('scan creates one physical draft without fabricating missing dimensions',async()=>{const s=setup();await s.run({action:'scan',code:'BOX1'});assert.equal(s.writes.length,1);assert.equal(s.writes[0].value.draft.packages[0].weightKg,0);});
test('rescanning retains saved edits rather than overwriting',async()=>{const s=setup({existing:true});const r=await s.run({action:'scan',code:'BOX1'});assert.equal(r.keys.length,1);assert.equal(s.writes.length,0);});
test('a carton and covered waybill generate only one dispatch unit',async()=>{const s=setup({group:true});const r=await s.run({action:'prepare',keys:['g']});assert.equal(r.keys.length,1);assert.equal(s.writes[0].value.source.kind,'carton');assert.equal(s.writes[0].value.draft.to.address,'123 Main');});
test('stale selection and unknown barcode never create drafts',async()=>{const s=setup();await assert.rejects(s.run({action:'prepare',keys:['missing']}),/记录已变化/);await assert.rejects(s.run({action:'scan',code:'UNKNOWN'}),/未找到/);assert.equal(s.writes.length,0);});

test('print scanner returns only generated labels and never writes drafts',async()=>{const s=setup({records:[{id:'ready',status:'created'},{id:'unknown',status:'unknown'},{id:'void',status:'voided'}]});const r=await s.run({action:'printScan',code:'BOX1'});assert.equal(r.records.length,1);assert.equal(r.records[0].id,'ready');assert.equal(s.writes.length,0);});
test('print scanner never generates a missing label',async()=>{const s=setup();await assert.rejects(s.run({action:'printScan',code:'BOX1'}),/尚无已生成/);assert.equal(s.writes.length,0);});
