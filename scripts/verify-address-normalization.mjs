import fs from 'node:fs';
const changes=JSON.parse(fs.readFileSync('outputs/address-audit/可自动规范化.json','utf8'));
const origin=new URL(process.env.SUPABASE_URL).origin;if(origin!=='https://fhfsrrbzubgjrjhgwerv.supabase.co')throw new Error('Unexpected project');
const headers={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY};let verified=0;
for(const table of ['addresses','profiles']){
 const expected=changes.filter(r=>r.source===table);if(!expected.length)continue;
 const f=k=>table==='profiles'?'reg_'+k:k;
 const q=new URLSearchParams({select:'id,'+['country','province','city'].map(f).join(','),id:'in.('+expected.map(r=>r.id).join(',')+')'});
 const r=await fetch(`${origin}/rest/v1/${table}?${q}`,{headers});if(!r.ok)throw new Error('Read failed '+r.status);
 const rows=await r.json();for(const e of expected){const actual=rows.find(r=>r.id===e.id);if(!actual || Object.entries(e.after).some(([k,v])=>actual[f(k)]!==v))throw new Error('Verification mismatch');verified++;}
}
console.log('已重新读取并验证 '+verified+' 条地址规范化结果。');
