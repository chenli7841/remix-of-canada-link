import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const additions=[];
function add(code,zh,en,detail){
 const source=sources[code];assert.ok(source,code);
 const within=/within access commitment/i.test(source.description),over=/over access commitment/i.test(source.description);
 assert.ok(!(within&&over));
 if(within||over){zh+=`（${within?'配额内':'配额外'}）`;en+=` (${within?'within':'over'} access commitment)`;}
 additions.push({code,zh,en,...(detail?{detail}:{})});
}
for(const [sub,zfat,efat] of [['10','≤1%','not exceeding 1%'],['20','＞1%且≤6%','over 1% but not exceeding 6%'],['40','＞6%且≤10%','over 6% but not exceeding 10%'],['50','＞10%','over 10%']]){
 for(const quota of ['10','20'])add(`0401.${sub}.${quota}.00`,`乳及稀奶油（未浓缩、未加糖，乳脂${zfat}）`,`Milk and cream (not concentrated or sweetened; fat ${efat})`);
}
for(const quota of ['10','20'])add(`0402.10.${quota}.00`,'乳及奶油固体制品（粉、粒等形态，乳脂≤1.5%）','Milk and cream solids (powder, granules or other solid forms; fat not exceeding 1.5%)');
for(const [sub,zsweet,esweet] of [['21','未加糖或甜味剂','not sweetened'],['29','含糖或甜味剂','sweetened']]){
 for(const [base,zh,en] of [['1','乳','Milk'],['2','奶油','Cream']]){
  for(const quota of ['1','2'])add(`0402.${sub}.${base}${quota}.00`,`${zh}固体制品（粉、粒等形态，乳脂＞1.5%，${zsweet}）`,`${en} solids (powder, granules or other solid forms; fat over 1.5%; ${esweet})`);
 }
}
for(const [sub,zh,en] of [['91','未加糖或甜味剂','not sweetened'],['99','含糖或甜味剂','sweetened']])for(const q of ['10','20'])add(`0402.${sub}.${q}.00`,`乳及稀奶油（非固体，${zh}）`,`Milk and cream (other than solid forms; ${en})`);
const explicit=`
0403.20.10.00|酸奶（含指定配料，零售包装）|Yogurt (with specified added ingredients; retail packaging)
0403.20.21.00|酸奶（含指定配料，非零售包装）|Yogurt (with specified added ingredients; non-retail packaging)
0403.20.29.10|酸奶（其他，已获有机认证）|Yogurt (other; certified organic)
0403.20.29.20|酸奶（其他，未获有机认证）|Yogurt (other; not certified organic)
0403.20.31.00|酸奶（含指定配料，非零售包装）|Yogurt (with specified added ingredients; non-retail packaging)
0403.20.39.10|酸奶（其他，已获有机认证）|Yogurt (other; certified organic)
0403.20.39.20|酸奶（其他，未获有机认证）|Yogurt (other; not certified organic)
0403.90.11.00|酪乳粉|Powdered buttermilk
0403.90.12.00|酪乳粉|Powdered buttermilk
0403.90.91.00|其他酪乳、发酵或酸化乳及奶油|Other buttermilk, fermented or acidified milk and cream
0403.90.92.00|其他酪乳、发酵或酸化乳及奶油|Other buttermilk, fermented or acidified milk and cream
0404.10.10.00|浓缩乳清蛋白|Whey protein concentrate
0404.10.21.00|乳清粉|Powdered whey
0404.10.22.00|乳清粉|Powdered whey
0404.10.90.10|乳清（其他，浓缩或蒸发浓缩）|Whey (other; condensed or evaporated)
0404.10.90.20|改性乳清（其他）|Modified whey (other)
0404.10.90.90|乳清（其他）|Other whey
0406.10.10.10|奶油奶酪（不含乳清及酪乳奶酪）|Cream cheese (excluding whey and buttermilk cheese)
0406.10.10.90|鲜奶酪及凝乳（其他，未熟化）|Other fresh unripened cheese and curd
0406.10.20.00|鲜奶酪及凝乳（未熟化）|Fresh unripened cheese and curd
0406.20.11.10|切达奶酪（磨碎或粉状）|Cheddar cheese (grated or powdered)
0406.20.11.20|切达型奶酪（磨碎或粉状）|Cheddar-type cheese (grated or powdered)
0406.20.12.00|切达及切达型奶酪（磨碎或粉状）|Cheddar and Cheddar-type cheese (grated or powdered)
0406.20.91.10|帕尔马奶酪（磨碎或粉状）|Parmesan cheese (grated or powdered)
0406.20.91.20|罗马诺奶酪（磨碎或粉状）|Romano cheese (grated or powdered)
0406.20.91.90|其他奶酪（磨碎或粉状）|Other cheese (grated or powdered)
0406.20.92.00|其他奶酪（磨碎或粉状）|Other cheese (grated or powdered)
0406.30.10.11|切达再制奶酪（非磨碎或粉状）|Processed Cheddar cheese (not grated or powdered)
0406.30.10.12|切达型再制奶酪（非磨碎或粉状）|Processed Cheddar-type cheese (not grated or powdered)
0406.30.10.20|格鲁耶尔再制奶酪（非磨碎或粉状）|Processed Gruyere cheese (not grated or powdered)
0406.30.10.30|瑞士式再制奶酪（非磨碎或粉状）|Processed Swiss cheese (not grated or powdered)
0406.30.10.90|其他再制奶酪（非磨碎或粉状）|Other processed cheese (not grated or powdered)
0406.30.20.00|再制奶酪（非磨碎或粉状）|Processed cheese (not grated or powdered)
0406.40.10.00|蓝纹及其他洛克福青霉纹理奶酪|Blue-veined and other Penicillium roqueforti-veined cheese
0406.40.20.00|蓝纹及其他洛克福青霉纹理奶酪|Blue-veined and other Penicillium roqueforti-veined cheese
0406.90.11.10|切达奶酪（其他形态）|Cheddar cheese (other forms)
0406.90.11.21|科尔比、蒙特雷杰克、农夫或砖形奶酪|Colby, Monterey Jack, Farmer or Brick cheese
0406.90.11.29|其他切达型奶酪|Other Cheddar-type cheese
0406.90.12.00|切达及切达型奶酪（其他形态）|Cheddar and Cheddar-type cheese (other forms)
0406.90.41.10|高达奶酪|Gouda cheese
0406.90.41.20|埃丹奶酪|Edam cheese
0406.90.41.90|其他高达型奶酪|Other Gouda-type cheese
0406.90.42.00|高达及高达型奶酪|Gouda and Gouda-type cheese
0406.90.61.00|马苏里拉及同类型奶酪|Mozzarella and Mozzarella-type cheese
0406.90.62.00|马苏里拉及同类型奶酪|Mozzarella and Mozzarella-type cheese
0406.90.71.10|瑞士式埃门塔尔奶酪|Swiss/Emmental cheese
0406.90.71.20|萨姆索奶酪|Samsoe cheese
0406.90.71.30|雅尔斯伯格奶酪|Jarlsberg cheese
0406.90.71.40|格雷韦奶酪|Greve cheese
0406.90.71.90|其他瑞士式埃门塔尔型奶酪|Other Swiss/Emmental-type cheese
0406.90.72.00|瑞士式埃门塔尔及同类型奶酪|Swiss/Emmental and Swiss/Emmental-type cheese
0406.90.98.10|菲达奶酪|Feta cheese
0406.90.98.20|芒斯特奶酪|Muenster cheese
0406.90.98.30|其他奶酪（部分脱脂乳制）|Other cheese (of partly skimmed milk)
0406.90.98.40|其他奶酪（脱脂乳制）|Other cheese (of skimmed milk)
0406.90.98.90|其他奶酪|Other cheese
0406.90.99.00|其他奶酪|Other cheese
0407.11.11.00|鸡种蛋（带壳，孵化肉鸡用）|Fertilized chicken eggs in shell (for broiler incubation)
0407.11.12.00|鸡种蛋（带壳，孵化肉鸡用）|Fertilized chicken eggs in shell (for broiler incubation)
0407.11.91.00|鸡种蛋（带壳，其他孵化用）|Fertilized chicken eggs in shell (other incubation uses)
0407.11.92.00|鸡种蛋（带壳，其他孵化用）|Fertilized chicken eggs in shell (other incubation uses)
0407.19.00.10|火鸡种蛋（带壳，孵化用）|Fertilized turkey eggs in shell (for incubation)
0407.19.00.90|其他禽种蛋（带壳，孵化用）|Other fertilized birds' eggs in shell (for incubation)
0407.21.10.10|鲜鸡蛋（带壳，普通白壳，零售或餐用）|Fresh chicken eggs in shell (regular white; retail or table)
0407.21.10.20|鲜鸡蛋（带壳，有机或其他特色，零售或餐用）|Fresh chicken eggs in shell (organic or other specialty; retail or table)
0407.21.10.30|鲜鸡蛋（带壳，仅供打蛋加工）|Fresh chicken eggs in shell (for breaking purposes only)
0407.21.20.00|鲜鸡蛋（带壳，非种蛋）|Fresh chicken eggs in shell (other than fertilized eggs for incubation)
0407.29.00.00|其他鲜禽蛋（带壳，非种蛋）|Other fresh birds' eggs in shell (not for incubation)
0407.90.11.00|鸡蛋（带壳，保藏或熟制）|Chicken eggs in shell (preserved or cooked)
0407.90.12.00|鸡蛋（带壳，保藏或熟制）|Chicken eggs in shell (preserved or cooked)
0407.90.90.00|其他禽蛋（带壳，保藏或熟制）|Other birds' eggs in shell (preserved or cooked)
0408.99.10.10|去壳禽蛋（冷冻）|Birds' eggs not in shell (frozen)
0408.99.10.90|去壳禽蛋（其他非干制、非冷冻）|Birds' eggs not in shell (other, neither dried nor frozen)
0408.99.20.00|去壳禽蛋（其他非干制）|Birds' eggs not in shell (other than dried)
0409.00.00.10|天然蜂蜜（容器装，重量≤5公斤）|Natural honey (in containers; weight not exceeding 5 kg)
0410.10.10.00|食用昆虫（非活体，鲜、冷藏或冷冻）|Edible non-living insects (fresh, chilled or frozen)
0410.10.90.00|食用昆虫（其他）|Other edible insects
0410.90.00.00|其他未列名食用动物产品|Other edible products of animal origin, not elsewhere specified
`;
for(const line of explicit.trim().split('\n')){
 const [code,zh,en]=line.split('|');
 const detail=['0403.20.10.00','0403.20.21.00','0403.20.31.00'].includes(code)?'指定配料包括巧克力、香料、咖啡或其提取物、植物或其部分、谷物、焙烤食品；不得用于全部或部分替代乳成分，且产品须保留酸奶的基本特征。':undefined;
 add(code,zh,en,detail);
}
for(const q of ['10','20']){
 for(const [sub,zh,en] of [['11','混合乳粉（脱脂乳粉占比＞50%）','Blended dairy powder (over 50% skimmed milk powder by weight)'],['12','混合乳粉（乳清粉占比＞50%）','Blended dairy powder (over 50% whey powder by weight)'],['19','混合乳粉（其他）','Other blended dairy powder'],['90','其他天然乳成分制品','Other products of natural milk constituents']])add(`0404.90.${q}.${sub}`,zh,en);
 for(const [sub,zh,en] of [['10','黄油','Butter'],['20','乳脂涂抹制品','Dairy spreads'],['90','其他乳脂及乳油','Other fats and oils derived from milk']])add(`0405.${sub}.${q}.00`,zh,en);
 for(const [sub,zh,en] of [['11','蛋黄（干制）','Dried egg yolks'],['19','蛋黄（其他非干制）','Other egg yolks (not dried)'],['91','去壳禽蛋（干制）','Dried birds\' eggs not in shell']])add(`0408.${sub}.${q}.00`,zh,en);
}
for(const [within,over,zh,en] of [['21','22','卡芒贝尔','Camembert'],['31','32','布里','Brie'],['51','52','普罗沃洛内','Provolone'],['81','82','格鲁耶尔','Gruyere'],['91','92','哈瓦蒂','Havarti'],['93','94','帕尔马','Parmesan'],['95','96','罗马诺','Romano']]){
 add(`0406.90.${within}.10`,`${zh}奶酪`,`${en} cheese`);
 add(`0406.90.${within}.20`,`${zh}型奶酪`,`${en}-type cheese`);
 add(`0406.90.${over}.00`,`${zh}及同类型奶酪`,`${en} and ${en}-type cheese`);
}
for(const [sub,zh,en] of [['21','特白色','extra white'],['22','白色','white'],['23','特浅琥珀色（金色）','extra light amber (golden)'],['24','浅琥珀色','light amber'],['25','深琥珀色','dark amber'],['26','深色','dark'],['29','其他','other']])add(`0409.00.00.${sub}`,`天然蜂蜜（容器装，重量＞5公斤，${zh}）`,`Natural honey (in containers; weight over 5 kg; ${en})`);
assert.equal(additions.length,148);
assert.equal(new Set(additions.map(r=>r.code)).size,148);
for(const entry of additions){
 assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);
 const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);
}
assert.equal(rows.filter(r=>r.hs_code.startsWith('04')&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!reviewed.some(x=>x.code===r.hs_code)).length,0);
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
