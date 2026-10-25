// Read-only official tariff comparison; no database writes.
import fs from 'node:fs';
const root='.hs-names.local/continuation';
const inventory=JSON.parse(fs.readFileSync(`${root}/inventory.json`));
const decode=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#(?:39|x27);|&apos;/g,"'").replace(/&ndash;/g,'–').replace(/&mdash;/g,'—').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/\s+/g,' ').trim();
const official={};const failures=[];
const chapters=Array.from({length:99},(_,i)=>String(i+1).padStart(2,'0')).filter(c=>c!=='77');
let next=0;
await Promise.all(Array.from({length:4},async()=>{while(next<chapters.length){const ch=chapters[next++];const url=`https://www.cbsa-asfc.gc.ca/trade-commerce/tariff-tarif/2026/html/02/ch${ch}-eng.html`;const path=`${root}/ch${ch}.html`;try{let html;if(fs.existsSync(path))html=fs.readFileSync(path,'utf8');else{const r=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`HTTP ${r.status}`);html=await r.text();fs.writeFileSync(path,html);}let count=0;for(const m of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const c=[...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(x=>decode(x[1]));if(!/^\d{4}\.\d{2}\.\d{2}$/.test(c[0])||!/^\d{2}$/.test(c[1]))continue;const rate=c[4]==='Free'?0:/^\d+(\.\d+)?%$/.test(c[4])?parseFloat(c[4])/100:null;official[`${c[0]}.${c[1]}`]={description:c[2],unit:c[3],mfnText:c[4],rate,url};count++;}if(!count)throw Error('No statistical codes');console.log(ch+': '+count);}catch(e){failures.push({chapter:ch,error:e.message});}}}));
fs.writeFileSync(`${root}/official-2026.json`,JSON.stringify(official,null,2));
const mismatches=[],unmatched=[],complex=[];
for(const r of inventory){const s=official[r.hs_code];if(!s){unmatched.push({code:r.hs_code,name:r.name_zh});continue;}if(s.rate===null)complex.push({code:r.hs_code,stored:r.mfn_rate,official:s.mfnText});else if(!Number.isFinite(Number(r.mfn_rate))||Math.abs(Number(r.mfn_rate)-s.rate)>1e-9)mismatches.push({code:r.hs_code,stored:r.mfn_rate,official:s.rate,text:s.mfnText});}
const existing=new Set(inventory.map(r=>r.hs_code));const absent=Object.keys(official).filter(c=>!existing.has(c));
const report={at:new Date().toISOString(),officialCount:Object.keys(official).length,failures,mismatches,unmatched,complex,absent};fs.writeFileSync(`${root}/tariff-audit.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({official:report.officialCount,failures,mismatches:mismatches.length,unmatched:unmatched.length,complex:complex.length,absent:absent.length}));
