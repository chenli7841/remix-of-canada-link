import fs from 'node:fs';
import assert from 'node:assert/strict';
const url=process.env.SUPABASE_URL;
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon=fs.readFileSync('src/integrations/supabase/client.ts','utf8').match(/const SUPABASE_PUBLISHABLE_KEY = "([^"]+)"/)[1];
async function req(path,key,body){const r=await fetch(url+'/rest/v1/'+path,{headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;}
const parents=await req('forwarding_orders?select=*&order=created_at.desc&limit=60',service);
let tested=0,domestic=0,multiple=0;
for(const p of parents){const base=await req('rpc/track_order_by_any_no',anon,{_input:p.request_no});assert.equal(base.order_no,p.request_no);assert.equal(base.events[0].status_zh,'订单已生成');assert.equal(base.events.filter(x=>x.status_zh==='订单已生成').length,1);assert.ok(!('address_snapshot' in base)&&!('user_id' in base));if(!base.waybills.length)continue;
 const wb=await req('rpc/track_order_by_any_no',anon,{_input:base.waybills.at(-1).waybill_no});assert.deepEqual(wb,base);tested++;
 if(p.domestic_tracking_no){const d=await req('rpc/track_order_by_any_no',anon,{_input:p.domestic_tracking_no});assert.deepEqual(d,base);domestic++;}
 if(base.waybills.length>1)multiple++;
 if(tested>=8&&domestic>=2&&multiple>=1)break;
}
assert.ok(tested&&domestic);assert.equal(await req('rpc/track_order_by_any_no',anon,{_input:'NONEXISTENT-UNIFIED-TRACKING-TEST'}),null);
console.log(JSON.stringify({passed:true,waybillLookups:tested,domesticLookups:domestic,multipleWaybillOrders:multiple}));
