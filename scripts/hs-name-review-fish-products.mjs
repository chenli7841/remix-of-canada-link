// Explicitly reviewed classifications for fish fillets/meat and preserved fish.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const names=`
31.00.00|罗非鱼片|Tilapia fillets
32.00.00|鲶鱼片（指定属）|Catfish fillets (specified genera)
33.00.00|尼罗河鲈鱼片|Nile perch fillets
39.00.00|鲤科鱼、鳗鲡及鳢鱼片（指定种类）|Carp, eel and snakehead fillets (specified species)
41.00.00|鲑鱼片（太平洋鲑、大西洋鲑及多瑙哲罗鱼）|Pacific, Atlantic and Danube salmon fillets
42.00.00|鳟鱼片（指定种类）|Trout fillets (specified species)
43.00.00|比目鱼片（指定科）|Flatfish fillets (specified families)
44.00.10|鳕鱼片（鳕属指定种）|Cod fillets (specified Gadus species)
44.00.90|鳕形鱼片（其他指定科）|Other fillets of specified cod-related families
45.00.00|剑鱼片|Swordfish fillets
46.00.00|犬牙鱼片|Toothfish fillets
47.00.00|角鲨及其他鲨鱼片|Dogfish and other shark fillets
48.00.00|鳐鱼片（鳐科）|Ray and skate fillets (Rajidae)
49.00.10|淡水鱼片（其他）|Other freshwater fish fillets
49.00.90|鱼片（其他）|Other fish fillets
51.00.00|罗非鱼、鲶鱼等指定鱼肉|Meat of tilapias, catfish, carp, eels, Nile perch and snakeheads
52.00.00|鲑科鱼肉|Salmonidae meat
53.00.00|鳕形鱼肉（指定科）|Fish meat of specified cod-related families
54.00.00|剑鱼肉|Swordfish meat
55.00.00|犬牙鱼肉|Toothfish meat
56.00.00|角鲨及其他鲨鱼肉|Dogfish and other shark meat
57.00.00|鳐鱼肉（鳐科）|Ray and skate meat (Rajidae)
59.00.00|鱼肉（其他）|Other fish meat
61.00.00|罗非鱼片|Tilapia fillets
62.00.00|鲶鱼片（指定属）|Catfish fillets (specified genera)
63.00.00|尼罗河鲈鱼片|Nile perch fillets
69.00.00|鲤科鱼、鳗鲡及鳢鱼片（指定种类）|Carp, eel and snakehead fillets (specified species)
71.00.00|鳕鱼片（鳕属指定种）|Cod fillets (specified Gadus species)
72.00.00|黑线鳕片|Haddock fillets
73.00.00|绿青鳕片|Coalfish fillets
74.00.00|无须鳕及长鳍鳕片|Hake fillets (Merluccius spp. and Urophycis spp.)
75.00.00|黄线狭鳕片|Alaska pollock fillets
79.00.00|鳕形鱼片（其他指定科）|Other fillets of specified cod-related families
81.00.00|鲑鱼片（太平洋鲑、大西洋鲑及多瑙哲罗鱼）|Pacific, Atlantic and Danube salmon fillets
82.00.00|鳟鱼片（指定种类）|Trout fillets (specified species)
83.00.10|大西洋庸鲽片|Atlantic halibut fillets
83.00.20|太平洋庸鲽片|Pacific halibut fillets
83.00.30|鳎鱼片（鳎属）|Sole fillets (Solea spp.)
83.00.90|比目鱼片（其他指定科）|Other flatfish fillets (specified families)
84.00.00|剑鱼片|Swordfish fillets
85.00.00|犬牙鱼片|Toothfish fillets
86.00.00|鲱鱼片|Herring fillets
87.00.00|金枪鱼及鲣鱼片|Tuna and skipjack fillets
88.00.00|鲨鱼及鳐鱼片|Dogfish, other shark, ray and skate fillets
89.00.80|淡水鱼片（其他）|Other freshwater fish fillets
89.00.90|鱼片（其他）|Other fish fillets
91.00.00|剑鱼肉|Swordfish meat
92.00.00|犬牙鱼肉|Toothfish meat
93.00.00|罗非鱼、鲶鱼等指定鱼肉|Meat of tilapias, catfish, carp, eels, Nile perch and snakeheads
94.00.00|黄线狭鳕肉|Alaska pollock meat
95.00.10|黑线鳕碎肉（块状或板状）|Minced haddock meat (blocks and slabs)
95.00.90|鳕形鱼肉（其他指定科，不含黄线狭鳕）|Other meat of specified cod-related families (excluding Alaska pollock)
96.00.00|角鲨及其他鲨鱼肉|Dogfish and other shark meat
97.00.00|鳐鱼肉（鳐科）|Ray and skate meat (Rajidae)
99.00.10|鱼糜（其他鱼类）|Surimi (other fish)
99.00.30|庸鲽肉（其他块状或板状）|Halibut meat (other blocks and slabs)
99.00.40|鳎鱼肉（鳎属）|Sole meat (Solea spp.)
99.00.50|大菱鲆肉|Turbot meat
99.00.90|鱼肉（其他）|Other fish meat
`;
const additions=[];
for(const line of names.trim().split('\n')){
  const [suffix,zh,en]=line.split('|');
  const frozen=Number(suffix.slice(0,2))>=60;
  const otherMeat=/^(5|9)/.test(suffix);
  additions.push({code:'0304.'+suffix,zh:`${zh}（${frozen?'冷冻':'鲜或冷藏'}）`,en:`${en} (${frozen?'frozen':'fresh or chilled'})`,
    ...(otherMeat?{detail:'本项为鱼片以外的鱼肉；除名称另有指定外，包括未绞碎及已绞碎的鱼肉。具体鱼种及加工形态以完整分类为准。'}:{})});
}
assert.equal(additions.length,59);
const preserved=`
20|鱼肝、鱼卵及鱼精|Fish livers, roes and milt|干制、熏制、盐腌或盐渍|dried, smoked, salted or in brine
31|罗非鱼、鲶鱼等指定鱼片|Fillets of tilapias, catfish, carp, eels, Nile perch and snakeheads|干制、盐腌或盐渍，未熏制|dried, salted or in brine; not smoked
32|鳕形鱼片（指定科）|Fillets of specified cod-related families|干制、盐腌或盐渍，未熏制|dried, salted or in brine; not smoked
39|其他鱼片|Other fish fillets|干制、盐腌或盐渍，未熏制|dried, salted or in brine; not smoked
41|鲑鱼（太平洋鲑、大西洋鲑及多瑙哲罗鱼）|Pacific, Atlantic and Danube salmon|熏制，含鱼片|smoked; including fillets
42|鲱鱼|Herrings|熏制，含鱼片|smoked; including fillets
43|鳟鱼（指定种类）|Trout (specified species)|熏制，含鱼片|smoked; including fillets
44|罗非鱼、鲶鱼等指定鱼类|Tilapias, catfish, carp, eels, Nile perch and snakeheads|熏制，含鱼片|smoked; including fillets
49|其他鱼类|Other fish|熏制，含鱼片|smoked; including fillets
51|鳕鱼（鳕属指定种）|Cod (specified Gadus species)|干制，可盐腌，未熏制|dried; whether or not salted; not smoked
52|罗非鱼、鲶鱼等指定鱼类|Tilapias, catfish, carp, eels, Nile perch and snakeheads|干制，可盐腌，未熏制|dried; whether or not salted; not smoked
53|鳕形鱼（指定科，不含鳕属指定种）|Fish of specified cod-related families (excluding specified Gadus cod)|干制，可盐腌，未熏制|dried; whether or not salted; not smoked
54|鲱鱼、鲭鱼等指定鱼类|Fish of the specified herring/mackerel group|干制，可盐腌，未熏制|dried; whether or not salted; not smoked
59|其他鱼类|Other fish|干制，可盐腌，未熏制|dried; whether or not salted; not smoked
61|鲱鱼|Herrings|盐腌或盐渍，未干制或熏制|salted or in brine; not dried or smoked
62|鳕鱼（鳕属指定种）|Cod (specified Gadus species)|盐腌或盐渍，未干制或熏制|salted or in brine; not dried or smoked
63|鳀鱼|Anchovies|盐腌或盐渍，未干制或熏制|salted or in brine; not dried or smoked
64|罗非鱼、鲶鱼等指定鱼类|Tilapias, catfish, carp, eels, Nile perch and snakeheads|盐腌或盐渍，未干制或熏制|salted or in brine; not dried or smoked
69|其他鱼类|Other fish|盐腌或盐渍，未干制或熏制|salted or in brine; not dried or smoked
71|鲨鱼鳍|Shark fins|干制、盐腌、盐渍或熏制|dried, salted, in brine or smoked
72|鱼头、鱼尾及鱼鳔|Fish heads, tails and maws|干制、盐腌、盐渍或熏制|dried, salted, in brine or smoked
79|其他鱼食用杂碎|Other edible fish offal|干制、盐腌、盐渍或熏制|dried, salted, in brine or smoked
`;
for(const line of preserved.trim().split('\n')){
  const [suffix,zh,en,zs,es]=line.split('|');
  additions.push({code:`0305.${suffix}.00.00`,zh:`${zh}（${zs}）`,en:`${en} (${es})`});
}
assert.equal(additions.length,81);
const crustaceans=`
11.00.00|岩龙虾及其他刺龙虾（冷冻，指定属）|Rock lobster and other sea crawfish (frozen; specified genera)
12.10.00|螯龙虾（冷冻，熏制）|Lobsters (Homarus spp.; frozen; smoked)
12.90.00|螯龙虾（冷冻，其他）|Lobsters (Homarus spp.; frozen; other)
14.10.00|帝王蟹或雪蟹（冷冻，加工用）|King or snow crabs (frozen; for processing)
14.90.10|帝王蟹（冷冻，其他）|King crabs (frozen; other)
14.90.20|雪蟹（冷冻，其他）|Snow crabs (frozen; other)
14.90.30|珍宝蟹（冷冻，其他）|Dungeness crabs (frozen; other)
14.90.90|其他蟹（冷冻，其他用途）|Other crabs (frozen; other)
15.00.00|挪威海螯虾（冷冻）|Norway lobsters (frozen)
16.00.00|冷水虾（冷冻，指定种类）|Cold-water shrimps and prawns (frozen; specified species)
17.00.90|其他虾（冷冻，非带壳类）|Other shrimps and prawns (frozen; other than in shell)
19.00.00|其他甲壳动物（冷冻）|Other crustaceans (frozen)
31.00.00|岩龙虾及其他刺龙虾（活、鲜或冷藏，指定属）|Rock lobster and other sea crawfish (live, fresh or chilled; specified genera)
32.00.10|螯龙虾（活体）|Live lobsters (Homarus spp.)
32.00.90|螯龙虾（鲜或冷藏）|Lobsters (Homarus spp.; fresh or chilled)
33.00.00|蟹（活、鲜或冷藏）|Crabs (live, fresh or chilled)
34.00.00|挪威海螯虾（活、鲜或冷藏）|Norway lobsters (live, fresh or chilled)
35.00.00|冷水虾（活、鲜或冷藏，指定种类）|Cold-water shrimps and prawns (live, fresh or chilled; specified species)
36.00.10|其他虾（活、鲜或冷藏，带壳）|Other shrimps and prawns (live, fresh or chilled; in shell)
36.00.20|其他虾（活、鲜或冷藏，去壳）|Other shrimps and prawns (live, fresh or chilled; shelled)
39.00.00|其他甲壳动物（活、鲜或冷藏）|Other crustaceans (live, fresh or chilled)
91.00.00|岩龙虾及其他刺龙虾（其他状态，指定属）|Rock lobster and other sea crawfish (other states; specified genera)
92.10.00|螯龙虾（熏制，非冷冻）|Lobsters (Homarus spp.; smoked; not frozen)
92.90.00|螯龙虾（其他状态，非熏制）|Lobsters (Homarus spp.; other states; not smoked)
93.00.00|蟹（其他状态）|Crabs (other states)
94.00.00|挪威海螯虾（其他状态）|Norway lobsters (other states)
95.00.00|虾（其他状态）|Shrimps and prawns (other states)
99.00.00|其他甲壳动物（其他状态）|Other crustaceans (other states)
`;
for(const line of crustaceans.trim().split('\n')){
  const [suffix,zh,en]=line.split('|');
  additions.push({code:'0306.'+suffix,zh,en,...(suffix.startsWith('9')?{detail:'其他状态指本税目内除活、鲜、冷藏或冷冻外的状态，包括适用的干制、盐腌、盐渍、熏制或带壳蒸煮；具体范围及排除条件见完整分类。'}:{})});
}
const sizes=[['11','少于33','less than 33'],['12','33–45','33–45'],['13','46–55','46–55'],['14','56–66','56–66'],['15','67–88','67–88'],['16','89–110','89–110'],['17','111–132','111–132'],['18','133–154','133–154'],['19','多于154','more than 154']];
for(const [suffix,zh,en] of sizes)additions.push({code:'0306.17.00.'+suffix,zh:`其他带壳虾（冷冻，每公斤${zh}只）`,en:`Other shrimps and prawns (frozen; in shell; ${en} per kg)`});
assert.equal(additions.length,118);
assert.equal(new Set(additions.map(x=>x.code)).size,118);
for(const entry of additions){
  assert.ok(sources[entry.code],entry.code);
  assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);
  const old=reviewed.find(r=>r.code===entry.code);
  if(old)assert.deepEqual(old,entry);else reviewed.push(entry);
}
const missing=rows.filter(r=>/^030[456]/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!reviewed.some(x=>x.code===r.hs_code));
assert.equal(missing.length,0,JSON.stringify(missing.map(r=>r.hs_code)));
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total reviewed: ${reviewed.length}`);
