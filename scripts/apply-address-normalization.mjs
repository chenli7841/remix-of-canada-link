import fs from 'node:fs';
const origin=new URL(process.env.SUPABASE_URL).origin;
if(origin!=='https://fhfsrrbzubgjrjhgwerv.supabase.co')throw new Error('Unexpected project');
if(!process.argv.includes('--apply'))throw new Error('请指定 --apply 才执行线上规范化');
const changes=JSON.parse(fs.readFileSync('outputs/address-audit/可自动规范化.json','utf8'));
const headers={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
const results=[];
for(const row of changes){
 if(!['addresses','profiles'].includes(row.source))throw new Error('Unexpected table');
 const field=k=>row.source==='profiles'?'reg_'+k:k;
 const query=new URLSearchParams({id:'eq.'+row.id,select:'id'});
 for(const k of ['country','province','city'])query.set(field(k),row.before[k]===null?'is.null':'eq.'+row.before[k]);
 const payload=Object.fromEntries(Object.entries(row.after).map(([k,v])=>[field(k),v]));
 const r=await fetch(`${origin}/rest/v1/${row.source}?${query}`,{method:'PATCH',headers,body:JSON.stringify(payload)});
 if(!r.ok){results.push({id:row.id,status:'error',http:r.status});break;}
 const data=await r.json();results.push({id:row.id,status:data.length===1?'updated':'skipped_concurrent_change'});
 fs.writeFileSync('outputs/address-audit/规范化执行记录.json',JSON.stringify(results,null,2));
}
console.log(JSON.stringify(results.reduce((m,r)=>{m[r.status]=(m[r.status]||0)+1;return m},{})));
if(results.some(r=>r.status==='error'))process.exitCode=1;
