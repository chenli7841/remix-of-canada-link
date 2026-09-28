import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
// Conflicting HTML ancestry is held for PDF confirmation, never inferred away.
const held=['0511.99.00.30','0601.10.19.10','0601.10.21.91','0602.90.10.30','0602.90.10.50'];
const names=`
0501.00.00.00|人发（未经加工，含废发）|Human hair (unworked, whether or not washed or scoured; including waste)
0502.10.00.00|猪鬃及猪毛（含废料）|Pig, hog or boar bristles and hair (including waste)
0502.90.00.00|獾毛及其他制刷兽毛（含废料）|Badger hair and other brush-making hair (including waste)
0504.00.00.12|猪肠衣（香肠用）|Hog sausage casings
0504.00.00.19|其他动物肠衣（非鱼类，香肠用）|Other animal sausage casings (excluding fish)
0504.00.00.90|动物肠、膀胱及胃（非鱼类，其他）|Animal guts, bladders and stomachs (excluding fish; other)
0505.10.00.00|填充用羽毛及羽绒（未深加工）|Stuffing feathers and down (not further worked)
0505.90.00.10|其他羽毛（未深加工）|Other feathers (not further worked)
0505.90.00.20|羽毛粉（制造动物饲料用）|Feather meal (for manufacture of animal feed)
0505.90.00.90|其他带羽禽皮、禽体部分及羽毛废料|Other feathered bird skins and parts, feather parts, powder and waste
0506.10.00.00|骨质及酸处理骨|Ossein and acid-treated bones
0506.90.00.10|骨粉（制造动物饲料用）|Bone meal (for manufacture of animal feed)
0506.90.00.90|其他骨及角芯（含粉末和废料）|Other bones and horn-cores (including powder and waste)
0507.10.00.00|象牙（未加工或简单加工，含粉末及废料）|Ivory (unworked or simply prepared; including powder and waste)
0507.90.00.00|龟甲、鲸须及兽角蹄爪喙（含粉末及废料）|Tortoise-shell, whalebone and hair, horns, antlers, hooves, nails, claws and beaks (including powder and waste)
0508.00.00.10|贝壳碎料及粉末（制造动物饲料用）|Crushed or ground shells (for manufacture of animal feed)
0508.00.00.90|珊瑚、贝壳及乌贼骨（其他，含粉末及废料）|Coral, shells and cuttle-bone (other; including powder and waste)
0510.00.00.00|龙涎香、麝香等及药用动物材料|Ambergris, castoreum, civet, musk, cantharides, bile and pharmaceutical animal materials
0511.10.00.10|奶牛精液|Dairy bovine semen
0511.10.00.90|其他牛精液|Other bovine semen
0511.91.00.10|水生动物饵料（不供人食用）|Fish and aquatic invertebrates for bait (unfit for human consumption)
0511.91.00.90|其他水生动物产品及死体（不供人食用）|Other aquatic animal products and dead aquatic animals (unfit for human consumption)
0511.99.00.41|奶牛胚胎|Dairy cattle embryos
0511.99.00.49|其他牛胚胎|Other cattle embryos
0511.99.00.90|其他未列名动物产品及不食用死体|Other animal products and inedible dead animals, not elsewhere specified
0601.10.11.00|水仙鳞茎（休眠，非指定花商或苗圃培育用）|Dormant narcissus bulbs (other than specified florist or nursery growing uses)
0601.10.19.90|其他休眠鳞茎|Other dormant bulbs
0601.10.21.10|大黄及芦笋根冠（休眠）|Rhubarb or asparagus crowns (dormant)
0601.10.21.21|大丽花块根（休眠）|Dahlia tuberous roots (dormant)
0601.10.21.22|美人蕉及芍药属块根（休眠）|Canna and paeonia tuberous roots (dormant)
0601.10.21.92|鸢尾繁殖根茎（休眠，指定花商或苗圃培育用）|Iris underground planting material (dormant; for specified florist or nursery growing uses)
0601.10.21.93|秋海棠繁殖根茎（休眠，指定花商或苗圃培育用）|Begonia underground planting material (dormant; for specified florist or nursery growing uses)
0601.10.21.99|其他繁殖块根及根茎（休眠，指定花商或苗圃培育用）|Other tubers, tuberous roots, corms, crowns and rhizomes (dormant; for specified florist or nursery growing uses)
0601.10.29.00|其他休眠块茎、块根、球茎、根冠及根茎|Other dormant tubers, tuberous roots, corms, crowns and rhizomes
0601.20.10.00|菊苣及指定生长或开花繁殖根茎|Chicory and specified growing or flowering bulbs and underground planting material
0601.20.90.00|其他生长或开花鳞茎及繁殖根茎|Other growing or flowering bulbs, tubers, tuberous roots, corms, crowns and rhizomes
0602.10.00.00|无根插条及接穗|Unrooted cuttings and slips
0602.20.00.10|果树及坚果树（活体，可嫁接）|Live fruit or nut trees (whether or not grafted)
0602.20.00.90|其他果实或坚果灌木（活体，可嫁接）|Other live fruit or nut shrubs and bushes (whether or not grafted)
0602.30.00.00|杜鹃花（活体，可嫁接）|Live rhododendrons and azaleas (whether or not grafted)
0602.40.10.00|多花蔷薇（活体，可嫁接）|Live multiflora rosebushes (whether or not grafted)
0602.40.90.00|其他蔷薇属植物（活体，可嫁接）|Other live roses (whether or not grafted)
0602.90.10.10|蘑菇菌种|Mushroom spawn
0602.90.10.20|棕榈植物（活体）|Live palms
0602.90.10.60|其他活树木（本项指定种类或用途）|Other live trees (specified tariff-item species or uses)
0602.90.10.70|活灌木（本项指定种类或用途）|Live shrubs and bushes (specified tariff-item species or uses)
0602.90.10.90|其他活植物（本项指定种类或用途）|Other live plants (specified tariff-item species or uses)
0602.90.90.20|其他活灌木（非前列种类或用途）|Other live shrubs and bushes (not previously specified)
0602.90.90.90|其他活植物（非前列种类或用途）|Other live plants (not previously specified)
0603.11.00.00|玫瑰切花及花蕾（鲜）|Rose cut flowers and buds (fresh)
0603.12.00.00|康乃馨切花及花蕾（鲜）|Carnation cut flowers and buds (fresh)
0603.13.10.00|兰属切花及花蕾（鲜）|Cymbidium cut flowers and buds (fresh)
0603.13.90.00|其他兰花切花及花蕾（鲜）|Other orchid cut flowers and buds (fresh)
0603.14.00.00|菊花切花及花蕾（鲜）|Chrysanthemum cut flowers and buds (fresh)
0603.15.00.00|百合切花及花蕾（鲜）|Lily cut flowers and buds (fresh)
0603.19.00.00|其他切花及花蕾（鲜）|Other cut flowers and buds (fresh)
0603.90.10.00|石头花属切花及花蕾（染色、漂白或浸渍）|Gypsophila cut flowers and buds (dyed, bleached or impregnated)
0603.90.20.00|石头花属切花及花蕾（其他非鲜品）|Other gypsophila cut flowers and buds (not fresh)
0603.90.90.00|其他切花及花蕾（非鲜品）|Other cut flowers and buds (not fresh)
0604.20.10.10|圣诞树（鲜，装饰用）|Christmas trees (fresh; ornamental)
0604.20.10.90|文竹叶、草、棕榈叶、苔藓及地衣（鲜，装饰用）|Asparagus setaceus foliage, grasses, palm leaves, mosses and lichens (fresh; ornamental)
0604.20.90.00|其他装饰用枝叶及植物部分（鲜，无花或花蕾）|Other ornamental foliage and plant parts (fresh; without flowers or buds)
0604.90.10.00|装饰用草、棕榈叶、苔藓及地衣（非鲜品）|Ornamental grasses, palm leaves, mosses and lichens (not fresh)
0604.90.90.00|其他装饰用枝叶及植物部分（非鲜品，无花或花蕾）|Other ornamental foliage and plant parts (not fresh; without flowers or buds)
`;
const additions=names.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){
 assert.ok(sources[entry.code],entry.code);assert.ok(!held.includes(entry.code));
 assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);
 const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);
}
const pending=rows.filter(r=>/^0[56]/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!reviewed.some(x=>x.code===r.hs_code)).map(r=>r.hs_code).sort();
assert.deepEqual(pending,[...held].sort());
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
fs.writeFileSync('.hs-names.local/source-review-holds.json',JSON.stringify(held.map(code=>({code,reason:'Official HTML ancestor conflict; confirm PDF before writing'})),null,2));
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}; source-review holds: ${held.length}`);
