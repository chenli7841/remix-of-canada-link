import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const locations=JSON.parse(fs.readFileSync('src/components/partner/canada-locations.json','utf8'));
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/canada-address.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,require:()=>locations});
const origin=new URL(process.env.SUPABASE_URL).origin;
if(origin!=='https://fhfsrrbzubgjrjhgwerv.supabase.co')throw new Error('Unexpected project');
const headers={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY};
async function read(table,select){const all=[];for(let offset=0;;offset+=500){const r=await fetch(`${origin}/rest/v1/${table}?select=${select}&order=id&offset=${offset}&limit=500`,{headers});if(!r.ok)throw new Error(`${table}: HTTP ${r.status}`);const rows=await r.json();all.push(...rows);if(rows.length<500)break;}return all;}
const profiles=await read('profiles','id,customer_code,full_name,reg_country,reg_province,reg_city,reg_address,reg_postal_code');
const addresses=await read('addresses','id,user_id,recipient,country,province,city,line1,postal_code,is_default');
const profileMap=new Map(profiles.map(p=>[p.id,p]));
const manual=[],changes=[];let matched=0;
for(const row of [...addresses.map(a=>({...a,source:'addresses',customer_code:profileMap.get(a.user_id)?.customer_code,name:a.recipient,address:a.line1})),...profiles.filter(p=>p.reg_address||p.reg_city||p.reg_province).map(p=>({...p,source:'profiles',country:p.reg_country,province:p.reg_province,city:p.reg_city,address:p.reg_address,postal_code:p.reg_postal_code,name:p.full_name}))]){
 const n=exports.normalizeCanadaAddress(row);
 if(n.matched){matched++;if(n.country!==row.country||n.province!==row.province||n.city!==row.city)changes.push({source:row.source,id:row.id,customer_code:row.customer_code,before:{country:row.country,province:row.province,city:row.city},after:{country:n.country,province:n.province,city:n.city}});}
 else manual.push([row.source,row.id,row.customer_code,row.name,row.country,row.province,row.city,row.address,row.postal_code,n.reason,'','']);
}
fs.mkdirSync('outputs/address-audit',{recursive:true});
const csvCell=x=>'"'+String(x??'').replaceAll('"','""')+'"';
fs.writeFileSync('outputs/address-audit/待确认地址.csv','\ufeff'+[['来源','记录ID','客户号','姓名','国家','原省份','原城市','详细地址','邮编','待确认原因','正确省份','正确城市'],...manual].map(r=>r.map(csvCell).join(',')).join('\r\n'));
fs.writeFileSync('outputs/address-audit/可自动规范化.json',JSON.stringify(changes,null,2));
console.log(JSON.stringify({addresses:addresses.length,profilesWithAddress:profiles.filter(p=>p.reg_address||p.reg_city||p.reg_province).length,matched,changes:changes.length,manual:manual.length}));
