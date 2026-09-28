import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2001.10.00.10|黄瓜及小黄瓜|Cucumbers and gherkins
2001.10.00.90|黄瓜及小黄瓜（非零售装）|Cucumbers and gherkins (non-retail)
2001.90.10.00|洋葱|Onions
2001.90.90.20|橄榄|Olives
2001.90.90.30|蔬果调味酱|Relishes
2001.90.90.80|其他腌蔬菜|Other pickled vegetables
2001.90.90.90|其他食用植物制品|Other edible plant preparations
2002.10.00.00|番茄制品（整只或切块）|Prepared tomatoes (whole or in pieces)
2002.90.00.11|浓番茄膏（容器容量＜1.4公斤）|Tomato paste (container capacity under 1.4 kg)
2002.90.00.19|浓番茄膏（其他容器）|Tomato paste (other containers)
2002.90.00.20|番茄泥|Tomato puree
2002.90.00.90|其他番茄制品|Other prepared tomatoes
2003.10.00.00|蘑菇属蘑菇制品|Prepared Agaricus mushrooms
2003.90.10.00|松露制品|Prepared truffles
2003.90.90.00|其他蘑菇制品|Other prepared mushrooms
2004.10.00.00|马铃薯制品|Prepared potatoes
2004.90.11.00|小胡萝卜制品（长度≤11厘米）|Prepared baby carrots (length at most 11 cm)
2004.90.12.00|抱子甘蓝制品|Prepared Brussels sprouts
2004.90.20.00|芦笋制品|Prepared asparagus
2004.90.30.00|西兰花及菜花制品|Prepared broccoli and cauliflower
2004.90.91.10|菠菜制品|Prepared spinach
2004.90.91.20|竹笋秋葵等列名蔬菜制品|Prepared bamboo shoots, okra and other listed vegetables
2004.90.99.10|菜豆或利马豆制品|Prepared snap or lima beans
2004.90.99.21|豌豆制品|Prepared peas
2004.90.99.22|玉米制品|Prepared corn
2004.90.99.30|其他胡萝卜制品|Other prepared carrots
2004.90.99.90|其他蔬菜及混合制品|Other prepared vegetables and mixtures
2005.10.00.00|均化蔬菜制品|Homogenized vegetable preparations
2005.20.00.10|马铃薯沙拉（非密封容器装）|Potato salad (not in airtight containers)
2005.20.00.20|薯片薯薄片及花边薯片|Potato chips, flakes and frills
2005.20.00.90|其他马铃薯制品|Other prepared potatoes
2005.40.00.00|豌豆制品|Prepared peas
2005.51.10.00|红豆沙（食品制造用）|Red bean paste (for food manufacture)
2005.51.90.11|烘焙去荚豆制品|Baked shelled beans
2005.51.90.19|其他去荚豆制品|Other prepared shelled beans
2005.51.90.90|去荚豆制品（非零售装）|Prepared shelled beans (non-retail)
2005.59.00.00|其他菜豆豇豆属豆制品|Other prepared Vigna or Phaseolus beans
2005.60.00.00|芦笋制品|Prepared asparagus
2005.70.10.00|橄榄制品（规定硫处理或盐水保藏类）|Prepared olives (specified sulphured or brined forms)
2005.70.90.00|其他橄榄制品|Other prepared olives
2005.80.00.00|甜玉米制品|Prepared sweet corn
2005.91.00.00|竹笋制品|Prepared bamboo shoots
2005.99.11.00|小胡萝卜制品（长度≤11厘米，罐瓶装）|Prepared baby carrots (length at most 11 cm; cans or glass jars)
2005.99.19.00|其他胡萝卜制品|Other prepared carrots
2005.99.20.11|秋葵制品|Prepared okra
2005.99.20.12|菠菜制品|Prepared spinach
2005.99.20.19|其他列名蔬菜制品（洋蓟鹰嘴豆等）|Other listed vegetable preparations (artichokes, chickpeas and others)
2005.99.20.92|菠菜制品（非零售装）|Prepared spinach (non-retail)
2005.99.20.99|其他列名蔬菜制品（非零售装）|Other listed vegetable preparations (non-retail)
2005.99.90.11|甜椒制品|Prepared pimentos
2005.99.90.12|甜菜制品|Prepared beets
2005.99.90.13|辣根制品|Prepared horseradish
2005.99.90.14|酸菜制品|Sauerkraut
2005.99.90.15|胡萝卜豌豆制品|Prepared carrots and peas
2005.99.90.16|蔬菜沙拉|Vegetable salads
2005.99.90.18|其他混合蔬菜制品|Other prepared vegetable mixtures
2005.99.90.19|其他蔬菜制品|Other prepared vegetables
2005.99.90.91|蔬菜沙拉（非零售装）|Vegetable salads (non-retail)
2005.99.90.98|其他混合蔬菜制品（非零售装）|Other prepared vegetable mixtures (non-retail)
2005.99.90.99|其他蔬菜制品（非零售装）|Other prepared vegetables (non-retail)
2006.00.10.12|樱桃|Cherries
2006.00.10.19|樱桃（非零售装）|Cherries (non-retail)
2006.00.10.90|其他水果及果皮|Other fruit and fruit peel
2006.00.20.00|坚果|Nuts
2006.00.90.00|其他植物食品|Other edible plant parts
2007.99.10.00|草莓果酱|Strawberry jam
2007.99.20.00|香蕉果泥|Banana puree
2007.99.90.41|坚果泥及坚果酱|Nut purees and nut pastes
2007.99.90.42|浆果果泥|Berry purees
2007.99.90.43|其他水果泥|Other fruit purees
2007.99.90.44|其他果酱|Other jams
2007.99.90.45|果冻酱|Fruit jellies
2007.99.90.49|其他熬煮果品及坚果制品|Other cooked fruit and nut preparations
2007.99.90.92|浆果果泥（非零售装）|Berry purees (non-retail)
2007.99.90.93|其他水果泥（非零售装）|Other fruit purees (non-retail)
2007.99.90.99|其他熬煮果品及坚果制品（非零售装）|Other cooked fruit and nut preparations (non-retail)
2008.11.10.00|花生酱|Peanut butter
2008.11.90.00|其他花生制品|Other prepared peanuts
2008.19.10.10|巴旦木制品|Prepared almonds
2008.19.10.20|开心果制品|Prepared pistachios
2008.19.90.20|腰果制品|Prepared cashew nuts
2008.19.90.30|夏威夷果制品|Prepared macadamia nuts
2008.19.90.80|混合坚果花生或籽仁制品|Prepared mixtures of nuts, peanuts or seeds
2008.19.90.90|其他坚果或籽仁制品|Other prepared nuts or seeds
2008.20.00.00|菠萝制品|Prepared or preserved pineapple
2008.30.00.20|橙子制品|Prepared or preserved oranges
2008.30.00.90|其他柑橘制品|Other prepared citrus fruit
2008.40.10.00|梨果肉浆|Pear pulp
2008.40.20.00|梨脆片|Pear chips
2008.40.90.00|其他梨制品|Other prepared pears
2008.50.10.00|杏果肉浆|Apricot pulp
2008.50.90.00|其他杏制品|Other prepared apricots
2008.60.10.00|樱桃果肉浆|Cherry pulp
2008.60.90.00|其他樱桃制品|Other prepared cherries
2008.70.10.00|桃及油桃果肉浆|Peach and nectarine pulp
2008.70.90.00|其他桃及油桃制品|Other prepared peaches and nectarines
2008.80.00.00|草莓制品|Prepared or preserved strawberries
2008.91.00.00|棕榈心制品|Prepared palm hearts
2008.93.00.10|蔓越莓及越橘制品（密封容器装）|Prepared cranberries and lingonberries (airtight containers)
2008.93.00.90|蔓越莓及越橘制品（其他包装）|Prepared cranberries and lingonberries (other packaging)
2008.97.10.00|列名水果及植物食品混合制品|Prepared mixtures of specified fruits and edible plant parts
2008.97.90.00|其他水果及植物食品混合制品|Other prepared mixtures of fruit and edible plant parts
2008.99.10.00|苹果脆片|Apple chips
2008.99.20.11|苹果酱|Applesauce
2008.99.20.19|其他苹果制品（非果肉浆）|Other prepared apples (not pulp)
2008.99.20.90|其他苹果制品（非果肉浆，非零售装）|Other prepared apples (not pulp; non-retail)
2008.99.30.00|香蕉芒果等列名植物食品制品|Prepared bananas, mangoes and other listed edible plant parts
2008.99.40.00|糖水甜瓜丁|Melon cubes in syrup
2008.99.90.20|其他果肉浆|Other fruit pulps
2008.99.90.41|李子制品|Prepared plums
2008.99.90.42|蓝莓制品|Prepared blueberries
2008.99.90.48|其他浆果制品|Other prepared berries
2008.99.90.49|其他水果及食用植物制品|Other prepared fruit and edible plant parts
2008.99.90.92|浆果制品（非零售装）|Prepared berries (non-retail)
2008.99.90.99|其他水果及食用植物制品（非零售装）|Other prepared fruit and edible plant parts (non-retail)
2009.11.00.10|冷冻橙汁（容器＞4升）|Frozen orange juice (containers over 4 litres)
2009.11.00.20|冷冻橙汁（容器≤4升）|Frozen orange juice (containers at most 4 litres)
2009.12.00.10|橙汁（非冷冻，白利度≤20，密封装）|Orange juice (not frozen; Brix at most 20; airtight containers)
2009.12.00.90|橙汁（非冷冻，白利度≤20，其他包装）|Orange juice (not frozen; Brix at most 20; other packaging)
2009.19.00.00|其他橙汁（非冷冻，白利度＞20）|Other orange juice (not frozen; Brix over 20)
2009.21.00.00|葡萄柚或柚子汁（白利度≤20）|Grapefruit or pomelo juice (Brix at most 20)
2009.29.00.00|葡萄柚或柚子汁（白利度＞20）|Grapefruit or pomelo juice (Brix over 20)
2009.31.00.10|柠檬汁（白利度≤20）|Lemon juice (Brix at most 20)
2009.31.00.90|其他单一柑橘汁（白利度≤20）|Other single citrus-fruit juice (Brix at most 20)
2009.39.00.11|冷冻柠檬汁（白利度＞20）|Frozen lemon juice (Brix over 20)
2009.39.00.19|其他柠檬汁（白利度＞20）|Other lemon juice (Brix over 20)
2009.39.00.90|其他单一柑橘汁（白利度＞20）|Other single citrus-fruit juice (Brix over 20)
2009.41.00.00|菠萝汁（白利度≤20）|Pineapple juice (Brix at most 20)
2009.49.00.00|菠萝汁（白利度＞20）|Pineapple juice (Brix over 20)
2009.50.00.00|番茄汁|Tomato juice
2009.61.10.00|酿酒葡萄汁（白利度≤30）|Grape juice for wine-making (Brix at most 30)
2009.61.90.00|其他葡萄汁（白利度≤30）|Other grape juice (Brix at most 30)
2009.69.10.10|浓缩葡萄汁（白利度≥68，制造果汁饮料用）|Grape concentrate (Brix at least 68; for fruit juices or beverages)
2009.69.10.20|酿酒葡萄汁（白利度＞30）|Grape juice for wine-making (Brix over 30)
2009.69.90.00|其他葡萄汁（白利度＞30）|Other grape juice (Brix over 30)
2009.71.10.00|还原苹果汁（白利度≤20）|Reconstituted apple juice (Brix at most 20)
2009.71.90.00|其他苹果汁（白利度≤20）|Other apple juice (Brix at most 20)
2009.79.11.10|浓缩苹果汁（冷冻，食品饮料制造用）|Concentrated apple juice (frozen; for juice, beverages or fruit snacks)
2009.79.11.90|浓缩苹果汁（非冷冻，食品饮料制造用）|Concentrated apple juice (not frozen; for juice, beverages or fruit snacks)
2009.79.19.00|浓缩苹果汁（其他用途）|Concentrated apple juice (other uses)
2009.79.90.00|其他苹果汁（白利度＞20，非浓缩）|Other apple juice (Brix over 20; not concentrated)
2009.81.00.00|蔓越莓汁及越橘汁|Cranberry and lingonberry juice
2009.89.10.10|百香果汁|Passion-fruit juice
2009.89.10.20|西梅汁|Prune juice
2009.89.10.81|其他单一浓缩果汁（冷冻）|Other single-fruit concentrate (frozen)
2009.89.10.89|其他单一浓缩果汁（非冷冻）|Other single-fruit concentrate (not frozen)
2009.89.10.90|其他单一果汁（非浓缩）|Other single-fruit juice (not concentrated)
2009.89.20.00|其他单一蔬菜汁|Other single-vegetable juice
2009.90.10.00|混合柑橘汁（脱水）|Mixed citrus juices (dehydrated)
2009.90.20.00|橙汁葡萄柚汁混合汁（非脱水）|Mixed orange and grapefruit juices (not dehydrated)
2009.90.30.10|其他混合果汁（冷冻浓缩）|Other mixed fruit juices (frozen concentrate)
2009.90.30.20|其他混合果汁（非冷冻浓缩）|Other mixed fruit juices (non-frozen concentrate)
2009.90.30.90|其他混合果汁（非浓缩）|Other mixed fruit juices (not concentrated)
2009.90.40.00|混合蔬菜汁|Mixed vegetable juices
`;
const additions=table.trim().split('\n').map(line=>{let[code,zh,en]=line.split('|');const d=sources[code]?.description;assert.ok(d,code);
if(code.startsWith('2001')){zh+='（醋渍）';en+=' (preserved by vinegar or acetic acid)';}
if(/^200[23]/.test(code)){zh+='（非醋渍）';en+=' (not preserved by vinegar or acetic acid)';}
if(code.startsWith('2004')){zh+='（冷冻，非醋渍）';en+=' (frozen; not vinegar-preserved)';}
if(code.startsWith('2005')){zh+='（非冷冻，非醋渍）';en+=' (not frozen; not vinegar-preserved)';}
if(code.startsWith('2006')){zh+='（糖渍）';en+=' (preserved by sugar)';}
if(/Put up for retail sale/i.test(d)){zh+='（零售装）';en+=' (retail)';}
return{code,zh,en};});
assert.equal(additions.length,154);
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
