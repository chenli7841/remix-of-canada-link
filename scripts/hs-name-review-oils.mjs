import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
1501.10.00.00|猪油（熬制）|Lard
1501.20.00.00|其他猪脂|Other pig fat
1501.90.00.00|禽脂（非02.09或15.03项下）|Poultry fat (other than heading 02.09 or 15.03)
1502.10.00.10|牛羊脂（食用，熬制）|Tallow (edible)
1502.10.00.20|牛羊脂（非食用，熬制）|Tallow (inedible)
1502.90.00.00|其他牛羊脂|Other fats of bovine animals, sheep or goats
1503.00.00.00|猪牛脂分离油脂（未乳化、混合或配制）|Lard stearin, lard oil, oleostearin, oleo-oil and tallow oil (not emulsified, mixed or otherwise prepared)
1504.10.10.00|鱼肝油及分离品（制造药品用）|Fish-liver oils and fractions (for manufacture of medicaments)
1504.10.91.00|鱼肝油及分离品（其他，加拿大制造用）|Fish-liver oils and fractions (other; for use in Canadian manufactures)
1504.10.99.00|鱼肝油及分离品（其他用途）|Fish-liver oils and fractions (other uses)
1504.20.00.00|鱼油脂及分离品（非鱼肝油）|Fish fats and oils and fractions (other than liver oils)
1504.30.00.00|海洋哺乳动物油脂及分离品|Marine mammal fats and oils and fractions
1505.00.00.00|羊毛脂及其脂肪物质（含精制羊毛脂）|Wool grease and derived fatty substances (including lanolin)
1506.00.00.00|其他动物油脂及分离品|Other animal fats and oils and fractions
1507.10.00.00|大豆油（毛油，可脱胶）|Soya-bean oil (crude; whether or not degummed)
1507.90.00.00|其他大豆油及分离品|Other soya-bean oil and fractions
1508.10.00.00|花生油（毛油）|Groundnut oil (crude)
1508.90.00.00|其他花生油及分离品|Other groundnut oil and fractions
1509.20.00.11|特级初榨橄榄油（容器容量＜18公斤）|Extra virgin olive oil (container capacity under 18 kg)
1509.20.00.12|特级初榨橄榄油（容器容量＜18公斤）|Extra virgin olive oil (container capacity under 18 kg)
1509.20.00.20|特级初榨橄榄油（容器容量≥18公斤）|Extra virgin olive oil (container capacity at least 18 kg)
1509.30.00.11|初榨橄榄油（容器容量＜18公斤）|Virgin olive oil (container capacity under 18 kg)
1509.30.00.12|初榨橄榄油（容器容量＜18公斤）|Virgin olive oil (container capacity under 18 kg)
1509.30.00.20|初榨橄榄油（容器容量≥18公斤）|Virgin olive oil (container capacity at least 18 kg)
1509.40.00.00|其他初榨橄榄油|Other virgin olive oils
1509.90.00.10|其他橄榄油及分离品（容器容量＜18公斤）|Other olive oil and fractions (container capacity under 18 kg)
1509.90.00.20|其他橄榄油及分离品（容器容量≥18公斤）|Other olive oil and fractions (container capacity at least 18 kg)
1510.10.00.00|橄榄果渣油（毛油）|Crude olive pomace oil
1510.90.00.00|其他橄榄来源油及分离品、混合物|Other oils obtained solely from olives, fractions and blends
1511.10.00.00|棕榈油（毛油）|Crude palm oil
1511.90.00.00|其他棕榈油及分离品|Other palm oil and fractions
1512.11.00.00|葵花籽油或红花油（毛油）|Crude sunflower-seed or safflower oil
1512.19.11.00|其他葵花籽油及分离品（加工用）|Other sunflower-seed oil and fractions (for processing)
1512.19.19.00|其他葵花籽油及分离品（其他用途）|Other sunflower-seed oil and fractions (other uses)
1512.19.21.00|其他红花油及分离品（加工用）|Other safflower oil and fractions (for processing)
1512.19.29.00|其他红花油及分离品（其他用途）|Other safflower oil and fractions (other uses)
1512.21.00.00|棉籽油（毛油，可脱棉酚）|Crude cotton-seed oil (whether or not gossypol removed)
1512.29.00.00|其他棉籽油及分离品|Other cotton-seed oil and fractions
1513.11.00.00|椰子油（毛油）|Crude coconut oil
1513.19.10.00|其他椰子油及分离品（加工用）|Other coconut oil and fractions (for processing)
1513.19.90.00|其他椰子油及分离品（其他用途）|Other coconut oil and fractions (other uses)
1513.21.00.00|棕榈仁油或巴巴苏油（毛油）|Crude palm-kernel or babassu oil
1513.29.10.00|其他棕榈仁油及分离品（制造人造黄油及起酥油用）|Other palm-kernel oil and fractions (for manufacture of margarine and shortening)
1513.29.90.00|其他棕榈仁油或巴巴苏油及分离品|Other palm-kernel or babassu oil and fractions
1514.11.00.00|低芥酸菜籽油（毛油）|Crude low-erucic-acid rape or colza oil
1514.19.00.00|其他低芥酸菜籽油及分离品|Other low-erucic-acid rape or colza oil and fractions
1514.91.00.00|其他菜籽油或芥子油（毛油）|Other crude rape, colza or mustard oil
1514.99.00.00|其他菜籽油或芥子油及分离品（非毛油类）|Other rape, colza or mustard oil and fractions (other than crude)
1515.11.00.00|亚麻籽油（毛油）|Crude linseed oil
1515.19.10.00|其他亚麻籽油及分离品（加工用）|Other linseed oil and fractions (for processing)
1515.19.90.00|其他亚麻籽油及分离品（其他用途）|Other linseed oil and fractions (other uses)
1515.21.00.00|玉米油（毛油）|Crude maize oil
1515.29.00.00|其他玉米油及分离品|Other maize oil and fractions
1515.30.00.00|蓖麻油及分离品|Castor oil and fractions
1515.50.10.00|芝麻油（毛油）|Crude sesame oil
1515.50.90.00|其他芝麻油及分离品|Other sesame oil and fractions
1515.60.00.00|微生物油脂及分离品|Microbial fats and oils and fractions
1515.90.00.10|大麻籽油|Hemp oil
1515.90.00.90|其他固定植物油脂及分离品|Other fixed vegetable fats and oils and fractions
1516.10.00.00|动物油脂及分离品（氢化或酯化等改性）|Animal fats and oils and fractions (hydrogenated, inter-esterified, re-esterified or elaidinised)
1516.20.00.10|大豆油及分离品（氢化或酯化等改性）|Soya-bean oil and fractions (hydrogenated, inter-esterified, re-esterified or elaidinised)
1516.20.00.20|菜籽油及分离品（氢化或酯化等改性）|Rape or colza oil and fractions (hydrogenated, inter-esterified, re-esterified or elaidinised)
1516.20.00.90|其他植物油脂及分离品（氢化或酯化等改性）|Other vegetable fats and oils and fractions (hydrogenated, inter-esterified, re-esterified or elaidinised)
1516.30.00.00|微生物油脂及分离品（氢化或酯化等改性）|Microbial fats and oils and fractions (hydrogenated, inter-esterified, re-esterified or elaidinised)
1517.10.10.00|人造黄油（非液态）|Margarine (excluding liquid margarine)
1517.10.20.00|人造黄油（非液态）|Margarine (excluding liquid margarine)
1517.90.10.00|仿猪油|Imitation lard
1517.90.21.00|黄油代用品|Butter substitutes
1517.90.22.00|黄油代用品|Butter substitutes
1517.90.30.00|棕榈油及棕榈仁油混合制品（制造人造黄油及起酥油用）|Palm oil, palm-kernel oil, fractions and blends (for manufacture of margarine and shortening)
1517.90.91.00|起酥油|Shortening
1517.90.99.00|其他食用油脂混合物或制品|Other edible fat or oil mixtures or preparations
1518.00.00.10|大豆油及分离品（其他化学改性或非食用配制品）|Soya-bean oil and fractions (otherwise chemically modified or inedible preparations)
1518.00.00.90|其他化学改性油脂或非食用油脂混合制品|Other chemically modified fats and oils or inedible mixtures and preparations
1520.00.00.00|粗甘油、甘油水及甘油碱液|Crude glycerol, glycerol waters and glycerol lyes
1521.10.00.00|植物蜡（非甘油三酯）|Vegetable waxes (other than triglycerides)
1521.90.00.00|蜂蜡、其他虫蜡及鲸蜡|Beeswax, other insect waxes and spermaceti
1522.00.00.00|油鞣回收脂及油脂蜡加工残渣|Degras and residues from treatment of fatty substances or animal or vegetable waxes
`;
const additions=[];
for(const line of table.trim().split('\n')){
 let[code,zh,en]=line.split('|');const d=sources[code]?.description;assert.ok(d,code);
 if(/not certified organic/i.test(d)){zh+='（未获有机认证）';en+=' (not certified organic)';}else if(/certified organic/i.test(d)){zh+='（已获有机认证）';en+=' (certified organic)';}
 if(/Within access commitment/i.test(d)){zh+='（配额内）';en+=' (within access commitment)';}else if(/Over access commitment/i.test(d)){zh+='（配额外）';en+=' (over access commitment)';}
 additions.push({code,zh,en,...(/but not chemically modif/i.test(d)?{detail:'本项油脂可精制，但未经化学改性；名称未另有限定时包括相应分离品，具体范围见完整分类。'}:{})});
}
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
assert.equal(rows.filter(r=>r.hs_code.startsWith('15')&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!reviewed.some(x=>x.code===r.hs_code)).length,0);
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
