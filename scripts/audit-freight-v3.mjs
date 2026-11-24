import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { transform } from 'esbuild';
process.loadEnvFile();
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const module=await transform(fs.readFileSync('src/lib/measured-freight.ts','utf8'),{loader:'ts',format:'esm'});
const {measuredFreight}=await import(`data:text/javascript;base64,${Buffer.from(module.code).toString('base64')}`);
async function all(table,select='*') { const out=[]; for(let offset=0;;offset+=500) {const r=await sb.from(table).select(select).order('id').range(offset,offset+499);if(r.error)throw Error(`${table}: ${r.error.message}`);out.push(...r.data);if(r.data.length<500)break;}return out; }
const [wbs,forwardings,orders,rules,cartons,pallets,settlements]=await Promise.all([
  all('waybills'),all('forwarding_orders','id,route_id,request_no,freight_snapshot,fee_cny,payment_status'),
  all('orders','id,route_id,order_no,freight_snapshot,shipping_cny,payment_status'),all('freight_rules'),all('cartons'),all('pallets'),all('batch_settlements')
]);
const fxSetting=await sb.from('app_settings').select('value').eq('key','fx_rate').maybeSingle();
if(fxSetting.error)throw Error(fxSetting.error.message);
const globalFx=Number(fxSetting.data?.value?.cny_per_cad)>0 ? +(1/Number(fxSetting.data.value.cny_per_cad)).toFixed(6) : 0.19;
const originals=await all('freight_rules_before_v3');
const oldRules=new Map(originals.map(r=>[r.id,r.snapshot]));
const parents=new Map([...forwardings,...orders].map(p=>[p.id,p]));
const active=new Map();for(const r of rules.filter(r=>r.is_active).sort((a,b)=>b.created_at.localeCompare(a.created_at)))if(!active.has(r.route_id))active.set(r.route_id,r);
const cms=new Map(cartons.map(c=>[c.id,c])),pms=new Map(pallets.map(p=>[p.id,p]));
const changes=[],blocked=[];
for(const w of wbs){
 const parent=parents.get(w.forwarding_id??w.order_id),rule=active.get(parent?.route_id);
 if(!rule || ![w.weight_kg,w.length_cm,w.width_cm,w.height_cm].every(v=>Number(v)>0))continue;
 const fx=Number(w.weight_snapshot?.fx_rate??parent?.freight_snapshot?.fx_rate??globalFx);
 if(!(fx>0) && !(Number(rule.unit_price_cad)>0)) {blocked.push({id:w.id,reason:'missing_fx'});continue;}
 let next;try{next=measuredFreight(rule,{weight:Number(w.weight_kg),length:Number(w.length_cm),width:Number(w.width_cm),height:Number(w.height_cm)},fx>0?fx:1);}catch(error){blocked.push({id:w.id,reason:error.message});continue;}
 if(Math.round(Number(w.freight_cad)*100)===Math.round(next.freight_cad*100))continue;
 const c=cms.get(w.carton_id),p=pms.get(c?.pallet_id??w.pallet_id),batch=p?.batch_id??c?.batch_id??w.assigned_batch_id;
 const frozen=settlements.some(s=>s.batch_id===batch && s.confirmed); // Conservative: never reprice a batch with any confirmed bill.
 const oldRule=oldRules.get(rule.id),oldMin=Number(oldRule?.min_charge_waybill_cad??oldRule?.min_charge_cad??0);
 const minimumOnly=Number(w.freight_cad)>next.freight_cad && Math.round(Number(w.freight_cad)*100)===Math.round(Math.max(next.freight_cad,oldMin)*100);
 changes.push({updated_at:w.updated_at,route_id:parent?.route_id,minimumOnly,fx:fx>0?fx:globalFx,id:w.id,no:w.waybill_no,parent_id:parent?.id,parent_no:parent?.request_no??parent?.order_no,batch_id:batch,before:w.freight_cad,after:next.freight_cad,eligible:w.payment_status!=='paid'&&parent?.payment_status!=='paid'&&!frozen,reason:frozen?'confirmed_batch':w.payment_status==='paid'||parent?.payment_status==='paid'?'paid':'unconfirmed',snapshot:next});
}
fs.mkdirSync('outputs/freight-v3',{recursive:true});
fs.writeFileSync('outputs/freight-v3/audit.json',JSON.stringify({created_at:new Date().toISOString(),project:process.env.SUPABASE_URL,counts:{waybills:wbs.length,cartons:cartons.length,pallets:pallets.length},changes,blocked},null,2));
console.log(JSON.stringify({waybills:wbs.length,different:changes.length,eligible:changes.filter(c=>c.eligible).length,protected:changes.filter(c=>!c.eligible).length,blocked:blocked.length}));
