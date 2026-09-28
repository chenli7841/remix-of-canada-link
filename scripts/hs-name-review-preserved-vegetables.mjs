import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
0710.10.00.00|马铃薯|Potatoes
0710.21.00.00|豌豆|Peas
0710.22.00.10|菜豆（青荚或黄荚）|Snap beans (green or yellow wax)
0710.22.00.20|利马豆|Lima beans
0710.22.00.90|其他菜豆及豇豆属豆类|Other beans (Vigna spp. and Phaseolus spp.)
0710.29.00.00|其他豆类蔬菜|Other leguminous vegetables
0710.30.00.00|菠菜、番杏及庭园滨藜|Spinach, New Zealand spinach and orache spinach
0710.40.00.00|甜玉米|Sweet corn
0710.80.00.10|蘑菇|Mushrooms
0710.80.00.20|胡萝卜|Carrots
0710.80.00.30|抱子甘蓝|Brussels sprouts
0710.80.00.90|其他蔬菜|Other vegetables
0710.90.00.00|混合蔬菜|Mixtures of vegetables
0711.20.00.00|橄榄|Olives
0711.40.10.00|小黄瓜（直径≤19毫米，加工成品用）|Gherkins (maximum diameter 19 mm; for manufacture of finished gherkins)
0711.40.90.00|其他黄瓜及小黄瓜|Other cucumbers and gherkins
0711.51.00.00|蘑菇（伞菌属）|Mushrooms (Agaricus spp.)
0711.59.00.00|其他蘑菇及松露|Other mushrooms and truffles
0711.90.00.00|其他蔬菜及混合蔬菜|Other vegetables and mixtures
0712.20.00.00|洋葱|Onions
0712.31.00.00|蘑菇（伞菌属）|Mushrooms (Agaricus spp.)
0712.32.10.00|木耳（制造食品用）|Wood ears (for manufacture of food products)
0712.32.90.00|木耳（其他用途）|Wood ears (other uses)
0712.33.00.00|银耳属菌类|Jelly fungi (Tremella spp.)
0712.34.10.00|香菇（制造食品用）|Shiitake (for manufacture of food products)
0712.34.90.00|香菇（其他用途）|Shiitake (other uses)
0712.39.11.00|美味牛肝菌（制造食品用）|Porcini (Boletus edulis; for manufacture of food products)
0712.39.19.00|其他蘑菇|Other mushrooms
0712.39.20.00|松露|Truffles
0712.90.00.10|脱水蔬菜（含大蒜，不含马铃薯粉）|Dehydrated vegetables (including garlic; excluding potato powder)
0712.90.00.20|甜玉米种子|Sweet corn seed
0712.90.00.30|马铃薯|Potatoes
0712.90.00.90|其他蔬菜及混合蔬菜|Other vegetables and mixtures
0713.10.10.00|豌豆种（每包≤500克）|Pea seed (packages not exceeding 500 g)
0713.10.90.10|豌豆种（其他播种用）|Peas (other seed for sowing)
0713.10.90.20|豌豆（分瓣）|Split peas
0713.10.90.30|豌豆（饲料用）|Feed peas
0713.10.90.40|青豌豆（其他）|Green peas (other)
0713.10.90.50|黄豌豆（其他）|Yellow peas (other)
0713.10.90.90|豌豆（其他）|Other peas
0713.20.00.10|鹰嘴豆（播种用）|Chickpeas (seed for sowing)
0713.20.00.20|鹰嘴豆（分瓣）|Split chickpeas
0713.20.00.91|鹰嘴豆（德西型，其他）|Chickpeas (Desi varieties; other)
0713.20.00.92|鹰嘴豆（卡布里型，其他）|Chickpeas (Kabuli varieties; other)
0713.31.10.10|绿豆（播种用，散装或每包＞500克）|Mung beans (seed for sowing; bulk or packages over 500 g)
0713.31.10.90|绿豆（其他，散装或每包＞500克）|Mung beans (other; bulk or packages over 500 g)
0713.31.90.00|黑吉豆及绿豆（其他）|Black gram and mung beans (other)
0713.32.00.00|赤小豆|Adzuki beans
0713.33.00.11|白小芸豆（播种用）|Navy or white pea beans (seed for sowing)
0713.33.00.19|其他菜豆（播种用）|Other kidney beans (seed for sowing)
0713.33.00.20|深红芸豆|Dark red kidney beans
0713.33.00.30|浅红芸豆|Light red kidney beans
0713.33.00.40|白小芸豆（其他用途）|Navy or white pea beans (other uses)
0713.33.00.90|其他菜豆|Other kidney beans
0713.34.00.00|班巴拉豆|Bambara beans
0713.35.00.00|豇豆|Cow peas
0713.39.00.10|其他菜豆及豇豆属豆类（播种用）|Other Vigna or Phaseolus beans (seed for sowing)
0713.39.00.90|其他菜豆及豇豆属豆类（其他用途）|Other Vigna or Phaseolus beans (other uses)
0713.40.00.10|小扁豆（播种用）|Lentils (seed for sowing)
0713.40.00.20|小扁豆（分瓣）|Split lentils
0713.40.00.30|绿小扁豆（其他）|Green lentils (other)
0713.40.00.90|小扁豆（其他）|Other lentils
0713.50.00.00|蚕豆及马豆|Broad beans and horse beans
0713.60.00.00|木豆|Pigeon peas
0713.90.00.00|其他豆类蔬菜|Other leguminous vegetables
0714.10.00.00|木薯|Manioc (cassava)
0714.20.00.00|甘薯|Sweet potatoes
0714.30.00.00|薯蓣（薯蓣属）|Yams (Dioscorea spp.)
0714.40.00.00|芋头（芋属）|Taro (Colocasia spp.)
0714.50.00.00|黄肉芋（黄肉芋属）|Yautia (Xanthosoma spp.)
0714.90.00.11|竹芋（鲜）|Arrowroot (fresh)
0714.90.00.19|其他淀粉或菊粉根茎及西谷椰子髓（鲜）|Other starch- or inulin-rich roots and tubers and sago pith (fresh)
0714.90.00.21|竹芋（干制）|Arrowroot (dried)
0714.90.00.29|其他淀粉或菊粉根茎及西谷椰子髓（干制）|Other starch- or inulin-rich roots and tubers and sago pith (dried)
0714.90.00.90|其他淀粉或菊粉根茎及西谷椰子髓（其他状态）|Other starch- or inulin-rich roots and tubers and sago pith (other states)
`;
const additions=[];
for(const line of table.trim().split('\n')){
 let[code,zh,en]=line.split('|');const source=sources[code];assert.ok(source,code);
 let detail;
 if(code.startsWith('0710')){zh+='（冷冻）';en+=' (frozen)';detail='未烹煮或仅以蒸汽或水煮烹煮的冷冻蔬菜。';}
 if(code.startsWith('0711')){zh+='（暂时保藏，不宜直接食用）';en+=' (provisionally preserved; unsuitable for immediate consumption)';}
 if(code.startsWith('0712')){zh+='（干制，未进一步加工）';en+=' (dried; not further prepared)';}
 if(code.startsWith('0713')){zh+='（干制，去荚）';en+=' (dried; shelled)';detail='可去皮或分瓣；若名称已限定播种、饲料或分瓣用途，应按具体分类识别。';}
 if(code.startsWith('0714')&&!code.startsWith('0714.90')){zh+='（鲜、冷藏、冷冻或干制）';en+=' (fresh, chilled, frozen or dried)';}
 additions.push({code,zh,en,...(detail?{detail}:{})});
}
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){
 assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);
 const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);
}
assert.equal(rows.filter(r=>/^071/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!reviewed.some(x=>x.code===r.hs_code)).length,0);
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
