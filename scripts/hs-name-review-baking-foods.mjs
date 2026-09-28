import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const exact={
'1901.10.10.00':['婴幼儿谷粉淀粉或麦芽食品','Infant cereal, starch or malt foods'],
'1901.10.20.10':['婴幼儿乳制食品','Infant milk-based foods'],
'1901.10.20.20':['婴幼儿乳制食品','Infant milk-based foods'],
'1901.10.90.10':['婴幼儿麦芽精','Infant malt extract'],
'1901.10.90.90':['其他婴幼儿食品','Other infant food preparations'],
'1901.90.11.00':['麦芽精','Malt extract'],
'1901.90.12.00':['麦芽精','Malt extract'],
'1901.90.20.20':['麦芽乳粉预拌料','Powdered malted milk mixes'],
'1901.90.20.30':['其他谷粉淀粉或麦芽冲饮粉','Other powdered cereal, starch or malt drink preparations'],
'1901.90.20.90':['其他谷粉淀粉或麦芽食品','Other cereal, starch or malt food preparations'],
'1905.20.00.00':['姜饼及类似糕点','Gingerbread and similar products'],
'1905.90.10.00':['特殊膳食或低蛋白饼干','Special dietary or low-protein biscuits'],
'1905.90.20.00':['酵母面包及圣餐无酵饼','Yeast-leavened bread and sacramental unleavened bread or wafers'],
'1905.90.49.10':['苏打饼干','Soda biscuits'],
'1905.90.49.90':['其他非甜饼干','Other non-sweet biscuits'],
'1905.90.51.00':['披萨及法式咸派','Pizza and quiche'],
'1905.90.59.10':['烘焙布丁','Bakery puddings'],
'1905.90.59.91':['馅饼蛋糕及糕点（非冷冻）','Pies, cakes and pastry (not frozen)'],
'1905.90.59.98':['其他糕点及烘焙食品（冷冻）','Other pastries and bakery products (frozen)'],
'1905.90.59.99':['其他糕点及烘焙食品','Other pastries and bakery products'],
'1905.90.71.10':['奶酪味干面包棒','Cheese-flavoured dried bread sticks'],
'1905.90.71.90':['药用空心饼囊、封缄薄饼及米纸','Empty pharmaceutical cachets, sealing wafers and rice paper'],
'1905.90.72.00':['药用饼囊米纸等及奶酪味干面包棒','Pharmaceutical cachets, wafers, rice paper and cheese-flavoured dried bread sticks'],
'1905.90.90.10':['玉米脆片及类似脆食','Corn chips and similar crisp snacks'],
'1905.90.90.90':['其他烘焙食品及类似制品','Other bakers wares and similar products']
};
const additions=[];
for(const row of rows.filter(r=>/^190[15]/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh))){
const code=row.hs_code,d=sources[code]?.description;assert.ok(d,code);
// Use only the classification below the heading; the heading mentions other products too.
const t=d.split(' - ').slice(1).join(' - ');let pair=exact[code];
if(!pair&&code.startsWith('1901.20')){
 if(/ - Doughs$/.test(t))pair=['烘焙面团','Baking dough'];
 else if(/ - Cereal cake mixes$/.test(t))pair=['谷物蛋糕预拌粉','Cereal cake mixes'];
 else if(/ - Cake$/.test(t))pair=['蛋糕预拌粉','Cake mixes'];
 else if(/ - Mixes$| - Mixes: - Other$/.test(t))pair=['其他烘焙预拌料','Other baking mixes'];
 else pair=['烘焙预拌料及面团','Baking mixes and doughs'];
}
if(!pair&&code.startsWith('1901.90')){
 if(/Ice cream mixes or ice milk mixes/.test(t))pair=['冰淇淋或冰乳预拌料','Ice cream or ice milk mixes'];
 else if(/Prepared puddings/.test(t))pair=['乳制布丁','Prepared milk-based puddings'];
 else pair=['其他乳制食品','Other milk-based food preparations'];
}
if(!pair&&code.startsWith('1905.10'))pair=['脆面包','Crispbread'];
if(!pair&&code.startsWith('1905.31'))pair=['甜饼干','Sweet biscuits'];
if(!pair&&code.startsWith('1905.32'))pair=code==='1905.32.92.00'?['威化饼及冷冻华夫饼','Wafers and frozen waffles']:['华夫饼及威化饼','Waffles and wafers'];
if(!pair&&code.startsWith('1905.40'))pair=['面包干及烤面包类','Rusks, toasted bread and similar products'];
if(!pair&&code.startsWith('1905.90.3'))pair=['其他面包','Other bread'];
if(!pair&&code.startsWith('1905.90.4'))pair=['其他非甜饼干','Other non-sweet biscuits'];
if(!pair&&code.startsWith('1905.90.6'))pair=['椒盐扭结饼','Pretzels'];
assert.ok(pair,code);let[zh,en]=pair;const z=[],e=[];const q=(a,b)=>{z.push(a);e.push(b);};
if(code.startsWith('1901.10'))q('零售装','retail');
if(/more than 10% on a dry weight basis/.test(t))q('干基乳固体＞10%','dry-basis milk solids over 10%');
if(/more than 10% but less than 50%/.test(t))q('干基乳固体＞10%且＜50%','dry-basis milk solids over 10% and under 50%');
if(/10% or less on a dry weight basis/.test(t))q('干基乳固体≤10%','dry-basis milk solids at most 10%');
if(/50% or more on a dry weight basis/.test(t))q('干基乳固体≥50%','dry-basis milk solids at least 50%');
if(/not certified organic/i.test(t))q('未获有机认证','not certified organic');else if(/certified organic/i.test(t))q('已获有机认证','certified organic');
if(/not put up for retail sale/.test(t))q('非零售装','non-retail');
if(/more than 25% by weight of butterfat/.test(t))q('乳脂＞25%','butterfat over 25%');
if(/25% or more by weight of wheat/.test(t))q('小麦≥25%','wheat at least 25%');
if(/not leavened with yeast/i.test(t))q('非酵母发酵','not yeast-leavened');else if(/leavened with yeast/i.test(t)&&!exact[code])q('酵母发酵','yeast-leavened');
if(/44¢\/kg or more/.test(t))q('单价≥44加分/公斤','value at least CAD 0.44/kg');
if(/Health Canada/.test(t)){
 if(code==='1905.31.10.00'||code==='1905.32.10.00')q('低蛋白或无蛋白，加拿大卫生部认证','low-protein or protein-free; Health Canada certified');
 else q(/low protein/i.test(t)?'符合加拿大卫生部特殊膳食或低蛋白规定':'符合加拿大卫生部特殊膳食规定',/low protein/i.test(t)?'Health Canada special dietary or low-protein provisions':'Health Canada special dietary provisions');
}
if(code.startsWith('1901.20.14'))q('每包≤454克或特定冷冻烘焙料≤900克','packages at most 454 g or specified frozen bread/pizza mixes or doughs at most 900 g');
else if(code==='1905.90.32.00')q('鲜面包每包≤1.36公斤或其他面包≤454克','fresh bread packages at most 1.36 kg or other bread at most 454 g');
else {const weights=[...t.matchAll(/not exceeding ([\d.]+) (kg|g) each/g)];if(weights.length){const m=weights.at(-1);q(`每包≤${m[1]}${m[2]==='kg'?'公斤':'克'}`,`packages at most ${m[1]} ${m[2]}`);}}
if(/in bulk or in packages of a weight exceeding 11.34 kg/i.test(t))q('散装或每包＞11.34公斤','bulk or packages over 11.34 kg');
if(code==='1905.90.63.00')q('每包＞1.36公斤','packages over 1.36 kg');
if(/within access commitment/i.test(t))q('配额内','within access commitment');
if(/over access commitment/i.test(t))q('配额外','over access commitment');
if(z.length){zh+=`（${z.join('，')}）`;en+=` (${e.join('; ')})`;}
additions.push({code,zh,en});
}
assert.equal(additions.length,115);
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
