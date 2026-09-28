import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2501.00.10.00|配制食盐（氯化钠≥90%）|Table salt with admixtures (sodium chloride at least 90%)
2501.00.90.00|其他盐、纯氯化钠及海水|Other salt, pure sodium chloride and sea water
2502.00.00.00|未焙烧黄铁矿|Unroasted iron pyrites
2503.00.00.00|硫磺（非升华沉淀或胶态硫）|Sulphur (other than sublimed, precipitated or colloidal)
2504.10.00.00|天然石墨（粉状或鳞片状）|Natural graphite (powder or flakes)
2504.90.00.00|其他天然石墨|Other natural graphite
2505.10.00.10|铸造用硅砂及石英砂|Silica and quartz sands for foundries
2505.10.00.30|压裂砂|Fracturing sand
2505.90.00.00|其他天然砂|Other natural sands
2506.20.00.00|石英岩（原状粗修或矩形块板）|Quartzite (crude, roughly trimmed or rectangular blocks or slabs)
2507.00.00.00|高岭土及类似黏土|Kaolin and other kaolinic clays
2508.10.00.00|膨润土|Bentonite
2508.30.00.00|耐火黏土|Fire-clay
2508.40.00.10|普通蓝黏土及其他球黏土|Common blue clay and other ball clays
2508.40.00.91|其他黏土（动物垫料用）|Other clays (for animal litter)
2508.40.00.99|其他黏土（其他用途）|Other clays (other uses)
2509.00.00.00|白垩|Chalk
2510.10.00.00|天然磷酸盐及磷质白垩（未磨碎）|Natural calcium phosphates, aluminium calcium phosphates and phosphatic chalk (unground)
2510.20.00.00|天然磷酸盐及磷质白垩（已磨碎）|Natural calcium phosphates, aluminium calcium phosphates and phosphatic chalk (ground)
2511.10.00.00|重晶石（天然硫酸钡）|Barytes (natural barium sulphate)
2511.20.00.00|毒重石（天然碳酸钡）|Witherite (natural barium carbonate)
2512.00.00.00|硅藻土及类似硅质土（表观比重≤1）|Siliceous fossil meals and similar earths (apparent specific gravity at most 1)
2513.10.00.00|浮石|Pumice stone
2513.20.00.00|天然刚玉石榴石及其他磨料|Emery, natural corundum, garnet and other natural abrasives
2514.00.00.00|板岩（原状粗修或矩形块板）|Slate (crude, roughly trimmed or rectangular blocks or slabs)
2515.11.00.00|大理石及石灰华（原状或粗修）|Marble and travertine (crude or roughly trimmed)
2515.12.00.00|大理石及石灰华（仅切成矩形块板）|Marble and travertine (merely cut into rectangular blocks or slabs)
2516.11.00.00|花岗岩（原状或粗修）|Granite (crude or roughly trimmed)
2516.12.00.00|花岗岩（仅切成矩形块板）|Granite (merely cut into rectangular blocks or slabs)
2516.20.00.00|砂岩（原状粗修或矩形块板）|Sandstone (crude, roughly trimmed or rectangular blocks or slabs)
2516.90.00.00|其他碑用或建筑石料|Other monumental or building stone
2517.10.00.10|卵石及砾石（骨料或道砟用）|Pebbles and gravel (aggregate or ballast)
2517.10.00.20|燧石|Flint
2517.10.00.30|石灰石碎料（非25.21项下）|Limestone aggregate (other than heading 25.21)
2517.10.00.90|其他碎石及铺路石料|Other broken or crushed stone and ballast
2517.30.00.00|沥青碎石|Tarred macadam
2517.41.00.00|大理石颗粒碎屑及粉末|Marble granules, chippings and powder
2517.49.00.00|其他建筑石料颗粒碎屑及粉末|Other building-stone granules, chippings and powder
2518.10.00.00|白云石（未煅烧或烧结）|Dolomite (not calcined or sintered)
2518.20.00.00|白云石（已煅烧或烧结）|Calcined or sintered dolomite
2519.10.00.00|菱镁矿（天然碳酸镁）|Magnesite (natural magnesium carbonate)
2519.90.00.10|重烧氧化镁（纯度≥94%）|Dead-burned or sintered magnesia (purity at least 94%)
2519.90.00.90|其他氧化镁|Other magnesium oxide
2520.10.00.00|石膏及硬石膏|Gypsum and anhydrite
2520.20.00.00|熟石膏|Plasters
2521.00.00.00|石灰石熔剂及制石灰水泥用钙质石料|Limestone flux and calcareous stone for lime or cement manufacture
2522.10.00.00|生石灰|Quicklime
2522.20.00.00|熟石灰|Slaked lime
2522.30.00.00|水硬石灰|Hydraulic lime
2523.10.00.00|水泥熟料|Cement clinkers
2523.21.00.00|白色硅酸盐水泥（可人工着色）|White Portland cement (whether or not artificially coloured)
2523.29.00.00|其他硅酸盐水泥|Other Portland cement
2523.30.00.00|铝酸盐水泥|Aluminous cement
2523.90.00.30|矿渣水泥|Slag cement
2523.90.00.90|其他水硬水泥|Other hydraulic cements
2524.10.00.00|青石棉|Crocidolite
2524.90.00.00|其他石棉|Other asbestos
2525.10.00.00|原云母及云母片|Crude mica and mica sheets or splittings
2525.20.00.00|云母粉|Mica powder
2525.30.00.00|云母废料|Mica waste
2526.10.00.00|天然滑石（未破碎或制粉）|Natural steatite and talc (not crushed or powdered)
2526.20.00.00|天然滑石（已破碎或制粉）|Natural steatite and talc (crushed or powdered)
2528.00.00.00|天然硼酸盐及天然硼酸|Natural borates, concentrates and natural boric acid
2529.10.00.00|长石|Feldspar
2529.21.00.00|萤石（氟化钙≤97%）|Fluorspar (calcium fluoride at most 97%)
2529.22.00.00|萤石（氟化钙＞97%）|Fluorspar (calcium fluoride over 97%)
2529.30.00.00|白榴石霞石及霞石正长岩|Leucite, nepheline and nepheline syenite
2530.10.00.00|蛭石珍珠岩及绿泥石（未膨胀）|Vermiculite, perlite and chlorites (unexpanded)
2530.20.00.00|水镁矾及泻利盐（天然硫酸镁）|Kieserite and epsomite (natural magnesium sulphates)
2530.90.00.00|其他未列名矿物|Other mineral substances not elsewhere specified
2601.11.00.00|铁矿石及精矿（未团聚）|Iron ores and concentrates (non-agglomerated)
2601.12.00.00|铁矿石及精矿（已团聚）|Iron ores and concentrates (agglomerated)
2601.20.00.00|焙烧黄铁矿|Roasted iron pyrites
2602.00.00.00|锰矿石及精矿|Manganese ores and concentrates
2603.00.00.10|铜矿石及精矿（铜含量项）|Copper ores and concentrates (copper content)
2603.00.00.40|铜矿石及精矿（银含量项）|Copper ores and concentrates (silver content)
2603.00.00.50|铜矿石及精矿（金含量项）|Copper ores and concentrates (gold content)
2603.00.00.90|铜矿石及精矿（其他项）|Copper ores and concentrates (other)
2604.00.00.10|镍矿石及精矿（铜含量项）|Nickel ores and concentrates (copper content)
2604.00.00.20|镍矿石及精矿（镍含量项）|Nickel ores and concentrates (nickel content)
2604.00.00.90|镍矿石及精矿（其他项）|Nickel ores and concentrates (other)
2605.00.00.00|钴矿石及精矿|Cobalt ores and concentrates
2606.00.00.10|铝矿石及精矿（耐火级）|Aluminium ores and concentrates (refractory grade)
2606.00.00.90|其他铝矿石及精矿|Other aluminium ores and concentrates
2607.00.00.20|铅矿石及精矿（铅含量项）|Lead ores and concentrates (lead content)
2607.00.00.40|铅矿石及精矿（银含量项）|Lead ores and concentrates (silver content)
2607.00.00.50|铅矿石及精矿（金含量项）|Lead ores and concentrates (gold content)
2607.00.00.90|铅矿石及精矿（其他项）|Lead ores and concentrates (other)
2608.00.00.30|锌矿石及精矿（锌含量项）|Zinc ores and concentrates (zinc content)
2608.00.00.40|锌矿石及精矿（银含量项）|Zinc ores and concentrates (silver content)
2608.00.00.50|锌矿石及精矿（金含量项）|Zinc ores and concentrates (gold content)
2608.00.00.90|锌矿石及精矿（其他项）|Zinc ores and concentrates (other)
2609.00.00.00|锡矿石及精矿|Tin ores and concentrates
2610.00.00.00|铬矿石及精矿|Chromium ores and concentrates
2611.00.00.00|钨矿石及精矿|Tungsten ores and concentrates
2612.10.00.00|铀矿石及精矿|Uranium ores and concentrates
2612.20.00.00|钍矿石及精矿|Thorium ores and concentrates
2613.10.00.00|钼矿石及精矿（已焙烧）|Molybdenum ores and concentrates (roasted)
2613.90.00.00|其他钼矿石及精矿|Other molybdenum ores and concentrates
2614.00.00.00|钛矿石及精矿|Titanium ores and concentrates
2615.10.00.00|锆矿石及精矿|Zirconium ores and concentrates
2615.90.00.00|铌钽钒矿石及精矿|Niobium, tantalum or vanadium ores and concentrates
2616.10.00.20|银矿石及精矿（铅含量项）|Silver ores and concentrates (lead content)
2616.10.00.40|银矿石及精矿（银含量项）|Silver ores and concentrates (silver content)
2616.10.00.50|银矿石及精矿（金含量项）|Silver ores and concentrates (gold content)
2616.10.00.90|银矿石及精矿（其他项）|Silver ores and concentrates (other)
2616.90.00.00|其他贵金属矿石及精矿|Other precious-metal ores and concentrates
2617.10.00.00|锑矿石及精矿|Antimony ores and concentrates
2617.90.00.00|其他矿石及精矿|Other ores and concentrates
2618.00.00.00|钢铁冶炼粒状熔渣|Granulated slag from iron or steel manufacture
2619.00.00.00|钢铁冶炼其他熔渣氧化皮及废料|Other slag, dross, scalings and waste from iron or steel manufacture
2620.11.00.00|硬锌渣|Hard zinc spelter
2620.19.00.00|其他以锌为主的灰渣残料|Other mainly zinc-containing slag, ash and residues
2620.21.00.00|含铅汽油及抗爆剂淤渣|Leaded gasoline and anti-knock compound sludges
2620.29.00.00|其他以铅为主的灰渣残料|Other mainly lead-containing slag, ash and residues
2620.30.00.00|以铜为主的灰渣残料|Mainly copper-containing slag, ash and residues
2620.40.00.00|以铝为主的灰渣残料|Mainly aluminium-containing slag, ash and residues
2620.60.00.00|含砷汞铊灰渣（提取或制造化合物用）|Arsenic-, mercury- or thallium-containing residues (for extraction or compound manufacture)
2620.91.00.00|含锑铍镉铬的灰渣残料|Slag, ash and residues containing antimony, beryllium, cadmium or chromium
2620.99.00.20|以镍为主的灰渣残料|Mainly nickel-containing slag, ash and residues
2620.99.00.90|其他含金属或砷的灰渣残料|Other slag, ash and residues containing metals or arsenic
2621.10.00.00|城市垃圾焚烧灰渣|Ash and residues from municipal-waste incineration
2621.90.00.00|其他熔渣及灰（含海藻灰）|Other slag and ash (including seaweed ash)
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
assert.equal(additions.length,123);
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){assert.ok(sources[entry.code],entry.code);assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
