import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2301.10.10.00|鲸肉及杂碎粉粒和油渣（非供人食用）|Whale meat or offal meals, pellets and greaves (unfit for human consumption)
2301.10.90.10|动物蒸煮残渣（非供人食用）|Animal tankage (unfit for human consumption)
2301.10.90.90|其他肉骨杂碎粉粒及油渣（非供人食用）|Other meat or offal meals, pellets and greaves (unfit for human consumption)
2301.20.11.00|鱼粉（制造鱼类全价饲料用）|Fish meal (for complete fish-feed manufacture)
2301.20.18.00|其他鱼粉（非鲱鱼鲑鱼粉，制造动物饲料用）|Other fish meal (excluding herring or salmon meal; for animal-feed manufacture)
2301.20.19.00|其他鱼粉（非供人食用）|Other fish meal (unfit for human consumption)
2301.20.90.00|其他鱼及水生无脊椎动物粉粒（非供人食用）|Other fish or aquatic-invertebrate meals and pellets (unfit for human consumption)
2302.10.00.00|玉米麸皮及加工残渣|Maize bran and milling residues
2302.30.10.00|小麦麸皮及加工残渣|Wheat bran and milling residues
2302.30.20.00|小麦麸皮及加工残渣|Wheat bran and milling residues
2302.40.11.00|大麦麸皮及加工残渣|Barley bran and milling residues
2302.40.12.00|大麦麸皮及加工残渣|Barley bran and milling residues
2302.40.90.00|其他谷物麸皮及加工残渣|Other cereal bran and milling residues
2302.50.00.00|豆类加工残渣|Leguminous-plant milling residues
2303.10.00.10|玉米蛋白粉（淀粉加工副产物）|Corn gluten meal
2303.10.00.90|其他淀粉制造残渣|Other starch-manufacturing residues
2303.20.10.00|干甜菜粕|Dried beet pulp
2303.20.90.00|其他制糖废渣（甘蔗渣等）|Other sugar-manufacturing waste including bagasse
2303.30.00.00|酿造及蒸馏糟渣|Brewing or distilling dregs and waste
2304.00.00.00|豆粕及大豆榨油残渣|Soya-bean oil-cake and solid extraction residues
2305.00.00.00|花生粕及榨油残渣|Groundnut oil-cake and solid extraction residues
2306.10.00.00|棉籽粕及榨油残渣|Cottonseed oil-cake and solid extraction residues
2306.20.00.00|亚麻籽粕及榨油残渣|Linseed oil-cake and solid extraction residues
2306.30.00.00|葵花籽粕及榨油残渣|Sunflower-seed oil-cake and solid extraction residues
2306.41.00.00|低芥酸菜籽粕及榨油残渣|Low-erucic-acid rapeseed oil-cake and extraction residues
2306.49.00.00|其他菜籽粕及榨油残渣|Other rapeseed oil-cake and extraction residues
2306.50.00.00|椰子粕及榨油残渣|Coconut or copra oil-cake and extraction residues
2306.60.00.00|棕榈果仁粕及榨油残渣|Palm-nut or palm-kernel oil-cake and extraction residues
2306.90.00.00|其他植物或微生物油脂提取残渣|Other vegetable or microbial oil-cake and extraction residues
2307.00.00.00|葡萄酒糟及粗酒石|Wine lees and argol
2308.00.00.00|其他饲用植物原料及废渣|Other vegetable materials, waste and residues for animal feeding
2309.10.00.10|犬猫饼干粮（整块或碎粒，零售装）|Dog or cat biscuits (whole or kibbled; retail)
2309.10.00.91|犬猫食品（密封容器，零售装）|Dog or cat food (airtight containers; retail)
2309.10.00.99|其他犬猫食品（零售装）|Other dog or cat food (retail)
2309.90.10.00|特定动物饲料及饲料补充原料|Specified animal feeds and feed-supplement ingredients
2309.90.20.00|其他含蛋饲料制品|Other animal-feed preparations containing eggs
2309.90.31.11|犊牛全价饲料|Complete calf feeds
2309.90.31.19|其他牛用全价饲料|Other complete bovine feeds
2309.90.31.20|家禽全价饲料|Complete poultry feeds
2309.90.31.90|其他全价饲料及补充料|Other complete feeds and feed supplements
2309.90.32.00|全价饲料及补充料|Complete feeds and feed supplements
2309.90.33.00|全价饲料及补充料|Complete feeds and feed supplements
2309.90.34.41|饲料补充料（含杆菌肽）|Feed supplements (containing bacitracin)
2309.90.34.42|饲料补充料（含金霉素）|Feed supplements (containing chlortetracycline)
2309.90.34.43|饲料补充料（含泰乐菌素）|Feed supplements (containing tylosin)
2309.90.34.49|饲料补充料（含其他抗生素）|Feed supplements (containing other antibiotics)
2309.90.34.51|饲料补充料（含维生素A）|Feed supplements (containing vitamin A)
2309.90.34.52|饲料补充料（含维生素E）|Feed supplements (containing vitamin E)
2309.90.34.53|饲料补充料（含复合维生素）|Feed supplements (containing multivitamins)
2309.90.34.59|饲料补充料（含其他维生素）|Feed supplements (containing other vitamins)
2309.90.34.60|饲料补充料（含抗生素及维生素）|Feed supplements (containing an antibiotic and a vitamin)
2309.90.34.90|其他全价饲料及补充料|Other complete feeds and feed supplements
2309.90.35.00|全价饲料及补充料（含乳脂乳固体干基≥50%）|Complete feeds and supplements (milk solids with butterfat at least 50% dry basis)
2309.90.36.00|全价饲料及补充料（含乳脂乳固体干基＞10%且＜50%）|Complete feeds and supplements (milk solids with butterfat over 10% and under 50% dry basis)
2309.90.37.00|鱼溶浆饲料|Fish solubles for feeding
2309.90.39.34|其他鸟类全价饲料|Other complete bird feeds
2309.90.39.35|其他鱼类全价饲料|Other complete fish feeds
2309.90.39.39|其他动物全价饲料|Other complete animal feeds
2309.90.39.40|其他含抗生素饲料补充料|Other feed supplements containing an antibiotic
2309.90.39.53|其他含复合维生素饲料补充料|Other feed supplements containing multivitamins
2309.90.39.59|其他含维生素饲料补充料|Other feed supplements containing vitamins
2309.90.39.90|其他配合饲料及补充料|Other compound feeds and supplements
2309.90.91.00|列名饲料原料及添加制品|Specified feed ingredients and additive preparations
2309.90.99.00|其他动物饲料制品|Other animal-feeding preparations
2401.10.10.00|未去梗烟叶（雪茄包叶用）|Unstemmed tobacco (for cigar wrappers)
2401.10.91.00|未去梗土耳其型烟叶|Unstemmed Turkish-type tobacco
2401.10.99.00|其他未去梗烟叶|Other unstemmed tobacco
2401.20.10.00|去梗烟叶（雪茄包叶用）|Stemmed or stripped tobacco (for cigar wrappers)
2401.20.90.20|去梗弗吉尼亚烤烟|Stemmed or stripped Virginia flue-cured tobacco
2401.20.90.90|其他去梗烟叶|Other partly or wholly stemmed tobacco
2401.30.00.00|烟草废料|Tobacco refuse
2402.10.00.10|手工卷制雪茄|Hand-rolled cigars
2402.10.00.90|其他含烟草雪茄及小雪茄|Other tobacco cigars, cheroots and cigarillos
2402.20.00.00|含烟草卷烟|Cigarettes containing tobacco
2402.90.00.00|烟草代用品制雪茄及卷烟|Cigars and cigarettes of tobacco substitutes
2403.11.00.00|水烟烟草（章注规定类别）|Water-pipe tobacco specified in the chapter note
2403.19.00.21|卷烟用烟丝（已包装）|Cigarette smoking tobacco (packaged)
2403.19.00.22|卷烟用烟丝（未包装）|Cigarette smoking tobacco (not packaged)
2403.19.00.91|其他吸用烟草（已包装）|Other smoking tobacco (packaged)
2403.19.00.92|其他吸用烟草（未包装）|Other smoking tobacco (not packaged)
2403.91.10.10|均化或再造烟草（包叶用，已包装）|Homogenized or reconstituted tobacco (wrapper use; packaged)
2403.91.10.20|均化或再造烟草（包叶用，未包装）|Homogenized or reconstituted tobacco (wrapper use; not packaged)
2403.91.20.10|加工再造烟叶（雪茄束叶用，已包装）|Processed reconstituted leaf tobacco (cigar binders; packaged)
2403.91.20.20|加工再造烟叶（雪茄束叶用，未包装）|Processed reconstituted leaf tobacco (cigar binders; not packaged)
2403.91.90.10|其他均化或再造烟草（已包装）|Other homogenized or reconstituted tobacco (packaged)
2403.91.90.20|其他均化或再造烟草（未包装）|Other homogenized or reconstituted tobacco (not packaged)
2403.99.10.10|鼻烟（已包装）|Snuff (packaged)
2403.99.10.20|鼻烟（未包装）|Snuff (not packaged)
2403.99.20.00|加工烟草代用品（不含烟草）|Manufactured tobacco substitutes (without tobacco)
2403.99.90.10|嚼烟（已包装）|Chewing tobacco (packaged)
2404.11.10.00|含均化或再造烟草制品（无燃烧吸入用）|Products with homogenized or reconstituted tobacco (non-combustion inhalation)
2404.11.90.00|其他含烟草制品（无燃烧吸入用）|Other tobacco products (non-combustion inhalation)
2404.12.00.00|其他含尼古丁制品（无燃烧吸入用）|Other nicotine products (non-combustion inhalation)
2404.19.00.00|其他烟草或尼古丁代用品（无燃烧吸入用）|Other tobacco or nicotine substitute products (non-combustion inhalation)
2404.91.00.10|尼古丁口香糖（含量≥2毫克）|Nicotine chewing gum (at least 2 mg nicotine)
2404.91.00.90|其他口用尼古丁制品|Other nicotine products for oral application
2404.92.00.00|经皮使用尼古丁制品|Nicotine products for transdermal application
2404.99.00.00|其他人体摄入用尼古丁制品|Other products for nicotine intake into the human body
`;
const additions=table.trim().split('\n').map(line=>{let[code,zh,en]=line.split('|');const d=sources[code]?.description;assert.ok(d,code);
if(/50% or more by weight in the dry state of non-fat milk solids/.test(d)){zh+='（干基脱脂乳固体≥50%）';en+=' (non-fat milk solids at least 50% dry basis)';}
if(/more than 10% but less than 50% by weight in the dry state of non-fat milk solids/.test(d)){zh+='（干基脱脂乳固体＞10%且＜50%）';en+=' (non-fat milk solids over 10% and under 50% dry basis)';}
if(/10% or less by weight in the dry state of non-fat milk solids/.test(d)){zh+='（干基脱脂乳固体≤10%）';en+=' (non-fat milk solids at most 10% dry basis)';}
if(/within access commitment/i.test(d)){zh+='（配额内）';en+=' (within access commitment)';}if(/over access commitment/i.test(d)){zh+='（配额外）';en+=' (over access commitment)';}return{code,zh,en};});
assert.equal(additions.length,98);
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
