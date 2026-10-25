// Apply only exact-code, simple MFN rates verified against CBSA T2026-2.
// Never recompute customer invoices or change order/payment records.
import fs from 'node:fs';import assert from 'node:assert/strict';import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env');assert.equal(new URL(process.env.SUPABASE_URL).hostname,'fhfsrrbzubgjrjhgwerv.supabase.co');
const root='.hs-names.local/continuation';const before=JSON.parse(fs.readFileSync(`${root}/inventory.json`));const official=JSON.parse(fs.readFileSync(`${root}/official-2026.json`));
const plan=before.filter(r=>official[r.hs_code]?.rate!=null&&(!Number.isFinite(Number(r.mfn_rate))||Math.abs(Number(r.mfn_rate)-official[r.hs_code].rate)>1e-9)).map(r=>({before:r,after:official[r.hs_code].rate,source:official[r.hs_code]}));
fs.writeFileSync(`${root}/rate-plan.json`,JSON.stringify(plan,null,2));console.log('Planned exact-code rates: '+plan.length);if(!process.argv.includes('--apply'))process.exit();
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const groups=new Map();for(const p of plan){const k=JSON.stringify([p.before.mfn_rate,p.after]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(p);}
let changed=0;
for(const group of groups.values())for(let start=0;start<group.length;start+=100){const batch=group.slice(start,start+100);const ids=batch.map(p=>p.before.id);const current=await db.from('hs_codes').select('*').in('id',ids);if(current.error)throw Error(current.error.message);const pending=[];
for(const p of batch){const r=current.data.find(r=>r.id===p.before.id);assert.ok(r);assert.equal(r.hs_code,p.before.hs_code);if(Number(r.mfn_rate)===p.after)continue;assert.deepEqual(r.mfn_rate,p.before.mfn_rate,'Concurrent rate change '+r.hs_code);pending.push({...p,current:r});}
if(!pending.length)continue;fs.appendFileSync(`${root}/rate-journal.jsonl`,JSON.stringify({event:'before',rows:pending,at:new Date().toISOString()})+'\n');
const saved=await db.from('hs_codes').update({mfn_rate:pending[0].after}).in('id',pending.map(p=>p.before.id)).eq('mfn_rate',pending[0].before.mfn_rate).select('*');if(saved.error)throw Error(saved.error.message);assert.equal(saved.data.length,pending.length);
for(const p of pending){const r=saved.data.find(r=>r.id===p.before.id);assert.equal(Number(r.mfn_rate),p.after);for(const key of Object.keys(p.current))if(!['mfn_rate','updated_at'].includes(key))assert.deepEqual(r[key],p.current[key],key);}
const log=await db.from('admin_action_logs').insert(pending.map(p=>({entity_type:'hs_code',entity_id:p.before.id,action:'update',operator_id:null,operator_name:'Codex（用户授权补全 HS 编码库）',before:{mfn_rate:p.before.mfn_rate},after:{mfn_rate:p.after},note:`按 CBSA T2026-2 精确10位编码核对 MFN：${p.source.mfnText}。来源：${p.source.url}。未重算历史订单或账单。`})));if(log.error)throw Error('Rates saved; audit failure: '+log.error.message);
changed+=pending.length;fs.appendFileSync(`${root}/rate-journal.jsonl`,JSON.stringify({event:'verified',ids:pending.map(p=>p.before.id),at:new Date().toISOString()})+'\n');console.log('Verified '+changed);
}
console.log('Applied and verified '+changed);
