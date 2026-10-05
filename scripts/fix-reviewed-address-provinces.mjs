import fs from 'node:fs';
const plan=JSON.parse(fs.readFileSync('outputs/address-audit/user-confirmed/plan.json','utf8'));
const reviewed=new Map(JSON.parse(fs.readFileSync('outputs/address-audit/postal-summary.json','utf8')).rows.map(r=>[r.id,r.result[0]]));
const corrections=plan.filter(r=>r.after?.country==='CA'&&reviewed.get(r.id)&&r.after.province!==reviewed.get(r.id));
const root='outputs/address-audit/user-confirmed';
const origin=new URL(process.env.SUPABASE_URL).origin;if(origin!=='https://fhfsrrbzubgjrjhgwerv.supabase.co')throw new Error('Unexpected project');
const headers={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
if(!process.argv.includes('--apply'))throw new Error('Requires --apply');
const file=root+'/province-corrections.json';
if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(corrections.map(r=>({id:r.id,customer:r.customer_code,before:r.after,after:{...r.after,province:reviewed.get(r.id)}})),null,2));
let count=0;for(const p of corrections){const q=new URLSearchParams({id:'eq.'+p.id,select:'id,province'});for(const [k,v]of Object.entries(p.after))q.set(k,'eq.'+v);const r=await fetch(`${origin}/rest/v1/${p.table}?${q}`,{method:'PATCH',headers,body:JSON.stringify({province:reviewed.get(p.id)})});if(!r.ok)throw new Error('Province update failed '+r.status);const a=await r.json();if(a.length!==1)throw new Error('Concurrent change, not updated');count++;}
for(const p of corrections){const r=await fetch(`${origin}/rest/v1/${p.table}?id=eq.${p.id}&select=province`,{headers});if(!r.ok||(await r.json())[0]?.province!==reviewed.get(p.id))throw new Error('Verification failed');}
console.log(JSON.stringify({updated:count,verified:count}));
