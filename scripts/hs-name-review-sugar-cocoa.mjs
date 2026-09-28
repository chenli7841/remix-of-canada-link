import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
1701.12.10.00|甜菜原糖（精炼后制造葡萄酒用）|Raw beet sugar (for refining into sugar used to manufacture wine)
1701.12.90.00|其他甜菜原糖|Other raw beet sugar
1701.13.10.00|甘蔗原糖（章注规定品种，精炼制酒用）|Raw cane sugar (subheading note 2; for refining into sugar for wine)
1701.13.90.00|其他甘蔗原糖（章注规定品种）|Other raw cane sugar specified in subheading note 2
1701.14.00.00|其他甘蔗原糖|Other raw cane sugar
1701.91.10.00|调味或着色固体蔗糖（特定进口限额内）|Flavoured or coloured solid sucrose (specified import quota)
1701.91.90.21|柠檬水类冲饮糖粉（零售装）|Sugar powders for lemonade and similar drinks (retail)
1701.91.90.29|柠檬水类冲饮糖粉（非零售装）|Sugar powders for lemonade and similar drinks (non-retail)
1701.91.90.91|其他调味着色固体糖（零售装）|Other flavoured or coloured solid sugar (retail)
1701.91.90.99|其他调味着色固体糖（非零售装）|Other flavoured or coloured solid sugar (non-retail)
1701.99.10.00|其他固体蔗糖（特定进口限额内）|Other solid sucrose (specified import quota)
1701.99.90.20|颗粒砂糖（非方糖，零售装）|Granulated sugar (not cubed; retail)
1701.99.90.30|颗粒砂糖（非零售装）|Granulated sugar (non-retail)
1701.99.90.90|其他固体蔗糖|Other solid sucrose
1702.11.00.00|乳糖及乳糖浆（干基乳糖≥99%）|Lactose and lactose syrup (at least 99% lactose on dry basis)
1702.19.00.00|其他乳糖及乳糖浆|Other lactose and lactose syrup
1702.20.00.10|枫糖|Maple sugar
1702.20.00.20|枫糖浆|Maple syrup
1702.30.10.00|结晶葡萄糖（葡萄糖当量≥90%，水分≤10%）|Crystalline dextrose (dextrose equivalent at least 90%; moisture at most 10%)
1702.30.90.10|葡萄糖浆（非高果糖玉米糖浆）|Glucose syrup (other than high-fructose corn syrup)
1702.30.90.20|非化学纯葡萄糖|Glucose or dextrose (not chemically pure)
1702.30.90.90|其他葡萄糖及糖浆（干基果糖＜20%）|Other glucose and syrup (dry-basis fructose under 20%)
1702.40.00.00|葡萄糖及糖浆（干基果糖20%至不足50%，非转化糖）|Glucose and syrup (20% to under 50% dry-basis fructose; excluding invert sugar)
1702.50.00.00|化学纯果糖|Chemically pure fructose
1702.60.00.00|其他果糖及糖浆（干基果糖＞50%，非转化糖）|Other fructose and syrup (over 50% dry-basis fructose; excluding invert sugar)
1702.90.21.00|人造蜂蜜（特定进口限额内）|Artificial honey (specified import quota)
1702.90.29.00|其他人造蜂蜜|Other artificial honey
1702.90.40.00|化学纯麦芽糖|Chemically pure maltose
1702.90.50.00|着色焦糖|Colouring caramels
1702.90.61.00|其他蔗糖类糖（特定进口限额内）|Other sucrose sugars (specified import quota)
1702.90.69.00|其他蔗糖类糖|Other sucrose sugars
1702.90.70.00|转化糖及糖浆（毛重＞27公斤，特定进口限额内）|Invert sugar and sugar syrups (gross weight over 27 kg; specified import quota)
1702.90.81.00|其他转化糖及糖浆（特定进口限额内）|Other invert sugars and sugar syrups (specified import quota)
1702.90.89.10|其他甘蔗或甜菜转化糖及糖浆|Other cane or beet invert sugars and sugar syrups
1702.90.89.90|其他来源转化糖及糖浆|Other invert sugars and sugar syrups from other sources
1702.90.90.00|其他糖及糖浆混合物|Other sugars and sugar-syrup blends
1703.10.10.00|甘蔗糖蜜粉（含其他掺加物）|Cane molasses powder (with admixtures other than colouring or anti-caking agents)
1703.10.90.00|其他甘蔗糖蜜|Other cane molasses
1703.90.10.00|其他糖蜜粉（含其他掺加物）|Other molasses powder (with admixtures other than colouring or anti-caking agents)
1703.90.90.10|甜菜黑糖蜜|Sugar-beet blackstrap molasses
1703.90.90.90|其他非甘蔗糖蜜|Other non-cane molasses
1704.10.00.10|泡泡糖|Bubble gum
1704.10.00.90|其他口香糖|Other chewing gum
1704.90.10.00|栗子甜酱或栗蓉|Chestnut cream or paste
1704.90.20.00|甘草糖及太妃糖|Liquorice candy and toffee
1704.90.90.20|棉花软糖|Marshmallows
1704.90.90.50|其他糖果（不含可可）|Other sugar candy (not containing cocoa)
1704.90.90.60|杏仁甜膏及杏仁酱|Almond paste and butter confectionery
1704.90.90.90|其他糖食（不含可可）|Other sugar confectionery (not containing cocoa)
1801.00.00.00|可可豆（生或焙炒，整粒或碎粒）|Cocoa beans (raw or roasted; whole or broken)
1802.00.00.00|可可壳皮及其他废料|Cocoa shells, husks, skins and other waste
1803.10.00.00|可可膏（未脱脂）|Cocoa paste (not defatted)
1803.20.00.00|可可膏（全部或部分脱脂）|Cocoa paste (wholly or partly defatted)
1804.00.00.00|可可脂及可可油|Cocoa butter, fat and oil
1805.00.00.00|可可粉（未加糖或甜味料）|Cocoa powder (without added sugar or sweeteners)
1806.10.10.00|甜可可粉（含糖≥90%）|Sweetened cocoa powder (at least 90% sugar)
1806.10.90.00|其他甜可可粉|Other sweetened cocoa powder
1806.20.10.00|甜可可膏（＞2公斤，可加可可脂）|Sweetened cocoa paste (over 2 kg; optional added cocoa butter)
1806.20.21.00|巧克力冰淇淋或冰乳预拌料（＞2公斤）|Chocolate ice cream or ice milk mix (over 2 kg)
1806.20.22.00|巧克力冰淇淋或冰乳预拌料（＞2公斤）|Chocolate ice cream or ice milk mix (over 2 kg)
1806.20.90.10|巧克力碎料或粉（＞2公斤）|Chocolate crumb or powders (over 2 kg)
1806.20.90.90|其他含可可食品（＞2公斤）|Other cocoa food preparations (over 2 kg)
1806.31.00.00|夹心巧克力块条|Filled chocolate blocks, slabs or bars
1806.32.00.10|非夹心巧克力糖块条|Unfilled chocolate confectionery blocks, slabs or bars
1806.32.00.90|其他非夹心巧克力块条|Other unfilled chocolate blocks, slabs or bars
1806.90.11.00|巧克力冰淇淋或冰乳预拌料（其他包装）|Chocolate ice cream or ice milk mix (other packaging)
1806.90.12.00|巧克力冰淇淋或冰乳预拌料（其他包装）|Chocolate ice cream or ice milk mix (other packaging)
1806.90.90.11|巧克力（其他形式，零售装）|Chocolates (other forms; retail)
1806.90.90.12|巧克力裹坚果（零售装）|Chocolate-coated nuts (retail)
1806.90.90.13|其他含可可糖食（零售装）|Other cocoa confectionery (retail)
1806.90.90.19|其他含可可食品（零售装）|Other cocoa food preparations (retail)
1806.90.90.91|巧克力裹坚果（非零售装）|Chocolate-coated nuts (non-retail)
1806.90.90.92|其他含可可糖食（非零售装）|Other cocoa confectionery (non-retail)
1806.90.90.99|其他含可可食品（非零售装）|Other cocoa food preparations (non-retail)
`;
const additions=table.trim().split('\n').map(line=>{let[code,zh,en]=line.split('|');const d=sources[code]?.description;assert.ok(d,code);
if(/within access commitment/i.test(d)){zh+='（配额内）';en+=' (within access commitment)';}
if(/over access commitment/i.test(d)){zh+='（配额外）';en+=' (over access commitment)';}
return{code,zh,en};});
const bands=[['≤65%','at most 65%'],['＞65%且≤70%','over 65% to 70%'],['＞70%且≤71%','over 70% to 71%'],['＞71%且≤72%','over 71% to 72%'],['＞72%且≤73%','over 72% to 73%'],['＞73%且≤74%','over 73% to 74%'],['＞74%且≤75%','over 74% to 75%'],['＞75%','over 75%']];
for(let i=0;i<bands.length;i++){const [zh,en]=bands[i];additions.push({code:`1702.90.${11+i}.00`,zh:`转化糖及糖浆（毛重＞27公斤，还原糖占糖浆${zh}）`,en:`Invert sugar and sugar syrups (gross weight over 27 kg; reducing sugars ${en} of syrup)`,detail:'转化后还原糖占总固形物重量至少75%；名称中的百分比为转化后还原糖占整个糖浆的重量比例。'});}
assert.equal(additions.length,82);
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){assert.ok(sources[entry.code],entry.code);assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
assert.equal(rows.filter(r=>/^(17|18)/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!reviewed.some(x=>x.code===r.hs_code)).length,0);
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
