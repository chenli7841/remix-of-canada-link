import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import assert from 'node:assert/strict';
const compile=path=>ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const helpers={};vm.runInNewContext(compile('src/lib/delivery-sheet.ts'),{exports:helpers,Map,Set,URLSearchParams});
let reservations=0, denied=false;const requests=[];
const admin={rpc:async()=>{if(denied)return {error:{message:'DELIVERY_MAPS_MONTHLY_LIMIT'}};reservations++;return {data:reservations};}};
const server={};
vm.runInNewContext(compile('src/lib/delivery-route.functions.ts'),{
 exports:server,process:{env:{GOOGLE_MAPS_API_KEY:'test-placeholder'}},AbortSignal,Response,URLSearchParams,btoa,
 require:id=>{
  if(id==='@tanstack/react-start')return {createServerFn:()=>({middleware(){return this;},inputValidator(){return this;},handler(fn){return fn;}})};
  if(id==='zod')return {z};
  if(id.includes('auth-middleware'))return {requireSupabaseAuth:{}};
  if(id.includes('delivery-sheet'))return helpers;
  if(id.includes('admin-log'))return {recordAdminLog:async()=>{}};
  if(id.includes('client.server'))return {supabaseAdmin:admin};
  throw new Error(id);
 },
 fetch:async(url,options)=>{
  if(url.includes('staticmap')){requests.push({map:true});return new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'image/png'}});}
  const body=JSON.parse(options.body);requests.push(body);
  const count=body.intermediates?.length || 0;
  return new Response(JSON.stringify({routes:[{optimizedIntermediateWaypointIndex:body.optimizeWaypointOrder?Array.from({length:count},(_,i)=>count-1-i):undefined,legs:Array.from({length:count+1},(_,i)=>({endLocation:{latLng:{latitude:43+i/100,longitude:-79}}})),polyline:{encodedPolyline:'test'}}]}));
 }
});
const context={userId:'test',supabase:{rpc:async()=>({data:true})}};
const result=await server.planDeliveryRoute({context,data:{origin:'Stop 21',addresses:Array.from({length:9},(_,i)=>`Stop ${i+22}`),roundTrip:false,optimize:true,keepFirst:true}});
assert.equal(reservations,2);assert.equal(requests.length,3);
assert.equal(requests[0].origin.address,'Stop 21');assert.equal(requests[0].destination.address,'Stop 22');
assert.equal(requests[1].origin.address,'Stop 22');assert.equal(requests[1].destination.address,'Stop 30');
assert.equal(result.order.join(','),'0,7,6,5,4,3,2,1,8');
denied=true;const before=requests.length;
await assert.rejects(server.planDeliveryRoute({context,data:{origin:'Warehouse',addresses:['Stop 1'],roundTrip:false,optimize:false}}),/1,000/);
assert.equal(requests.length,before);
console.log('路线测试通过：第21→22站衔接、第二单首站固定、剩余站点排列不丢失、每次请求先计数、限额后零外部调用。');
