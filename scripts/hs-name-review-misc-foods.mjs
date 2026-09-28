import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2101.11.10.10|原味速溶咖啡（脱咖啡因）|Unflavoured instant coffee (decaffeinated)
2101.11.10.91|原味速溶咖啡（未脱咖啡因，零售装）|Unflavoured instant coffee (not decaffeinated; retail)
2101.11.10.99|原味速溶咖啡（未脱咖啡因，非零售装）|Unflavoured instant coffee (not decaffeinated; non-retail)
2101.11.90.10|调味速溶咖啡|Flavoured instant coffee
2101.11.90.90|其他咖啡提取物及浓缩物|Other coffee extracts, essences and concentrates
2101.12.00.00|咖啡及咖啡提取物制食品|Preparations based on coffee or coffee extracts
2101.20.00.10|纯速溶茶或马黛茶（无添加）|Soluble or instant tea or mate (without additives)
2101.20.00.90|其他茶及马黛茶提取物和制品|Other tea or mate extracts and preparations
2101.30.00.00|焙炒菊苣及代咖啡制品|Roasted chicory and coffee substitutes and their extracts
2102.10.00.00|活性酵母|Active yeasts
2102.20.00.00|非活性酵母及其他死单细胞微生物|Inactive yeasts and other dead single-cell microorganisms
2102.30.00.00|配制泡打粉|Prepared baking powders
2103.20.10.00|番茄调味酱|Tomato ketchup
2103.20.90.10|番茄披萨酱|Tomato pizza sauces
2103.20.90.91|其他番茄调味汁（已获有机认证）|Other tomato sauces (certified organic)
2103.20.90.92|其他番茄调味汁（未获有机认证）|Other tomato sauces (not certified organic)
2103.30.10.00|芥末粉|Mustard flour and meal
2103.30.20.00|调制芥末|Prepared mustard
2103.90.10.10|蛋黄酱|Mayonnaise
2103.90.10.20|沙拉调味酱|Salad dressing
2103.90.90.10|鱼制品调味汁|Sauces based on fish products
2103.90.90.90|其他调味汁及混合调味料|Other sauces and mixed condiments or seasonings
2104.10.00.00|汤羹肉汤及汤料|Soups, broths and preparations therefor
2104.20.00.00|均化混合食品|Homogenized composite food preparations
2105.00.10.00|风味冰品及冰霜|Flavoured ice and ice sherbets
2105.00.91.10|花式冰淇淋制品|Ice cream novelties
2105.00.91.20|其他冰淇淋|Other ice cream
2105.00.91.90|其他食用冰品|Other edible ice
2105.00.92.10|花式冰淇淋制品|Ice cream novelties
2105.00.92.20|其他冰淇淋|Other ice cream
2105.00.92.90|其他食用冰品|Other edible ice
2106.90.10.40|代用茶制品|Tea substitutes
2106.90.10.50|植物调味制品|Vegetable preparations for flavouring
2106.90.10.90|其他列名食品配料（椰浆糖浆等）|Other specified food ingredients (coconut cream syrup and others)
2106.90.21.00|着色蔗糖浆（干基含糖≥90%，未调味）|Coloured cane or beet sugar syrup (dry-basis sugar at least 90%; unflavoured)
2106.90.29.10|食品浓缩料及果味糖浆|Food concentrates and fruit syrups for foods or beverages
2106.90.29.90|其他着色甘蔗或甜菜糖浆|Other coloured cane or beet sugar syrups
2106.90.31.00|乳、奶油或黄油代用品（乳成分≥50%）|Milk, cream or butter substitutes (dairy content at least 50%)
2106.90.32.00|乳、奶油或黄油代用品（乳成分≥50%）|Milk, cream or butter substitutes (dairy content at least 50%)
2106.90.33.00|黄油代用制品（乳脂＞15%，乳成分＜50%）|Butter-substitute preparations (milk fat over 15%; dairy content under 50%)
2106.90.34.00|黄油代用制品（乳脂＞15%，乳成分＜50%）|Butter-substitute preparations (milk fat over 15%; dairy content under 50%)
2106.90.35.00|乳、奶油或黄油代用品（规定低乳成分类）|Milk, cream or butter substitutes (specified lower dairy-content category)
2106.90.39.10|打发奶油代用品|Whipped cream substitutes
2106.90.39.20|咖啡伴侣|Coffee whitener
2106.90.39.90|其他乳、奶油或黄油代用品|Other milk, cream or butter substitutes
2106.90.41.10|奶酪火锅料|Cheese fondue
2106.90.41.20|微波爆米花料|Prepared and packaged microwave popping corn
2106.90.42.00|蛋白水解物食品|Protein hydrolysates for food
2106.90.51.00|蛋制食品（含蛋≥50%）|Egg preparations (egg content at least 50%)
2106.90.52.00|蛋制食品（含蛋≥50%）|Egg preparations (egg content at least 50%)
2106.90.91.00|营养强化单一浓缩果蔬汁|Vitamin- or mineral-fortified single-fruit or vegetable juice concentrate
2106.90.92.00|营养强化混合浓缩果蔬汁|Vitamin- or mineral-fortified mixed fruit or vegetable juice concentrate
2106.90.93.00|其他食品（乳成分≥50%）|Other food preparations (dairy content at least 50%)
2106.90.94.00|其他食品（乳成分≥50%）|Other food preparations (dairy content at least 50%)
2106.90.95.10|乳脂油糖混合物（干基乳固体＞10%，乳成分＜50%）|Butter oil and sugar blends (dry-basis milk solids over 10%; dairy content under 50%)
2106.90.95.90|其他食品（干基乳固体＞10%，乳成分＜50%）|Other food preparations (dry-basis milk solids over 10%; dairy content under 50%)
2106.90.96.00|复合含酒精饮料配料（酒精度＞0.5%，非香料基）|Compound alcoholic beverage preparations (over 0.5% ABV; not based on odoriferous substances)
2106.90.97.00|果味粉（制造药品食品或饮料用）|Fruit-flavoured powders (for pharmaceuticals, foods or beverages)
2106.90.98.00|果冻粉冰淇淋粉及类似制粉|Jelly powders, ice cream powders and similar preparations
2106.90.99.10|其他调味粉|Other flavouring powders
2106.90.99.31|口香糖（含合成甜味剂）|Chewing gum (with synthetic sweeteners)
2106.90.99.39|其他糖食（含合成甜味剂）|Other sweets (with synthetic sweeteners)
2106.90.99.40|调味提取物及香精|Flavouring extracts and essences
2106.90.99.91|其他未列名食品（冷冻）|Other food preparations not elsewhere specified (frozen)
2106.90.99.92|其他未列名食品（非冷冻，密封容器装）|Other food preparations not elsewhere specified (not frozen; airtight containers)
2106.90.99.99|其他未列名食品（非冷冻，其他包装）|Other food preparations not elsewhere specified (not frozen; other packaging)
`;
const additions=table.trim().split('\n').map(line=>{let[code,zh,en]=line.split('|');const d=sources[code]?.description;assert.ok(d,code);if(/within access commitment/i.test(d)){zh+='（配额内）';en+=' (within access commitment)';}if(/over access commitment/i.test(d)){zh+='（配额外）';en+=' (over access commitment)';}return{code,zh,en};});
assert.equal(additions.length,66);
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
