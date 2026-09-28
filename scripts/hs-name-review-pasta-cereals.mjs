import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const candidates=rows.filter(r=>/^190[234]/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh));
const additions=[];
for(const row of candidates){
const code=row.hs_code,d=sources[code]?.description;assert.ok(d,code);
let zh,en;const z=[],e=[];const q=(a,b)=>{z.push(a);e.push(b);};
if(code.startsWith('1902.11')){zh='含蛋生面食';en='Uncooked egg pasta';}
else if(code.startsWith('1902.19.1')){zh='低蛋白或无蛋白生面食';en='Low-protein or protein-free uncooked pasta';q('加拿大卫生部认证','Health Canada certified');}
else if(code.startsWith('1902.19.2')){zh='面粉清水生面食';en='Uncooked pasta of flour and water only';}
else if(code.startsWith('1902.19.9')){zh='其他不含蛋生面食';en='Other uncooked pasta without eggs';}
else if(code.startsWith('1902.20')){zh='包馅面食';en='Stuffed pasta';}
else if(code.startsWith('1902.30.1')){zh='低蛋白或无蛋白制面食';en='Prepared low-protein or protein-free pasta';q('不含肉，加拿大卫生部认证','without meat; Health Canada certified');}
else if(code.startsWith('1902.30.3')||code.startsWith('1902.30.4')){zh='其他不含肉制面食';en='Other prepared pasta without meat';}
else if(code.startsWith('1902.30.5')){zh='含肉制面食';en='Prepared pasta with meat';}
else if(code.startsWith('1902.40')){zh='库斯库斯面粒';en='Couscous';}
else if(code==='1903.00.00.00'){zh='木薯淀粉食品及代用品';en='Tapioca and starch substitutes';q('片状、粒状或珠状等','flakes, grains, pearls or similar forms');}
else if(code.startsWith('1904.10')){zh='膨化或焙炒谷物食品';en='Swelled or roasted cereal foods';}
else if(code.startsWith('1904.20')){zh='未焙炒谷物片及混合食品';en='Unroasted cereal-flake foods and mixtures';}
else if(code.startsWith('1904.30')){zh='布格碎小麦';en='Bulgur wheat';}
else if(code.startsWith('1904.90')){zh='其他预熟或加工谷物食品';en='Other pre-cooked or prepared cereal foods';}
else throw Error(`Unreviewed category ${code}`);
if(/25% or more by weight of wheat/i.test(d))q('小麦≥25%','wheat at least 25%');
if(/ - Of barley/i.test(d))q('大麦制','of barley');
if(/Containing cane and\/or beet sugar/i.test(d))q('含甘蔗糖或甜菜糖','with cane or beet sugar');
if(/Breakfast cereals/i.test(d))q('早餐谷物','breakfast cereals');
if(/Musli/i.test(d))q('什锦早餐麦片','muesli-type breakfast cereal');
if(/Rice preparations/i.test(d))q('稻米制','rice preparations');
if(/ - Dried$/.test(d))q('干制','dried');
if(/ - In airtight containers$/.test(d))q('密封容器装','airtight containers');
else if(/^1902\.(20|30\.(31|40|50))/.test(code)&&code.endsWith('.90'))q('非密封容器装','other than airtight containers');
const weights=[...d.matchAll(/not exceeding ([\d.]+) (kg|g) each/g)];
if(weights.length){const m=weights.at(-1);q(`每包≤${m[1]}${m[2]==='kg'?'公斤':'克'}`,`packages at most ${m[1]} ${m[2]}`);}
if(/In bulk or in packages of a weight exceeding 11.34 kg/i.test(d))q('散装或每包＞11.34公斤','bulk or packages over 11.34 kg');
if(/^(1902\.11\.29|1902\.19\.23|1902\.19\.93|1902\.30\.39)/.test(code))q('其他包装','other packaging');
if(/^1904\.(20|30|90)\.29/.test(code)||code==='1904.20.49.00')q('其他规格','other specifications');
if(/within access commitment/i.test(d))q('配额内','within access commitment');
if(/over access commitment/i.test(d))q('配额外','over access commitment');
if(z.length){zh+=`（${z.join('，')}）`;en+=` (${e.join('; ')})`;}
additions.push({code,zh,en});
}
assert.equal(additions.length,82);
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
