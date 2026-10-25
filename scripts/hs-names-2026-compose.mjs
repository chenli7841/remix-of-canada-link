// Assemble only fully reviewed phrase translations. Unknown phrases fail closed.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='.hs-names.local/continuation';
const sources=JSON.parse(fs.readFileSync(`${root}/official-2026.json`));
const overrides=JSON.parse(fs.readFileSync('scripts/hs-source-overrides-2026.json'));
for(const [code,override] of Object.entries(overrides))sources[code]={...sources[code],...override};
const rows=JSON.parse(fs.readFileSync(`${root}/after.json`));
const normalize=s=>s.trim().replace(/^-/,'').replace(/[.:]$/,'').trim().replace(/^[a-z]/,s=>s.toUpperCase());
const dictionary=new Map(fs.readFileSync('scripts/hs-names-2026-bulk-lexicon.txt','utf8').trim().split(/\r?\n/).map(line=>{const p=line.split('|');assert.equal(p.length,2);return p;}));
const number='[0-9][0-9,.]*';
const units={'mm':'毫米','mm²':'平方毫米','g/m²':'克/平方米','decitex':'分特','metric number':'公支','%':'%'};
function quantity(s){
  // All bounds retain strict versus inclusive comparison and the original units.
  const unitPattern='(mm²|mm|g/m²|decitex|metric number|%)';
  let m=s.match(new RegExp(`^(${number}) ${unitPattern} or more but (not exceeding|less than) (${number}) ${unitPattern}$`));
  if(m&&m[2]===m[5])return `≥${m[1]}${units[m[2]]}且${m[3]==='less than'?'<':'≤'}${m[4]}${units[m[5]]}`;
  m=s.match(new RegExp(`^(more than|exceeding|less than) (${number}) ${unitPattern} but (not exceeding|not more than|not less than|less than) (${number}) ${unitPattern}$`));
  if(m&&m[3]===m[6])return `${m[1]==='less than'?'<':'>'}${m[2]}${units[m[3]]}且${{'not exceeding':'≤','not more than':'≤','not less than':'≥','less than':'<'}[m[4]]}${m[5]}${units[m[6]]}`;
  m=s.match(new RegExp(`^(${number}) ${unitPattern} or (more|less)$`));
  if(m)return `${m[3]==='more'?'≥':'≤'}${m[1]}${units[m[2]]}`;
  m=s.match(new RegExp(`^(less than|not less than|more than|not more than|exceeding|not exceeding) (${number}) ${unitPattern}$`));
  if(m)return `${{'less than':'<','not less than':'≥','more than':'>','not more than':'≤','exceeding':'>','not exceeding':'≤'}[m[1]]}${m[2]}${units[m[3]]}`;
  return null;
}
function translate(raw){
 const s=normalize(raw);if(dictionary.has(s))return dictionary.get(s);
 for(const [prefix,zh] of [['Other, ','其他，'],['Rounds, ','圆材，'],['Round, ','圆形，'],['Other round, ','其他圆形，'],['Other, of circular cross-section, ','其他圆形截面，'],['Of circular cross section, ','圆形截面，'],['Heat treated, ','经热处理，'],['Round, heat treated, ','圆形且经热处理，'],['Large leg, ','长边，'],['American standard, ','美国标准，'],['Plain weave, ','平纹，'],['Plated or coated with zinc-aluminum, ','镀或涂锌铝合金，']]){
  if(s.startsWith(prefix)){const t=translate(s.slice(prefix.length));if(t)return zh+t;}
 }
 for(const [prefix,zh] of [['Of a thickness of ','厚度'],['Of a thickness ','厚度'],['Of thickness ','厚度'],['Of a width of ','宽度'],['Of a width ','宽度'],['Of a diameter of ','直径'],['Of a diameter ','直径'],['With a diameter of ','直径'],['With a diameter ','直径'],['Of a height of ','高度'],['Of a height ','高度'],['Weighing ','单位面积重量'],['With a maximum cross section of ','最大截面尺寸'],['With a minimum cross section ','最小截面尺寸']]){
  if(s.startsWith(prefix)){const t=quantity(s.slice(prefix.length));if(t)return zh+t;}
 }
 let m=s.match(/^Containing by weight (.+) of (carbon|silicon|lead)$/i);
 if(m){const q=quantity(m[1].replace(/%/g,' %'));if(q)return `${{carbon:'碳',silicon:'硅',lead:'铅'}[m[2]]}重量含量${q}`;}
 m=s.match(/^Measuring (per single yarn )?(.+?)(?: \((.+)\))?$/);
 if(m){const q=quantity(m[2]);const metric=m[3]?quantity(m[3].replaceAll(' per single yarn','')):null;if(q&&(!m[3]||metric))return `${m[1]?'每根单纱':''}细度${q}${metric?'（'+metric+'）':''}`;}
 return null;
}
const chapters=new Set((process.argv.find(x=>x.startsWith('--chapters='))?.split('=')[1]??'52,55,56,57,68,72,74').split(','));
const existing=new Set(fs.readFileSync('scripts/hs-names-2026-reviewed.txt','utf8').trim().split(/\r?\n/).map(l=>l.split('|')[0]));
const missing=new Map(),result=[];
for(const row of rows.sort((a,b)=>a.hs_code.localeCompare(b.hs_code))){
 if(!chapters.has(row.hs_code.slice(0,2))||/[\u3400-\u9fff]/.test(row.name_zh)||existing.has(row.hs_code))continue;
 const source=sources[row.hs_code];if(!source)continue;
 const parts=source.description.split(/ - /),translated=parts.map(translate);
 if(translated.some(x=>!x)){parts.forEach((p,i)=>{if(!translated[i])missing.set(normalize(p),(missing.get(normalize(p))??0)+1)});continue;}
 // Retain every hierarchy level, including residual categories.
 result.push({code:row.hs_code,zh:translated.filter((s,i)=>s==='其他'||i===0||s!==translated[i-1]).join('；'),en:source.description});
}
fs.writeFileSync(`${root}/composed-preview.json`,JSON.stringify(result,null,2));
fs.writeFileSync(`${root}/untranslated-phrases.json`,JSON.stringify([...missing].sort((a,b)=>b[1]-a[1]),null,2));
console.log(JSON.stringify({ready:result.length,chapters:Object.fromEntries([...chapters].map(ch=>[ch,result.filter(x=>x.code.startsWith(ch)).length])),unknownPhrases:missing.size}));
if(process.argv.includes('--append')){const limit=Number(process.argv.find(x=>x.startsWith('--limit='))?.split('=')[1]??result.length);assert.ok(limit<=result.length);fs.appendFileSync('scripts/hs-names-2026-reviewed.txt',result.slice(0,limit).map(r=>`${r.code}|${r.zh}`).join('\n')+'\n');console.log('Appended '+limit);}
