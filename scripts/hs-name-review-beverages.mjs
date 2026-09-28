import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2201.10.00.10|天然矿泉水（无糖无调味）|Natural mineral water (unsweetened and unflavoured)
2201.10.00.90|其他矿泉水及汽水（无糖无调味）|Other mineral and aerated waters (unsweetened and unflavoured)
2201.90.00.00|其他无糖无调味水及冰雪|Other unsweetened unflavoured water, ice and snow
2202.10.00.11|碳酸饮料（含高倍甜味剂）|Carbonated soft drinks (with high-intensity sweeteners)
2202.10.00.19|其他碳酸饮料|Other carbonated soft drinks
2202.10.00.90|其他加糖或调味水饮料|Other sweetened or flavoured water beverages
2202.91.00.00|无醇啤酒|Non-alcoholic beer
2202.99.10.00|无醇葡萄酒|Non-alcoholic wine
2202.99.21.10|营养强化橙汁（非浓缩）|Vitamin- or mineral-fortified orange juice (not concentrated)
2202.99.21.90|其他营养强化单一果蔬汁（非浓缩）|Other fortified single-fruit or vegetable juice (not concentrated)
2202.99.22.00|营养强化混合果蔬汁（非浓缩）|Fortified mixed fruit or vegetable juice (not concentrated)
2202.99.31.00|巧克力奶|Chocolate milk
2202.99.32.00|含乳饮料（乳成分≥50%，非零售装）|Milk beverages (dairy content at least 50%; non-retail)
2202.99.33.00|含乳饮料（乳成分≥50%，非零售装）|Milk beverages (dairy content at least 50%; non-retail)
2202.99.39.10|其他含乳饮料（已获有机认证）|Other milk beverages (certified organic)
2202.99.39.20|其他含乳饮料（未获有机认证）|Other milk beverages (not certified organic)
2202.99.90.10|大豆饮料|Soy beverages
2202.99.90.90|其他非酒精饮料|Other non-alcoholic beverages
2203.00.00.10|麦芽啤酒|Malt beer
2203.00.00.20|麦芽啤酒|Malt beer
2203.00.00.31|拉格啤酒|Lager beer
2203.00.00.32|波特或司陶特黑啤|Porter or stout
2203.00.00.39|其他麦芽啤酒|Other malt beer
2203.00.00.40|麦芽啤酒|Malt beer
2207.10.00.10|未改性乙醇（浓度≥80%，燃料用）|Undenatured ethyl alcohol (at least 80% ABV; fuel use)
2207.10.00.90|未改性乙醇（浓度≥80%，其他用途）|Undenatured ethyl alcohol (at least 80% ABV; other uses)
2207.20.11.00|特别改性乙醇（法定类别）|Specially denatured alcohol (statutory category)
2207.20.12.10|改性乙醇（法定类别，燃料用）|Denatured alcohol (statutory category; fuel use)
2207.20.12.90|改性乙醇（法定类别，其他用途）|Denatured alcohol (statutory category; other uses)
2207.20.19.00|其他改性乙醇|Other denatured ethyl alcohol
2207.20.90.00|其他改性酒精|Other denatured spirits
2208.20.00.10|葡萄酒或葡萄渣蒸馏酒（散装）|Grape wine or grape marc spirits (bulk)
2208.20.00.90|葡萄酒或葡萄渣蒸馏酒（非散装）|Grape wine or grape marc spirits (not bulk)
2208.30.00.10|波本威士忌|Bourbon whisky
2208.30.00.20|苏格兰威士忌|Scotch whisky
2208.30.00.30|爱尔兰威士忌|Irish whisky
2208.30.00.90|其他威士忌|Other whiskies
2208.40.10.10|朗姆酒（散装）|Rum (bulk)
2208.40.10.90|朗姆酒（非散装）|Rum (not bulk)
2208.40.90.00|其他甘蔗发酵蒸馏酒|Other spirits distilled from fermented sugar-cane products
2208.50.00.00|金酒及荷兰杜松子酒|Gin and geneva
2208.60.00.00|伏特加|Vodka
2208.70.00.00|利口酒及甜露酒|Liqueurs and cordials
2208.90.10.00|龙舌兰酒|Tequila
2208.90.21.00|未改性乙醇（浓度＜80%，饮用或制酒用）|Undenatured ethyl alcohol (under 80% ABV; beverage use)
2208.90.29.00|未改性乙醇（浓度＜80%，其他用途）|Undenatured ethyl alcohol (under 80% ABV; other uses)
2208.90.30.00|安格仕苦精酒|Angostura bitters
2208.90.41.00|含烈酒果汁（已包装）|Spirituous fruit juices (packaged)
2208.90.49.00|其他含烈酒果汁|Other spirituous fruit juices
2208.90.92.00|水果白兰地|Fruit brandies
2208.90.98.00|其他含烈酒饮料（已包装）|Other spirituous beverages (packaged)
2208.90.99.00|其他烈酒及含烈酒饮料|Other spirits and spirituous beverages
2209.00.00.00|食醋及醋酸制代用醋|Vinegar and substitutes obtained from acetic acid
`;
const exact=new Map(table.trim().split('\n').map(line=>{const[c,z,e]=line.split('|');return[c,[z,e]];}));
const additions=[];
for(const row of rows.filter(r=>/^22/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh))){
const code=row.hs_code,d=sources[code]?.description;assert.ok(d,code);const t=d.split(' - ').slice(1).join(' - ');
let pair=exact.get(code);const z=[],e=[];const q=(a,b)=>{z.push(a);e.push(b);};
if(!pair&&code.startsWith('2204')){
if(code.startsWith('2204.10'))pair=['起泡葡萄酒','Sparkling grape wine'];
else if(code.startsWith('2204.30'))pair=['其他葡萄汁醪','Other grape must'];
else if(/2204\.(21|22|29)\.4/.test(code))pair=['加酒精抑制发酵葡萄汁醪','Grape must with fermentation prevented or arrested by added alcohol'];
else if(/ - Icewine$/.test(t))pair=['冰葡萄酒','Icewine'];
else if(/ - White$/.test(t))pair=['白葡萄酒','White wine'];
else if(/ - Red$/.test(t))pair=['红葡萄酒','Red wine'];
else pair=['其他葡萄酒','Other grape wine'];
if(code.startsWith('2204.21'))q('容器≤2升','containers at most 2 litres');
if(code.startsWith('2204.22'))q('容器＞2升且≤10升','containers over 2 and at most 10 litres');
if(code.startsWith('2204.29'))q('容器＞10升','containers over 10 litres');
}
if(!pair&&code.startsWith('2205')){
pair=/Vermouth, white/.test(t)?['白味美思酒','White vermouth']:/Vermouth, red/.test(t)?['红味美思酒','Red vermouth']:['其他味美思及芳香葡萄酒','Other vermouth and aromatized grape wines'];
q(code.startsWith('2205.10')?'容器≤2升':'容器＞2升',code.startsWith('2205.10')?'containers at most 2 litres':'containers over 2 litres');
}
if(!pair&&code.startsWith('2206')){
if(/^2206\.00\.1[12]/.test(code))pair=['起泡苹果酒','Sparkling cider'];
else if(/^2206\.00\.1[89]/.test(code))pair=['其他苹果酒','Other cider'];
else if(/^2206\.00\.2/.test(code))pair=['西梅酒','Prune wine'];
else if(/^2206\.00\.3/.test(code))pair=['起泡梨酒','Sparkling perry'];
else if(/^2206\.00\.4/.test(code))pair=['其他起泡发酵酒','Other sparkling fermented wine'];
else if(/^2206\.00\.[567]/.test(code))pair=['清酒及其他非起泡发酵酒','Sake and other non-sparkling fermented wine'];
else if(code==='2206.00.80.00')pair=['姜啤及草本啤酒','Ginger beer and herbal beer'];
else if(code==='2206.00.91.00')pair=['蜂蜜酒','Mead'];
else pair=['其他发酵饮料及混合饮料','Other fermented beverages and mixtures'];
}
assert.ok(pair,code);let[zh,en]=pair;
// Intersect explicitly stated parent and leaf alcohol ranges, preserving both limits.
if(/^220[3456]/.test(code)||['2208.90.41.00','2208.90.49.00','2208.90.98.00'].includes(code)){
 const lows=[...t.matchAll(/(?<!not )exceeding ([\d.]+)%/gi)].map(m=>Number(m[1]));
 const highs=[...t.matchAll(/not exceeding ([\d.]+)%/gi)].map(m=>Number(m[1]));
 let low=lows.length?Math.max(...lows):null,high=highs.length?Math.min(...highs):null;
 if(['2204.10.90.00','2204.21.49.00','2204.22.49.00','2204.29.49.00','2204.30.90.00','2206.00.12.00','2206.00.19.00','2206.00.39.00','2206.00.49.00'].includes(code))low=22.9;
 if(low!==null||high!==null){assert.ok(low===null||high===null||low<high,code);q(`酒精度${low===null?'':`＞${low}%`}${low!==null&&high!==null?'且':''}${high===null?'':`≤${high}%`}`,`ABV ${low===null?'':`over ${low}%`}${low!==null&&high!==null?' and ':''}${high===null?'':`at most ${high}%`}`);}
}
if(/within access commitment/i.test(t))q('配额内','within access commitment');
if(/over access commitment/i.test(t))q('配额外','over access commitment');
if(z.length){zh+=`（${z.join('，')}）`;en+=` (${e.join('; ')})`;}
additions.push({code,zh,en});
}
assert.equal(additions.length,140);
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
