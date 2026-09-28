import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const additions=[];
function add(code,zh,en){
 const d=sources[code]?.description;assert.ok(d,code);
 if(/not certified organic/i.test(d)){zh+='（未获有机认证）';en+=' (not certified organic)';}
 else if(/certified organic/i.test(d)){zh+='（已获有机认证）';en+=' (certified organic)';}
 if(/Imported during such period/i.test(d)){zh+='（规定进口期间）';en+=' (specified import period)';}
 additions.push({code,zh,en});
}
for(const[prefix,zh,en]of[['0801.2','巴西坚果','Brazil nuts'],['0801.3','腰果','Cashew nuts'],['0802.1','扁桃仁（巴旦木）','Almonds'],['0802.2','榛子','Hazelnuts'],['0802.3','核桃','Walnuts'],['0802.4','栗子','Chestnuts'],['0802.5','开心果','Pistachios'],['0802.6','夏威夷果','Macadamia nuts']]){
 for(const[sub,zs,es]of[['1','带壳','in shell'],['2','去壳','shelled']])add(`${prefix}${sub}.00.00`,`${zh}（鲜或干，${zs}）`,`${en} (fresh or dried; ${es})`);
}
const table=`
0801.11.00.00|椰子（脱水干制）|Desiccated coconuts
0801.12.00.00|椰子（鲜或干，带内果壳）|Coconuts (fresh or dried; in the inner shell)
0801.19.00.00|椰子（鲜或干，其他）|Other coconuts (fresh or dried)
0802.70.00.00|可乐果（鲜或干）|Kola nuts (fresh or dried)
0802.80.00.00|槟榔（鲜或干）|Areca nuts (fresh or dried)
0802.91.00.00|松子（鲜或干，带壳）|Pine nuts (fresh or dried; in shell)
0802.92.00.00|松子（鲜或干，去壳）|Pine nuts (fresh or dried; shelled)
0802.99.00.11|碧根果（鲜或干，带壳）|Pecans (fresh or dried; in shell)
0802.99.00.12|碧根果（鲜或干，去壳）|Pecans (fresh or dried; shelled)
0803.10.00.00|大蕉（鲜或干）|Plantains (fresh or dried)
0803.90.00.10|香蕉（鲜）|Bananas (fresh)
0803.90.00.90|香蕉（鲜或干，其他）|Other bananas (fresh or dried)
0804.10.00.10|椰枣（鲜）|Dates (fresh)
0804.10.00.20|椰枣（干制）|Dates (dried)
0804.20.00.10|无花果（鲜）|Figs (fresh)
0804.20.00.20|无花果（干制）|Figs (dried)
0804.30.00.11|菠萝（鲜）|Pineapples (fresh)
0804.30.00.12|菠萝（鲜）|Pineapples (fresh)
0804.30.00.20|菠萝（干制）|Pineapples (dried)
0804.40.00.00|牛油果（鲜或干）|Avocados (fresh or dried)
0804.50.00.10|番石榴、芒果及山竹（鲜）|Guavas, mangoes and mangosteens (fresh)
0804.50.00.20|番石榴、芒果及山竹（干制）|Guavas, mangoes and mangosteens (dried)
0805.10.00.10|橙（鲜）|Oranges (fresh)
0805.10.00.90|橙（鲜或干，其他）|Other oranges (fresh or dried)
0805.21.00.00|橘及柑（鲜或干，含宽皮橘及温州蜜柑）|Mandarins including tangerines and satsumas (fresh or dried)
0805.22.00.00|克莱门氏小柑橘（鲜或干）|Clementines (fresh or dried)
0805.29.00.00|其他类似杂交柑橘（鲜或干）|Other similar citrus hybrids (fresh or dried)
0805.40.00.10|葡萄柚及柚子（鲜或干）|Grapefruit and pomelos (fresh or dried)
0805.40.00.20|葡萄柚及柚子（鲜或干）|Grapefruit and pomelos (fresh or dried)
0805.50.00.11|柠檬（鲜）|Lemons (fresh)
0805.50.00.12|青柠（鲜）|Limes (fresh)
0805.50.00.21|柠檬（鲜）|Lemons (fresh)
0805.50.00.22|青柠（鲜）|Limes (fresh)
0805.50.00.30|柠檬及青柠（干制）|Lemons and limes (dried)
0805.90.00.10|其他柑橘类水果（鲜）|Other citrus fruit (fresh)
0805.90.00.20|其他柑橘类水果（干制）|Other citrus fruit (dried)
0806.10.11.00|美洲葡萄（鲜，天然状态）|Vitis labrusca grapes (fresh; in their natural state)
0806.10.19.00|美洲葡萄（鲜，天然状态，其他进口条件）|Vitis labrusca grapes (fresh; natural state; other import conditions)
0806.10.91.10|其他葡萄（鲜，天然状态）|Other grapes (fresh; in their natural state)
0806.10.91.20|其他葡萄（鲜，天然状态）|Other grapes (fresh; in their natural state)
0806.10.99.00|其他葡萄（鲜，其他形态）|Other grapes (fresh; other forms)
0806.20.00.00|葡萄干|Dried grapes (raisins)
0807.11.00.10|西瓜（鲜）|Watermelons (fresh)
0807.11.00.20|西瓜（鲜）|Watermelons (fresh)
0807.19.00.10|网纹甜瓜（鲜）|Cantaloupes (fresh)
0807.19.00.90|其他甜瓜（鲜）|Other melons (fresh)
0807.20.00.10|番木瓜（鲜）|Papayas (fresh)
0807.20.00.20|番木瓜（鲜）|Papayas (fresh)
0808.10.90.00|苹果（鲜，其他形态）|Apples (fresh; other forms)
0808.30.10.00|梨（鲜，加工用）|Pears (fresh; for processing)
0808.30.91.00|其他梨（鲜）|Other pears (fresh)
0808.30.99.10|其他梨（鲜，其他进口条件）|Other pears (fresh; other import conditions)
0808.30.99.20|其他梨（鲜，其他进口条件）|Other pears (fresh; other import conditions)
0808.40.00.00|榅桲（鲜）|Quinces (fresh)
0809.10.10.00|杏（鲜，加工用）|Apricots (fresh; for processing)
0809.10.91.00|其他杏（鲜）|Other apricots (fresh)
0809.10.99.00|其他杏（鲜，其他进口条件）|Other apricots (fresh; other import conditions)
0809.21.11.00|酸樱桃（鲜，天然状态）|Sour cherries (fresh; natural state)
0809.21.19.00|酸樱桃（鲜，天然状态，其他进口条件）|Sour cherries (fresh; natural state; other import conditions)
0809.21.90.00|酸樱桃（鲜，其他形态）|Sour cherries (fresh; other forms)
0809.29.10.00|甜樱桃（鲜，加工用）|Sweet cherries (fresh; for processing)
0809.29.21.00|其他樱桃（鲜，天然状态）|Other cherries (fresh; natural state)
0809.29.29.10|其他樱桃（鲜，天然状态，其他进口条件）|Other cherries (fresh; natural state; other import conditions)
0809.29.29.20|其他樱桃（鲜，天然状态，其他进口条件）|Other cherries (fresh; natural state; other import conditions)
0809.29.90.00|其他樱桃（鲜，其他形态）|Other cherries (fresh; other forms)
0809.30.10.00|桃（鲜，不含油桃，加工用）|Peaches excluding nectarines (fresh; for processing)
0809.30.21.00|其他桃（鲜，不含油桃，天然状态）|Other peaches excluding nectarines (fresh; natural state)
0809.30.29.10|其他桃（鲜，不含油桃，天然状态，其他进口条件）|Other peaches excluding nectarines (fresh; natural state; other import conditions)
0809.30.29.20|其他桃（鲜，不含油桃，天然状态，其他进口条件）|Other peaches excluding nectarines (fresh; natural state; other import conditions)
0809.30.30.00|油桃（鲜，天然状态）|Nectarines (fresh; natural state)
0809.30.90.00|桃及油桃（鲜，其他形态）|Peaches and nectarines (fresh; other forms)
0809.40.10.00|西梅（鲜，加工用）|Prune plums (fresh; for processing)
0809.40.21.00|其他西梅（鲜，天然状态）|Other prune plums (fresh; natural state)
0809.40.29.00|其他西梅（鲜，天然状态，其他进口条件）|Other prune plums (fresh; natural state; other import conditions)
0809.40.31.00|其他李子及黑刺李（鲜，天然状态）|Plums other than prune plums and sloes (fresh; natural state)
0809.40.39.00|其他李子及黑刺李（鲜，天然状态，其他进口条件）|Plums other than prune plums and sloes (fresh; natural state; other import conditions)
0809.40.90.00|李子及黑刺李（鲜，其他形态）|Plums and sloes (fresh; other forms)
0810.10.10.00|草莓（鲜，加工用）|Strawberries (fresh; for processing)
0810.10.91.00|其他草莓（鲜）|Other strawberries (fresh)
0810.10.99.10|其他草莓（鲜，其他进口条件）|Other strawberries (fresh; other import conditions)
0810.10.99.20|其他草莓（鲜，其他进口条件）|Other strawberries (fresh; other import conditions)
0810.20.00.11|覆盆子及罗甘莓（鲜）|Raspberries and loganberries (fresh)
0810.20.00.12|覆盆子及罗甘莓（鲜）|Raspberries and loganberries (fresh)
0810.20.00.90|黑莓及桑葚（鲜）|Blackberries and mulberries (fresh)
0810.30.00.00|黑白红醋栗及鹅莓（鲜）|Black, white or red currants and gooseberries (fresh)
0810.40.00.11|蔓越莓（鲜）|Cranberries (fresh)
0810.40.00.12|蔓越莓（鲜）|Cranberries (fresh)
0810.40.00.21|蓝莓（鲜，野生）|Blueberries (fresh; wild)
0810.40.00.22|蓝莓（鲜，栽培）|Blueberries (fresh; cultivated)
0810.40.00.23|蓝莓（鲜，栽培）|Blueberries (fresh; cultivated)
0810.40.00.90|其他越橘属果实（鲜）|Other Vaccinium fruit (fresh)
0810.50.00.00|猕猴桃（鲜）|Kiwifruit (fresh)
0810.60.00.00|榴莲（鲜）|Durians (fresh)
0810.70.00.00|柿子（鲜）|Persimmons (fresh)
0810.90.00.00|其他鲜水果|Other fresh fruit
0811.10.10.00|草莓（冷冻，加工用）|Strawberries (frozen; for processing)
0811.10.90.00|草莓（冷冻，其他用途）|Strawberries (frozen; other uses)
0811.20.00.10|覆盆子（冷冻）|Raspberries (frozen)
0811.20.00.90|黑莓、桑葚、罗甘莓及醋栗鹅莓（冷冻）|Blackberries, mulberries, loganberries, currants and gooseberries (frozen)
0811.90.10.10|甜樱桃（冷冻）|Sweet cherries (frozen)
0811.90.10.90|其他樱桃（冷冻）|Other cherries (frozen)
0811.90.20.00|桃（冷冻）|Peaches (frozen)
0811.90.90.14|蓝莓（冷冻，野生）|Blueberries (frozen; wild)
0811.90.90.15|蓝莓（冷冻，栽培）|Blueberries (frozen; cultivated)
0811.90.90.21|蔓越莓果肉（冷冻）|Cranberry pulp (frozen)
0811.90.90.29|蔓越莓（冷冻，其他形态）|Cranberries (frozen; other forms)
0811.90.90.30|坚果（冷冻）|Nuts (frozen)
0811.90.90.91|其他水果果肉（冷冻）|Other fruit pulp (frozen)
0811.90.90.99|其他水果及坚果（冷冻，其他形态）|Other fruit and nuts (frozen; other forms)
0812.10.00.00|樱桃（暂时保藏，不宜直接食用）|Cherries (provisionally preserved; unsuitable for immediate consumption)
0812.90.00.00|其他水果及坚果（暂时保藏，不宜直接食用）|Other fruit and nuts (provisionally preserved; unsuitable for immediate consumption)
0813.10.00.00|杏干|Dried apricots
0813.20.00.00|西梅干|Prunes
0813.30.00.00|苹果干|Dried apples
0813.40.00.10|野生蓝莓干|Dried wild blueberries
0813.40.00.90|其他干制水果|Other dried fruit
0813.50.00.00|坚果或干果混合物|Mixtures of nuts or dried fruit
0814.00.00.00|柑橘及瓜类果皮（鲜、冷冻、干制或暂时保藏）|Citrus or melon peel (fresh, frozen, dried or provisionally preserved)
`;
for(const line of table.trim().split('\n'))add(...line.split('|'));
const apples={Empire:'帝国', 'Golden Delicious':'金冠', 'Granny Smith':'澳洲青苹', 'Ida Red':'艾达红',McIntosh:'麦金托什','Red Delicious':'红元帅',Gala:'嘎啦',Honeycrisp:'蜜脆',Other:'其他品种'};
for(const row of rows.filter(r=>r.hs_code.startsWith('0808.10.10.')&&!/[\u3400-\u9fff]/.test(r.name_zh))){
 const d=sources[row.hs_code].description,leaf=d.split(' - ').at(-1);assert.ok(apples[leaf],leaf);
 const processing=d.includes('For processing'),organic=d.includes('Certified organic');
 add(row.hs_code,`苹果（鲜，天然状态，${apples[leaf]}，${processing?'加工用':organic?'非加工用':'其他用途及认证状态'}）`,`${leaf==='Other'?'Other varieties of':leaf} apples (fresh; natural state; ${processing?'for processing':organic?'not for processing':'other uses and certification status'})`);
}
assert.equal(additions.length,155);
assert.equal(new Set(additions.map(x=>x.code)).size,155);
for(const entry of additions){
 assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);
 const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);
}
const held=rows.filter(r=>r.hs_code.startsWith('08')&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!reviewed.some(x=>x.code===r.hs_code)).map(r=>r.hs_code);
assert.deepEqual(held,['0802.99.00.90','0807.19.00.20']);
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}; held for source/term review: ${held.length}`);
