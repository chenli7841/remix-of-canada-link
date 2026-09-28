import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const additions=[];
function add(code,zh,en){const d=sources[code]?.description;assert.ok(d,code);if(/Within access commitment/i.test(d)){zh+='（配额内）';en+=' (within access commitment)';}else if(/Over access commitment/i.test(d)){zh+='（配额外）';en+=' (over access commitment)';}additions.push({code,zh,en});}
const table=`
1101.00.10.00|小麦或混合麦细粉|Wheat or meslin flour
1101.00.20.00|小麦或混合麦细粉|Wheat or meslin flour
1102.90.11.00|大麦细粉|Barley flour
1102.90.12.00|大麦细粉|Barley flour
1102.90.20.00|稻米细粉|Rice flour
1102.90.30.00|黑麦细粉|Rye flour
1102.90.90.00|其他谷物细粉（非小麦或混合麦）|Other cereal flour (excluding wheat or meslin)
1103.11.10.00|小麦粗粒及粗粉|Wheat groats and meal
1103.11.20.00|小麦粗粒及粗粉|Wheat groats and meal
1103.13.00.10|玉米粗粉|Cornmeal
1103.13.00.90|其他玉米粗粒及粗粉|Other maize groats and meal
1103.19.11.00|大麦粗粒及粗粉|Barley groats and meal
1103.19.12.00|大麦粗粒及粗粉|Barley groats and meal
1103.19.90.20|燕麦粗粒及粗粉|Oat groats and meal
1103.19.90.90|其他谷物粗粒及粗粉|Other cereal groats and meal
1103.20.11.00|小麦团粒|Wheat pellets
1103.20.12.00|小麦团粒|Wheat pellets
1103.20.21.00|大麦团粒|Barley pellets
1103.20.22.00|大麦团粒|Barley pellets
1103.20.90.00|其他谷物团粒|Other cereal pellets
1104.12.00.00|燕麦（滚压或制片）|Oats (rolled or flaked)
1104.22.00.00|燕麦（其他加工谷粒）|Oats (other worked grains)
1104.23.00.00|玉米（其他加工谷粒）|Maize (other worked grains)
1104.30.11.00|小麦胚芽（完整、压片或磨粉）|Wheat germ (whole, rolled, flaked or ground)
1104.30.12.00|小麦胚芽（完整、压片或磨粉）|Wheat germ (whole, rolled, flaked or ground)
1104.30.90.00|其他谷物胚芽（完整、压片或磨粉）|Other cereal germ (whole, rolled, flaked or ground)
1105.10.00.00|马铃薯细粉、粗粉及粉末|Potato flour, meal and powder
1105.20.00.00|马铃薯片、颗粒及团粒|Potato flakes, granules and pellets
1106.10.00.00|干豆类细粉、粗粉及粉末|Flour, meal and powder of dried leguminous vegetables
1106.20.00.00|西谷及指定根茎细粉、粗粉及粉末|Flour, meal and powder of sago and roots or tubers of heading 07.14
1106.30.00.00|水果及坚果细粉、粗粉及粉末|Flour, meal and powder of Chapter 8 fruit and nuts
1108.11.10.00|小麦淀粉|Wheat starch
1108.11.20.00|小麦淀粉|Wheat starch
1108.12.00.10|玉米淀粉（食品用）|Maize starch (for food use)
1108.12.00.20|玉米淀粉（工业用，非食品）|Maize starch (industrial, non-food use)
1108.13.00.10|马铃薯淀粉（食品用）|Potato starch (for food use)
1108.13.00.20|马铃薯淀粉（工业用，非食品）|Potato starch (industrial, non-food use)
1108.14.00.00|木薯淀粉|Manioc (cassava) starch
1108.19.11.00|大麦淀粉|Barley starch
1108.19.12.00|大麦淀粉|Barley starch
1108.19.90.00|其他淀粉|Other starches
1108.20.00.00|菊粉|Inulin
1109.00.10.00|小麦面筋（无论是否干燥）|Wheat gluten (whether or not dried)
1109.00.20.00|小麦面筋（无论是否干燥）|Wheat gluten (whether or not dried)
`;
for(const line of table.trim().split('\n'))add(...line.split('|'));
for(const[sub,zs,es]of[['19','滚压或制片','rolled or flaked'],['29','其他加工谷粒','other worked grains']]){
 for(const[tail,zh,en]of[['11','小麦','Wheat'],['12','小麦','Wheat'],['21','大麦','Barley'],['22','大麦','Barley'],['90','其他谷物','Other cereals']])add(`1104.${sub}.${tail}.00`,`${zh}（${zs}）`,`${en} (${es})`);
}
for(const[sub,zs,es]of[['10','未焙制','not roasted'],['20','已焙制','roasted']])for(const[tail,zf,ef]of[['11','整粒','whole'],['12','整粒','whole'],['91','其他形态','other forms'],['92','其他形态','other forms']])add(`1107.${sub}.${tail}.00`,`麦芽（${zs}，${zf}）`,`Malt (${es}; ${ef})`);
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
const missing=rows.filter(r=>r.hs_code.startsWith('11')&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!reviewed.some(x=>x.code===r.hs_code)).map(x=>x.hs_code);assert.deepEqual(missing,['1102.20.00.00']);
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}; missing source detail held: ${missing.length}`);
