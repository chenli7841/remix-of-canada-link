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
const multi=load('src/lib/express-multipiece.ts');
const {warehouseExpressAddress,dispatchWarehouseExpressAddress}=load('src/lib/express-warehouse.ts',{'./express':core,'./canada-address':{canadaLocations:[{code:'ON',cities:['Toronto','Markham']}]}});
test('courier origin uses structured dispatch warehouse fields including company and unit',()=>{
 const a=dispatchWarehouseExpressAddress({name:'Dispatch',company:'EPLUS',phone:'4161234567',street:'123 Main St',unit:'Unit 8',city:'Markham',province:'ON',postal:'L3R 1A1'});
 assert.equal(a.name,'Dispatch');assert.equal(a.company,'EPLUS');assert.equal(a.mobile_phone,'4161234567');assert.equal(a.address,'123 Main St');assert.equal(a.address2,'Unit 8');assert.equal(a.city,'Markham');assert.equal(a.province,'ON');assert.equal(a.postalcode,'L3R 1A1');assert.equal(a.region_id,'CA');assert.equal(a.type,'commercial');
});
test('warehouse selection fills contact and parses an explicit Canadian address',()=>{
 const a=warehouseExpressAddress({name_zh:'多伦多仓',name_en:'Toronto depot',contact:'Dispatch',phone:'4161234567',country:'CA',address:'123 Main Street, Markham, ON L3R 1A1'});
 assert.equal(a.name,'Dispatch');assert.equal(a.mobile_phone,'4161234567');assert.equal(a.address,'123 Main Street');assert.equal(a.city,'Markham');assert.equal(a.province,'ON');assert.equal(a.postalcode,'L3R 1A1');assert.equal(a.type,'commercial');
});
test('warehouse address without recognizable locality stays intact with missing fields empty',()=>{
 const a=warehouseExpressAddress({name_zh:'仓库',country:'CA',address:'123 Unknown Road'});
 assert.equal(a.address,'123 Unknown Road');assert.equal(a.city,'');assert.equal(a.postalcode,'');assert.equal(a.mobile_phone,'');
});
test('non-Canadian warehouse address is preserved without guessing',()=>{
 const a=warehouseExpressAddress({name_zh:'义乌仓',country:'CN',address:'浙江省义乌市某街道'});
 assert.equal(a.region_id,'CN');assert.equal(a.address,'浙江省义乌市某街道');assert.equal(a.province,'');
});
const carton='11111111-1111-4111-8111-111111111111', waybill='22222222-2222-4222-8222-222222222222';
function setup({staff=true,existing=false,group=false,records=[]}={}) {
  const writes=[];
  const db={from(table){
    let filters={},value;
    const query={select(){return query;},eq(k,v){filters[k]=v;return query;},in(){filters.many=true;return query;},order(){return query;},limit(){return query;},maybeSingle(){return query;},single(){return query;},upsert(v){value=v;return query;},update(v){value=v;return query;},then(resolve){
      if(value){writes.push({table,value});return Promise.resolve(resolve({data:{id:carton},error:null}));}
      let data=[];
      if(table==='cartons' && filters.carton_no==='BOX1')data=[{id:carton}];
      if(table==='express_dispatch_drafts')data=filters.many?writes.filter(w=>w.table===table).map(w=>w.value):existing?{id:carton}:null;
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
    './express-multipiece':multi,
    './verykship.server':{fingerprint:v=>JSON.stringify(v)},
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

test('three units at one address form one shipment with three distinct packages',()=>{
 const rows=[1,2,3].map(i=>({source_key:'waybill:'+i,number:'WB'+i,customer_code:'08634',draft:{from:{address:'Depot'},to:{name:'Customer',address:'255B Lissington',city:'Calgary'},packageType:'parcel',packages:[{weightKg:i,lengthCm:i*10,widthCm:7,heightCm:6}]}}));
 const groups=multi.groupExpressDrafts(rows);assert.equal(groups.length,1);const packages=multi.mergedPackages(groups[0]);assert.equal(packages.length,3);assert.equal(packages[2].weightKg,3);assert.equal(packages[1].reference,'WB2');
 rows[2].draft.to.address='Different';assert.equal(multi.groupExpressDrafts(rows).length,2);
});

test('combined shipping context locks every original unit and shares scan links',async()=>{
 const ids=[1,2,3].map(i=>`00000000-0000-4000-8000-00000000000${i}`);
 const groupId='00000000-0000-4000-8000-000000000009';
 const group={id:groupId,number:'一票3件',source:{members:ids.map(id=>({kind:'waybill',id}))},draft:{to:core.emptyAddress,packages:ids.map((id,i)=>({reference:id,weightKg:i+1,lengthCm:10,widthCm:10,heightCm:10}))}};
 const rows={express_dispatch_drafts:[group],waybills:ids.map(id=>({id,order_id:'order1',status:'packed'})),orders:[{id:'order1',user_id:'customer',address_snapshot:core.emptyAddress}]};
 const db={from(table){let selected=rows[table]??[];return {select(){return this;},eq(k,v){selected=selected.filter(r=>r[k]===v);return this;},limit(){return this;},async maybeSingle(){return {data:selected[0]??null};},then(resolve){resolve({data:selected,count:selected.length});}};}};
 const {expressContext}=load('src/lib/express-context.server.ts',{'./express':core,'@/integrations/supabase/client.server':{supabaseAdmin:db},'./verykship.server':{fingerprint:v=>JSON.stringify(v)}});
 const source={kind:'dispatch',id:groupId};
 const ctx=await expressContext(source,'staff',true);
 assert.equal(ctx.allowedToShip,true);assert.equal(ctx.coverage.length,3);assert.equal(ctx.packages.length,3);
 for(const id of ids)assert.ok(ctx.links.includes('waybill:'+id));
 assert.ok(ctx.links.includes('order:order1'));assert.equal(core.convertedPackages({packages:ctx.packages},{weight:'kg',length:'cm'}).length,3);
 const hash=ctx.contextHash;rows.waybills[1].status='delivered';const updated=await expressContext(source,'staff',true);assert.equal(updated.allowedToShip,false);assert.notEqual(updated.contextHash,hash);
 await assert.rejects(expressContext(source,'customer',false),/仅员工/);
 group.source.members.push(group.source.members[0]);await assert.rejects(expressContext(source,'staff',true),/重复/);
});
