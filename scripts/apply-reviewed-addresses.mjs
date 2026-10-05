import fs from 'node:fs';
const root='outputs/address-audit/user-confirmed';fs.mkdirSync(root,{recursive:true});
const origin=new URL(process.env.SUPABASE_URL).origin;
if(origin!=='https://fhfsrrbzubgjrjhgwerv.supabase.co')throw new Error('Unexpected project');
const headers={apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+process.env.SUPABASE_SERVICE_ROLE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
const source=JSON.parse(fs.readFileSync('outputs/address-review-workbook/source.json','utf8'));
const suggestions=new Map(JSON.parse(fs.readFileSync('outputs/address-audit/municipal-summary.json','utf8')).rows.map(r=>[r.id,r]));
const overrides={'03537':'Guelph','04340':'Markham','06450':'Scarborough','05413':'Wainfleet','01672':'St. Catharines','06693':'Bradford','06389':'Bradford','07067':'Mississauga'};
const hold=new Set(['03687','07273']);
const field=(table,k)=>table==='profiles'?'reg_'+k:k;
async function request(table,q,method='GET',body){const r=await fetch(`${origin}/rest/v1/${table}?${q}`,{method,headers,body:body?JSON.stringify(body):undefined});if(!r.ok)throw new Error(`${method} ${table}: HTTP ${r.status}`);return r.json();}
const mode=process.argv[2];
if(mode==='--prepare'){
 if(fs.existsSync(root+'/plan.json'))throw new Error('Plan exists; preserve backup');
 const current=new Map();
 for(const table of ['addresses','profiles']){const rows=source.filter(r=>r['来源']===table);for(let i=0;i<rows.length;i+=60){const part=rows.slice(i,i+60);const items=await request(table,new URLSearchParams({select:table==='addresses'?'*':'id,customer_code,reg_country,reg_province,reg_city,reg_address,reg_postal_code',id:'in.('+part.map(r=>r['记录ID']).join(',')+')'}));for(const item of items)current.set(table+':'+item.id,item);}}
 const plans=source.map(r=>{
  const table=r['来源'],id=r['记录ID'],code=r['客户号'],before=current.get(table+':'+id);
  const p={table,id,customer_code:code,before};if(!before)return {...p,action:'hold_missing'};
  if(hold.has(code))return {...p,action:'hold_confirmation'};
  const checks={country:r['国家'],province:r['原省份'],city:r['原城市'],postal_code:r['邮编'],[table==='profiles'?'address':'line1']:r['详细地址']};
  if(Object.entries(checks).some(([k,v])=>(before[field(table,k)]??'')!==(v??'')))return {...p,action:'hold_changed'};
  if(code==='04058')return {...p,action:'delete'};
  const city=overrides[code]||suggestions.get(id)?.city;if(!city)return {...p,action:'hold_no_suggestion'};
  const province=String(r['原省份']).trim()==='Ontario'?'ON':String(r['原省份']).trim().toUpperCase();
  const after=Object.fromEntries(Object.entries({country:'CA',province,city}).map(([k,v])=>[field(table,k),v]));
  return {...p,after,action:Object.entries(after).every(([k,v])=>before[k]===v)?'unchanged':'update'};
 });
 const deletion=plans.find(p=>p.action==='delete');
 const links=deletion?await request('forwarding_orders',new URLSearchParams({select:'id,address_id',address_id:'eq.'+deletion.id})):[];
 fs.writeFileSync(root+'/plan.json',JSON.stringify(plans,null,2),{flag:'wx'});fs.writeFileSync(root+'/delete-linked-orders.json',JSON.stringify(links,null,2),{flag:'wx'});
 console.log(JSON.stringify({actions:plans.reduce((a,p)=>(a[p.action]=(a[p.action]||0)+1,a),{}),linkedOrders:links.length}));
}else if(mode==='--apply'){
 const plans=JSON.parse(fs.readFileSync(root+'/plan.json','utf8'));const logFile=root+'/execution.json';const log=fs.existsSync(logFile)?JSON.parse(fs.readFileSync(logFile,'utf8')):[];const done=new Set(log.filter(x=>['updated','deleted','unchanged'].includes(x.status)).map(x=>x.id));
 for(const p of plans){if(done.has(p.id)||!['update','delete','unchanged'].includes(p.action))continue;
  if(p.action==='unchanged'){log.push({id:p.id,customer_code:p.customer_code,status:'unchanged'});continue;}
  const q=new URLSearchParams({id:'eq.'+p.id,select:'id'});
  for(const k of Object.keys(p.before)){if(k==='id')continue;const v=p.before[k];if(typeof v==='object'&&v!==null)continue;q.set(k,v===null?'is.null':'eq.'+v);}
  const result=await request(p.table,q,p.action==='delete'?'DELETE':'PATCH',p.action==='delete'?undefined:p.after);
  log.push({id:p.id,customer_code:p.customer_code,status:result.length===1?(p.action==='delete'?'deleted':'updated'):'skipped_concurrent_change',time:new Date().toISOString()});
  fs.writeFileSync(logFile,JSON.stringify(log,null,2));
 }
 fs.writeFileSync(logFile,JSON.stringify(log,null,2));console.log(JSON.stringify(log.reduce((a,p)=>(a[p.status]=(a[p.status]||0)+1,a),{})));
}else if(mode==='--verify'){
 const plans=JSON.parse(fs.readFileSync(root+'/plan.json','utf8'));let verified=0;
 const logs=JSON.parse(fs.readFileSync(root+'/execution.json','utf8'));const completed=new Set(logs.filter(r=>['updated','deleted','unchanged'].includes(r.status)).map(r=>r.id));
 for(const p of plans.filter(p=>completed.has(p.id))){const rows=await request(p.table,new URLSearchParams({select:'*',id:'eq.'+p.id}));if(p.action==='delete'){if(rows.length)throw new Error('Deletion verification failed');}else if(rows.length!==1||Object.entries(p.after).some(([k,v])=>rows[0][k]!==v))throw new Error('Verification failed '+p.id);verified++;}
 console.log(JSON.stringify({verified}));
}else throw new Error('Use --prepare, --apply or --verify');
