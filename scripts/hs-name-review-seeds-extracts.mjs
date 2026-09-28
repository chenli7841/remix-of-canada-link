import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
1201.10.00.00|大豆（种用）|Soya beans (seed)
1201.90.00.10|大豆（榨油用）|Soya beans (for oil extraction)
1201.90.00.90|大豆（其他用途）|Soya beans (other uses)
1202.30.00.00|花生（种用，未烘焙或烹煮）|Groundnuts (seed; not roasted or otherwise cooked)
1202.41.00.00|花生（带壳，非种用，未烘焙或烹煮）|Groundnuts (in shell; other than seed; not roasted or cooked)
1202.42.10.00|花生仁（去红衣，未烘焙或烹煮）|Blanched shelled peanuts (not roasted or otherwise cooked)
1202.42.90.00|其他花生仁（未烘焙或烹煮）|Other shelled peanuts (not roasted or otherwise cooked)
1203.00.00.00|椰子干（榨油原料）|Copra
1204.00.00.00|亚麻籽（可破碎）|Linseed (whether or not broken)
1205.10.00.10|低芥酸油菜籽（播种用）|Low-erucic-acid rape or colza seeds (for sowing)
1205.10.00.20|低芥酸油菜籽（榨油用）|Low-erucic-acid rape or colza seeds (for oil extraction)
1205.10.00.90|低芥酸油菜籽（其他用途）|Low-erucic-acid rape or colza seeds (other uses)
1205.90.00.00|其他油菜籽|Other rape or colza seeds
1206.00.00.10|葵花籽（播种用）|Sunflower seeds (for sowing)
1206.00.00.20|葵花籽（榨油用）|Sunflower seeds (for oil extraction)
1206.00.00.31|葵花籽（供人食用，带壳）|Sunflower seeds (for human use; in shell)
1206.00.00.32|葵花籽仁（供人食用，去壳）|Sunflower seeds (for human use; shelled)
1206.00.00.90|葵花籽（其他用途）|Sunflower seeds (other uses)
1207.10.00.00|棕榈果及棕榈仁|Palm nuts and kernels
1207.21.00.00|棉籽（种用）|Cotton seeds (seed for sowing)
1207.29.00.00|棉籽（其他用途）|Cotton seeds (other uses)
1207.30.00.00|蓖麻籽|Castor oil seeds
1207.40.00.00|芝麻籽|Sesamum seeds
1207.50.00.00|芥菜籽|Mustard seeds
1207.60.00.00|红花籽|Safflower seeds
1207.70.00.00|瓜籽|Melon seeds
1207.91.00.00|罂粟籽|Poppy seeds
1207.99.00.11|大麻籽（播种用）|Hemp seeds (for sowing)
1207.99.00.19|大麻籽（其他用途）|Hemp seeds (other uses)
1207.99.00.90|其他含油种子及果实|Other oil seeds and oleaginous fruits
1208.10.00.00|大豆细粉及粗粉|Soya bean flour and meal
1208.90.00.00|其他油籽及含油果实粉（非芥菜籽）|Other oil-seed or oleaginous-fruit flour and meal (excluding mustard)
1209.10.00.00|糖甜菜种子（播种用）|Sugar beet seeds (for sowing)
1209.21.00.00|紫花苜蓿种子（播种用）|Lucerne (alfalfa) seeds (for sowing)
1209.22.00.10|红三叶草种子（播种用）|Red clover seeds (for sowing)
1209.22.00.30|白三叶草种子（播种用）|White clover seeds (for sowing)
1209.22.00.90|其他三叶草种子（播种用）|Other clover seeds (for sowing)
1209.23.00.10|匍匐紫羊茅种子（播种用）|Creeping red fescue seeds (for sowing)
1209.23.00.40|高羊茅种子（播种用）|Tall fescue seeds (for sowing)
1209.23.00.90|其他羊茅种子（播种用）|Other fescue seeds (for sowing)
1209.24.00.10|草地早熟禾种子（播种用，已认证）|Kentucky bluegrass seeds (for sowing; certified)
1209.24.00.90|草地早熟禾种子（播种用，其他）|Kentucky bluegrass seeds (for sowing; other)
1209.25.00.10|一年生黑麦草种子（播种用）|Annual ryegrass seeds (for sowing)
1209.25.00.20|多年生黑麦草种子（播种用）|Perennial ryegrass seeds (for sowing)
1209.29.00.00|其他饲料植物种子（播种用）|Other forage plant seeds (for sowing)
1209.30.10.00|草本花卉种子（播种用，每包＜25克）|Herbaceous flower seeds (for sowing; packages under 25 g)
1209.30.20.00|草本花卉种子（播种用，散装或每包≥25克）|Herbaceous flower seeds (for sowing; bulk or packages at least 25 g)
1209.91.90.00|蔬菜种子（播种用，其他包装或价值条件）|Vegetable seeds (for sowing; other packaging or value conditions)
1209.99.10.10|树木种子（播种用，不含第八章坚果树种）|Tree seeds (for sowing; excluding Chapter 8 nut-tree seeds)
1209.99.10.21|烟草种子（播种用，散装或每包＞500克）|Tobacco seeds (for sowing; bulk or packages over 500 g)
1209.99.10.22|瓜类种子（播种用，散装或每包＞500克）|Melon seeds (for sowing; bulk or packages over 500 g)
1209.99.10.29|其他播种用种子、果实及孢子（指定包装）|Other seeds, fruit and spores for sowing (specified packaging)
1209.99.20.00|其他播种用种子（每包≤500克）|Other seeds for sowing (packages not exceeding 500 g)
1210.10.00.00|啤酒花球果（未研磨、粉碎或制粒）|Hop cones (not ground, powdered or pelleted)
1210.20.00.10|啤酒花球果颗粒|Hop cone pellets
1210.20.00.90|其他研磨啤酒花及蛇麻腺|Other ground or powdered hop cones and lupulin
1211.20.10.00|人参根茶（单次饮用袋装）|Ginseng-root herbal tea (individual-serving bags)
1211.20.90.00|人参根（其他形态）|Ginseng roots (other forms)
1211.30.00.00|古柯叶|Coca leaf
1211.40.00.00|罂粟秆|Poppy straw
1211.50.00.00|麻黄|Ephedra
1211.60.10.00|非洲樱桃树皮茶（单次饮用袋装）|African cherry bark herbal tea (individual-serving bags)
1211.60.90.00|非洲樱桃树皮（其他形态）|African cherry bark (other forms)
1211.90.10.10|其他草本茶（单次饮用袋装，已获有机认证）|Other herbal tea (individual-serving bags; certified organic)
1211.90.10.20|其他草本茶（单次饮用袋装，未获有机认证）|Other herbal tea (individual-serving bags; not certified organic)
1211.90.90.10|其他药用树皮|Other bark used primarily in pharmacy
1211.90.90.20|其他药用植物根|Other roots used primarily in pharmacy
1211.90.90.50|大麻（本项植物材料）|Cannabis (plant material of this heading)
1211.90.90.60|其他药用、香料或杀虫用草本植物|Other herbs for pharmacy, perfumery or pesticidal purposes
1211.90.90.70|其他药用、香料或杀虫用种子|Other seeds for pharmacy, perfumery or pesticidal purposes
1211.90.90.90|其他药用、香料或杀虫用植物材料|Other plant materials for pharmacy, perfumery or pesticidal purposes
1212.21.00.00|海草及其他藻类（供人食用）|Seaweeds and other algae (fit for human consumption)
1212.29.00.00|海草及其他藻类（其他用途）|Seaweeds and other algae (other uses)
1212.91.00.00|糖甜菜|Sugar beet
1212.92.00.00|角豆（长角豆）|Locust beans (carob)
1212.93.00.00|甘蔗|Sugar cane
1212.94.00.00|菊苣根（未焙制）|Chicory roots (unroasted)
1212.99.00.00|其他未列名食用植物产品|Other vegetable products primarily for human consumption, not elsewhere specified
1213.00.00.00|谷物秸秆及谷壳（未加工，可切碎或制粒）|Cereal straw and husks (unprepared; whether or not chopped, ground, pressed or pelleted)
1214.10.00.00|紫花苜蓿粉及颗粒|Lucerne (alfalfa) meal and pellets
1214.90.00.10|紫花苜蓿（干制，打包或散装）|Lucerne (alfalfa), dried (baled or loose)
1214.90.00.20|其他干草（打包或散装）|Other dried hay (baled or loose)
1214.90.00.90|其他饲料根茎及草料|Other fodder roots and forage products
1301.20.00.00|阿拉伯胶|Gum arabic
1301.90.00.10|大麻树脂（本项天然树脂）|Cannabis resin (natural resin of this heading)
1301.90.00.90|其他虫胶、天然树胶、树脂及油树脂|Other lac, natural gums, resins, gum-resins and oleoresins
1302.11.00.00|鸦片|Opium
1302.12.00.00|甘草液汁及浸膏|Liquorice saps and extracts
1302.13.00.00|啤酒花液汁及浸膏|Hop saps and extracts
1302.14.00.00|麻黄液汁及浸膏|Ephedra saps and extracts
1302.19.00.10|大麻液汁及浸膏|Cannabis saps and extracts
1302.19.00.90|其他植物液汁及浸膏|Other vegetable saps and extracts
1302.20.00.00|果胶、果胶酸盐及果胶酸酯|Pectic substances, pectinates and pectates
1302.31.00.00|琼脂（可改性）|Agar-agar (whether or not modified)
1302.32.00.10|瓜尔胶（可改性）|Guar gum (whether or not modified)
1302.32.00.90|其他角豆、角豆籽或瓜尔籽胶及增稠剂|Other mucilages and thickeners from locust beans, locust bean seeds or guar seeds
1302.39.00.10|卡拉胶（爱尔兰苔提取物）|Carrageenan (Irish moss extract)
1302.39.00.90|其他植物胶液及增稠剂|Other vegetable mucilages and thickeners
1401.10.00.00|竹材（主要供编结用）|Bamboos (primarily for plaiting)
1401.20.00.00|藤材（主要供编结用）|Rattans (primarily for plaiting)
1401.90.00.00|其他编结用植物材料|Other vegetable materials primarily for plaiting
1404.20.00.00|棉短绒|Cotton linters
1404.90.00.00|其他未列名植物产品|Other vegetable products not elsewhere specified
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
for(const[suffix,zh,en]of[['40','洋葱','Onion'],['50','胡萝卜','Carrot'],['60','西兰花','Broccoli'],['70','萝卜','Radish'],['80','生菜','Lettuce'],['91','菠菜','Spinach'],['92','花椰菜','Cauliflower'],['93','甘蓝','Cabbage'],['94','欧洲防风','Parsnip'],['95','芹菜','Celery'],['96','欧芹','Parsley'],['97','芜菁','Turnip'],['99','其他蔬菜','Other vegetable']]){
 additions.push({code:`1209.91.10.${suffix}`,zh:`${zh}种子（播种用，指定包装或价值条件）`,en:`${en} seeds (for sowing; specified packaging or value conditions)`,detail:'散装或每包超过500克；或者每包25至500克且每500克价值不少于5.50加元。保留完整分类用于核对。'});
}
const held=['1209.22.00.20','1209.91.10.10','1209.91.10.20','1209.91.10.30'];
for(const entry of additions){assert.ok(sources[entry.code],entry.code);assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
const missing=rows.filter(r=>/^(12|13|14)/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!reviewed.some(x=>x.code===r.hs_code)).map(x=>x.hs_code);assert.deepEqual(missing,held);
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}; source-review holds: ${held.length}`);
