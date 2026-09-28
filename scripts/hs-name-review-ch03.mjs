// Reviewed live, fresh/chilled and frozen fish names; local plan only.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const inventory = JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources = JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed = JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const added = [];
const live = `
11.00.00|观赏鱼（活体，淡水）|Live ornamental fish (freshwater)
19.00.00|观赏鱼（活体，其他）|Live ornamental fish (other)
91.00.10|鳟鱼（活体，商业养殖场用）|Live trout (for commercial fish farms)
91.00.90|鳟鱼（活体，其他用途）|Live trout (other)
92.00.10|鳗鲡苗（活体）|Live elvers (Anguilla spp.)
92.00.90|鳗鲡（活体，其他）|Live eels (Anguilla spp.; other)
93.00.00|鲤科鱼（活体，指定种类）|Live carp (specified species)
94.00.00|蓝鳍金枪鱼（活体，大西洋及太平洋种）|Live Atlantic and Pacific bluefin tunas
95.00.00|南方蓝鳍金枪鱼（活体）|Live southern bluefin tunas
99.00.10|其他活鱼（商业养殖场用）|Other live fish (for commercial fish farms)
99.00.90|其他活鱼（其他用途）|Other live fish (other)
`;
for(const line of live.trim().split('\n')) { const [code,zh,en]=line.split('|');added.push({code:'0301.'+code,zh,en}); }
// Each row explicitly pairs the fresh/chilled and frozen tariff suffix, where present.
const paired = `
13.00.10|12.00.10|狗鲑（大马哈鱼）|Chum salmon
13.00.20|12.00.20|银鲑|Coho salmon
13.00.30|12.00.30|粉红鲑|Pink salmon
13.00.40|11.00.00|红鲑|Sockeye salmon
13.00.50|12.00.40|帝王鲑|Chinook salmon
13.00.90|12.00.90|太平洋鲑（其他）|Pacific salmon (other)
19.00.00|19.00.00|鲑科鱼（其他）|Other salmonidae
21.00.10|31.00.10|大西洋庸鲽|Atlantic halibut
22.00.00|32.00.00|欧洲鲽|European plaice
23.00.00|33.00.00|鳎鱼（鳎属）|Sole (Solea spp.)
24.00.00|34.00.00|大菱鲆|Turbot
29.00.00|39.00.00|比目鱼（其他指定科）|Other flatfish (specified families)
31.00.00|41.00.00|长鳍金枪鱼|Albacore tuna
32.00.00|42.00.00|黄鳍金枪鱼|Yellowfin tuna
33.00.00|43.00.00|鲣鱼|Skipjack tuna
34.00.00|44.00.00|大眼金枪鱼|Bigeye tuna
35.00.00|45.00.00|蓝鳍金枪鱼（大西洋及太平洋种）|Atlantic and Pacific bluefin tunas
36.00.00|46.00.00|南方蓝鳍金枪鱼|Southern bluefin tuna
39.00.00|49.00.00|金枪鱼（其他）|Other tunas
41.00.00|51.00.00|鲱鱼|Herrings
43.00.00|53.00.00|沙丁鱼及黍鲱（指定种类）|Sardines, sardinella and sprats
44.00.00|54.00.00|鲭鱼（指定种类）|Mackerel (specified species)
45.00.00|55.00.00|竹荚鱼（竹荚鱼属）|Jack and horse mackerel (Trachurus spp.)
46.00.00|56.00.00|军曹鱼|Cobia
47.00.00|57.00.00|剑鱼|Swordfish
49.00.00|59.00.00|其他指定鱼类（鲭鲹等组）|Other fish of the specified herring/mackerel group
51.00.10|63.00.10|大西洋鳕鱼|Atlantic cod
51.00.90|63.00.90|鳕鱼（鳕属其他种）|Other cod (Gadus spp.)
52.00.00|64.00.00|黑线鳕|Haddock
53.00.00|65.00.00|绿青鳕|Coalfish (Pollachius virens)
54.00.00|66.00.00|无须鳕及长鳍鳕|Hake (Merluccius spp. and Urophycis spp.)
55.00.00|67.00.00|黄线狭鳕|Alaska pollock
56.00.00|68.00.00|蓝鳕（指定种类）|Blue whitings
59.00.00|69.00.00|鳕形鱼（其他指定科）|Other fish of specified cod-related families
71.00.00|23.00.00|罗非鱼|Tilapias
72.00.00|24.00.00|鲶鱼（指定属）|Catfish (specified genera)
73.00.00|25.00.00|鲤科鱼（指定种类）|Carp (specified species)
74.00.00|26.00.00|鳗鲡|Eels (Anguilla spp.)
79.00.00|29.00.00|尼罗河鲈及鳢鱼|Nile perch and snakeheads
82.00.00|82.00.00|鳐鱼（鳐科）|Rays and skates (Rajidae)
83.00.00|83.00.00|犬牙鱼|Toothfish
84.00.00|84.00.00|海鲈（双棘鲈属）|Seabass (Dicentrarchus spp.)
89.00.80|89.00.80|淡水鱼（其他）|Other freshwater fish
89.00.90|89.00.90|鱼类（其他）|Other fish
91.00.10|91.00.10|鲱鱼肝、鱼卵及鱼精|Herring livers, roes and milt
91.00.90|91.00.90|鱼肝、鱼卵及鱼精（其他鱼类）|Other fish livers, roes and milt
92.00.00|92.00.00|鲨鱼鳍|Shark fins
99.00.00|99.00.00|鱼食用杂碎（其他）|Other edible fish offal
`;
function addFish(code,zh,en){
  const frozen=code.startsWith('0303');
  added.push({code,zh:`${zh}（${frozen?'冷冻':'鲜或冷藏'}）`,en:`${en} (${frozen?'frozen':'fresh or chilled'})`});
}
for(const line of paired.trim().split('\n')){
  const [fresh,frozen,zh,en]=line.split('|');
  addFish('0302.'+fresh,zh,en);addFish('0303.'+frozen,zh,en);
}
const singles=`
0302.11.00.10|虹鳟（养殖）|Rainbow trout (farmed)
0302.11.00.90|鳟鱼（其他）|Trout (other)
0302.14.00.11|大西洋鲑（养殖）|Atlantic salmon (farmed)
0302.14.00.19|大西洋鲑（其他）|Atlantic salmon (other)
0302.14.00.20|多瑙哲罗鱼|Danube salmon (Hucho hucho)
0302.21.00.90|庸鲽及马舌鲽（其他）|Other halibut
0302.42.00.00|鳀鱼|Anchovies
0302.81.00.10|角鲨|Dogfish
0302.81.00.90|鲨鱼（其他）|Other sharks
0302.85.00.00|鲷鱼（鲷科）|Seabream (Sparidae)
0302.89.00.10|鲈鱼（河鲈属）|Perch (Perca)
0302.89.00.20|长蛇齿单线鱼|Lingcod (Ophiodon elongatus)
0302.89.00.30|鮟鱇鱼（鮟鱇科）|Monkfish (Lophiidae)
0303.13.00.00|大西洋鲑及多瑙哲罗鱼|Atlantic salmon and Danube salmon
0303.14.00.00|鳟鱼（指定种类）|Trout (specified species)
0303.31.00.20|太平洋庸鲽|Pacific halibut
0303.31.00.30|格陵兰马舌鲽|Greenland halibut
0303.81.00.00|角鲨及其他鲨鱼|Dogfish and other sharks
`;
for(const line of singles.trim().split('\n'))addFish(...line.split('|'));
assert.equal(added.length,125);
assert.equal(new Set(added.map(x=>x.code)).size,added.length);
for(const entry of added){
  assert.ok(sources[entry.code],entry.code);
  assert.ok(inventory.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);
  const existing=reviewed.find(r=>r.code===entry.code);
  if(existing)assert.deepEqual(existing,entry);else reviewed.push(entry);
}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed chapter 03 additions: ${added.length}; total: ${reviewed.length}`);
