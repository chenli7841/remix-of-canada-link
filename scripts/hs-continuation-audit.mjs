import fs from 'node:fs';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env');
if(new URL(process.env.SUPABASE_URL).hostname!=='fhfsrrbzubgjrjhgwerv.supabase.co')throw Error('Unexpected project');
const db=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const rows=[];
for(let from=0;;from+=1000){const r=await db.from('hs_codes').select('*').order('id').range(from,from+999);if(r.error)throw Error(r.error.message);rows.push(...r.data);if(r.data.length<1000)break;}
fs.mkdirSync('.hs-names.local/continuation',{recursive:true});fs.writeFileSync('.hs-names.local/continuation/inventory.json',JSON.stringify(rows,null,2));
const missing=rows.filter(r=>!/[\u3400-\u9fff]/.test(r.name_zh||''));
console.log(JSON.stringify({total:rows.length,missingChinese:missing.length,missingEnglish:rows.filter(r=>!r.name_en?.trim()).length,missingRate:rows.filter(r=>r.mfn_rate==null).length,byChapter:missing.reduce((a,r)=>(a[r.hs_code.slice(0,2)]=(a[r.hs_code.slice(0,2)]||0)+1,a),{})}));
