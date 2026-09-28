import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2801.10.00.00|氯|Chlorine
2801.20.00.00|碘|Iodine
2801.30.00.00|氟及溴|Fluorine and bromine
2802.00.00.00|升华硫沉淀硫及胶态硫|Sublimed, precipitated and colloidal sulphur
2803.00.00.10|灯黑|Lampblack
2803.00.00.90|其他炭黑及碳|Other carbon blacks and carbon
2804.10.00.00|氢|Hydrogen
2804.21.00.00|氩|Argon
2804.29.00.10|氦|Helium
2804.29.00.90|其他稀有气体|Other rare gases
2804.30.00.00|氮|Nitrogen
2804.40.00.00|氧|Oxygen
2804.50.00.00|硼及碲|Boron and tellurium
2804.61.00.00|硅（纯度≥99.99%）|Silicon (purity at least 99.99%)
2804.69.00.00|其他硅|Other silicon
2804.70.00.00|磷|Phosphorus
2804.80.00.00|砷|Arsenic
2804.90.00.00|硒|Selenium
2805.11.00.00|金属钠|Sodium metal
2805.12.00.00|金属钙|Calcium metal
2805.19.00.00|其他碱金属或碱土金属|Other alkali or alkaline-earth metals
2805.30.00.00|稀土金属钪钇及其混合物合金|Rare-earth metals, scandium, yttrium and their mixtures or alloys
2805.40.00.00|汞|Mercury
2806.10.00.00|氯化氢及盐酸|Hydrogen chloride and hydrochloric acid
2806.20.00.00|氯磺酸|Chlorosulphuric acid
2807.00.00.00|硫酸及发烟硫酸|Sulphuric acid and oleum
2808.00.00.00|硝酸及硝硫混酸|Nitric acid and sulphonitric acids
2809.10.00.00|五氧化二磷|Diphosphorus pentaoxide
2809.20.00.11|肥料级超磷酸（五氧化二磷68%—72%）|Fertilizer-grade superphosphoric acid (68-72% P2O5)
2809.20.00.19|其他肥料级磷酸|Other fertilizer-grade phosphoric acids
2809.20.00.20|其他磷酸|Other phosphoric acids
2809.20.00.30|多磷酸|Polyphosphoric acids
2810.00.00.00|硼氧化物及硼酸|Boron oxides and boric acids
2811.11.00.00|氟化氢及氢氟酸|Hydrogen fluoride and hydrofluoric acid
2811.12.00.00|氰化氢及氢氰酸|Hydrogen cyanide and hydrocyanic acid
2811.19.00.00|其他无机酸|Other inorganic acids
2811.21.00.00|二氧化碳|Carbon dioxide
2811.22.00.10|水合二氧化硅|Hydrated silica
2811.22.00.20|硅胶|Silica gel
2811.22.00.90|其他二氧化硅|Other silicon dioxide
2811.29.00.00|其他非金属无机含氧化合物|Other inorganic oxygen compounds of non-metals
2812.11.00.00|光气（碳酰氯）|Carbonyl dichloride (phosgene)
2812.12.00.00|三氯氧磷|Phosphorus oxychloride
2812.13.00.00|三氯化磷|Phosphorus trichloride
2812.14.00.00|五氯化磷|Phosphorus pentachloride
2812.15.00.00|二氯化二硫|Sulphur monochloride
2812.16.00.00|二氯化硫|Sulphur dichloride
2812.17.00.00|亚硫酰氯|Thionyl chloride
2812.19.00.10|三氯化砷|Arsenic trichloride
2812.19.00.90|其他非金属氯化物及氯氧化物|Other non-metal chlorides and chloride oxides
2812.90.00.00|其他非金属卤化物及卤氧化物|Other non-metal halides and halide oxides
2813.10.00.00|二硫化碳|Carbon disulphide
2813.90.00.00|其他非金属硫化物及商品三硫化磷|Other non-metal sulphides and commercial phosphorus trisulphide
2814.10.00.00|无水氨|Anhydrous ammonia
2814.20.00.00|氨水|Ammonia in aqueous solution
2815.11.00.00|氢氧化钠（固体）|Sodium hydroxide (solid)
2815.12.00.00|氢氧化钠（水溶液）|Sodium hydroxide (aqueous solution)
2815.20.00.10|氢氧化钾（固体）|Potassium hydroxide (solid)
2815.20.00.20|氢氧化钾（水溶液）|Potassium hydroxide (aqueous solution)
2815.30.00.00|过氧化钠或过氧化钾|Sodium or potassium peroxides
2816.10.00.00|氢氧化镁及过氧化镁|Magnesium hydroxide and peroxide
2816.40.00.00|锶钡氧化物氢氧化物及过氧化物|Strontium or barium oxides, hydroxides and peroxides
2817.00.00.10|氧化锌（锌含量≤75%，饲料制造用）|Zinc oxide (zinc content at most 75%; feed manufacture)
2817.00.00.90|其他氧化锌及过氧化锌|Other zinc oxide and zinc peroxide
2818.10.00.00|人造刚玉|Artificial corundum
2818.20.00.10|氧化铝（炼铝用）|Alumina prepared for processing into aluminium
2818.20.00.20|活性氧化铝|Activated alumina
2818.20.00.90|其他氧化铝（非人造刚玉）|Other aluminium oxide (not artificial corundum)
2818.30.00.00|氢氧化铝|Aluminium hydroxide
2819.10.00.00|三氧化铬|Chromium trioxide
2819.90.00.00|其他铬氧化物及氢氧化物|Other chromium oxides and hydroxides
2820.10.00.00|二氧化锰|Manganese dioxide
2820.90.00.00|其他锰氧化物|Other manganese oxides
2821.10.00.00|铁氧化物及氢氧化物|Iron oxides and hydroxides
2821.20.00.00|土色料（按三氧化二铁计含铁≥70%）|Earth colours (combined iron as Fe2O3 at least 70%)
2822.00.00.00|钴氧化物及氢氧化物|Cobalt oxides and hydroxides
2823.00.00.10|二氧化钛|Titanium dioxide
2823.00.00.90|其他钛氧化物|Other titanium oxides
2824.10.00.00|一氧化铅（密陀僧及铅黄）|Lead monoxide (litharge and massicot)
2824.90.00.00|其他铅氧化物铅丹及橙铅|Other lead oxides, red lead and orange lead
2825.10.00.00|肼羟胺及其无机盐|Hydrazine, hydroxylamine and their inorganic salts
2825.20.00.00|氧化锂及氢氧化锂|Lithium oxide and hydroxide
2825.30.00.00|钒氧化物及氢氧化物|Vanadium oxides and hydroxides
2825.40.00.00|镍氧化物及氢氧化物|Nickel oxides and hydroxides
2825.50.00.00|铜氧化物及氢氧化物|Copper oxides and hydroxides
2825.60.00.00|锗氧化物及二氧化锆|Germanium oxides and zirconium dioxide
2825.70.00.00|钼氧化物及氢氧化物|Molybdenum oxides and hydroxides
2825.80.00.00|锑氧化物|Antimony oxides
2825.90.00.00|其他无机碱及金属氧化物类|Other inorganic bases and metal oxides, hydroxides or peroxides
2826.12.00.00|氟化铝|Aluminium fluoride
2826.19.00.00|其他氟化物|Other fluorides
2826.30.00.00|六氟铝酸钠（人造冰晶石）|Sodium hexafluoroaluminate (synthetic cryolite)
2826.90.00.00|其他氟硅酸盐氟铝酸盐及氟络盐|Other fluorosilicates, fluoroaluminates and complex fluorine salts
2827.10.00.00|氯化铵|Ammonium chloride
2827.20.00.10|氯化钙（干品）|Calcium chloride (dry)
2827.20.00.20|氯化钙（水溶液）|Calcium chloride (aqueous solution)
2827.31.00.00|氯化镁|Magnesium chloride
2827.32.00.00|氯化铝|Aluminium chloride
2827.35.00.00|氯化镍|Nickel chloride
2827.39.00.00|其他氯化物|Other chlorides
2827.41.00.00|铜的氯氧化物及氯氢氧化物|Copper chloride oxides and chloride hydroxides
2827.49.00.00|其他氯氧化物及氯氢氧化物|Other chloride oxides and chloride hydroxides
2827.51.00.00|溴化钠或溴化钾|Sodium or potassium bromides
2827.59.00.00|其他溴化物及溴氧化物|Other bromides and bromide oxides
2827.60.00.00|碘化物及碘氧化物|Iodides and iodide oxides
2828.10.00.00|次氯酸钙及漂白粉|Calcium hypochlorites and commercial calcium hypochlorite
2828.90.00.00|其他次氯酸盐亚氯酸盐及次溴酸盐|Other hypochlorites, chlorites and hypobromites
2829.11.00.00|氯酸钠|Sodium chlorate
2829.19.00.00|其他氯酸盐|Other chlorates
2829.90.00.00|高氯酸盐及溴碘含氧酸盐|Perchlorates, bromates, perbromates, iodates and periodates
2830.10.00.00|硫化钠|Sodium sulphides
2830.90.00.00|其他硫化物及多硫化物|Other sulphides and polysulphides
2831.10.00.00|连二亚硫酸钠及次硫酸钠|Sodium dithionites and sulphoxylates
2831.90.00.00|其他连二亚硫酸盐及次硫酸盐|Other dithionites and sulphoxylates
2832.10.00.00|亚硫酸钠|Sodium sulphites
2832.20.00.00|其他亚硫酸盐|Other sulphites
2832.30.00.00|硫代硫酸盐|Thiosulphates
2833.11.00.00|硫酸钠|Disodium sulphate
2833.19.00.00|其他钠的硫酸盐|Other sodium sulphates
2833.21.00.00|硫酸镁|Magnesium sulphate
2833.22.00.00|硫酸铝|Aluminium sulphate
2833.24.00.00|硫酸镍|Nickel sulphate
2833.25.00.10|硫酸铜（二价铜）|Cupric sulphate
2833.25.00.90|其他铜的硫酸盐|Other copper sulphates
2833.27.00.00|硫酸钡|Barium sulphate
2833.29.00.00|其他硫酸盐|Other sulphates
2833.30.00.00|矾类|Alums
2833.40.00.10|过硫酸铵|Ammonium peroxodisulphate
2833.40.00.20|过硫酸钾|Potassium peroxodisulphate
2833.40.00.30|过硫酸钠|Sodium peroxodisulphate
2833.40.00.90|其他过硫酸盐|Other peroxosulphates
2834.10.00.00|亚硝酸盐|Nitrites
2834.21.00.00|硝酸钾|Potassium nitrate
2834.29.00.00|其他硝酸盐|Other nitrates
2835.10.00.00|次磷酸盐及亚磷酸盐|Hypophosphites and phosphites
2835.22.00.00|磷酸一钠及磷酸二钠|Monosodium or disodium phosphates
2835.24.00.00|磷酸钾盐|Potassium phosphates
2835.25.00.00|磷酸氢钙|Calcium hydrogenorthophosphate
2835.26.00.00|其他磷酸钙盐|Other calcium phosphates
2835.29.00.00|其他磷酸盐|Other phosphates
2835.31.00.10|三聚磷酸钠（食品制造用）|Sodium tripolyphosphate (for food manufacture)
2835.31.00.90|三聚磷酸钠（其他用途）|Sodium tripolyphosphate (other uses)
2835.39.00.10|酸式焦磷酸钠（食品制造用）|Sodium acid pyrophosphate (for food manufacture)
2835.39.00.90|其他多磷酸盐|Other polyphosphates
2836.20.00.10|碳酸钠（矿物精炼用）|Sodium carbonate (for mineral refining)
2836.20.00.90|碳酸钠（其他用途）|Sodium carbonate (other uses)
2836.30.00.00|碳酸氢钠（小苏打）|Sodium bicarbonate
2836.40.00.00|碳酸钾盐|Potassium carbonates
2836.50.00.00|碳酸钙|Calcium carbonate
2836.60.00.00|碳酸钡|Barium carbonate
2836.91.00.00|碳酸锂盐|Lithium carbonates
2836.92.00.00|碳酸锶|Strontium carbonate
2836.99.00.00|其他碳酸盐及过碳酸盐|Other carbonates and peroxocarbonates
2837.11.00.00|氰化钠及氧氰化钠|Sodium cyanides and cyanide oxides
2837.19.00.00|其他氰化物及氧氰化物|Other cyanides and cyanide oxides
2837.20.00.00|氰络合物|Complex cyanides
2839.11.00.00|偏硅酸钠|Sodium metasilicates
2839.19.00.00|其他硅酸钠|Other sodium silicates
2839.90.00.00|其他硅酸盐及商品碱金属硅酸盐|Other silicates and commercial alkali-metal silicates
2840.11.00.00|无水四硼酸钠|Anhydrous disodium tetraborate
2840.19.00.00|其他精制硼砂|Other refined borax
2840.20.00.00|其他硼酸盐|Other borates
2840.30.00.00|过硼酸盐|Peroxoborates
2841.30.00.00|重铬酸钠|Sodium dichromate
2841.50.00.00|其他铬酸盐重铬酸盐及过铬酸盐|Other chromates, dichromates and peroxochromates
2841.61.00.00|高锰酸钾|Potassium permanganate
2841.69.00.00|其他亚锰酸盐锰酸盐及高锰酸盐|Other manganites, manganates and permanganates
2841.70.00.00|钼酸盐|Molybdates
2841.80.00.00|钨酸盐|Tungstates
2841.90.00.00|其他金属含氧酸盐及过氧酸盐|Other salts of oxometallic or peroxometallic acids
2842.10.00.00|硅酸复盐及络盐（含铝硅酸盐）|Double or complex silicates (including aluminosilicates)
2842.90.00.00|其他无机酸盐及过氧酸盐（非叠氮化物）|Other inorganic acid or peroxoacid salts (excluding azides)
2843.10.00.00|胶态贵金属|Colloidal precious metals
2843.21.00.00|硝酸银|Silver nitrate
2843.29.00.00|其他银化合物|Other silver compounds
2843.30.00.00|金化合物|Gold compounds
2843.90.00.00|其他贵金属化合物及汞齐|Other precious-metal compounds and amalgams
2844.10.00.00|天然铀及其化合物混合制品|Natural uranium, compounds and containing products
2844.20.00.00|富集铀及钚的化合物和混合制品|Enriched uranium, plutonium, compounds and containing products
2844.30.00.00|贫化铀及钍的化合物和混合制品|Depleted uranium, thorium, compounds and containing products
2844.41.00.00|氚及其化合物和混合制品|Tritium, compounds and containing products
2844.42.00.00|列名放射性同位素及其制品（锕镭钋等）|Specified radioactive isotopes and containing products (actinium, radium, polonium and others)
2844.43.00.11|仅钴60放射性元素同位素及化合物|Elements, isotopes and compounds with cobalt-60 radioactivity only
2844.43.00.19|其他放射性元素同位素及化合物|Other radioactive elements, isotopes and compounds
2844.43.00.90|其他放射性合金分散体及混合制品|Other radioactive alloys, dispersions and containing products
2844.44.00.00|放射性残渣|Radioactive residues
2844.50.00.00|核反应堆乏燃料元件|Spent irradiated nuclear-reactor fuel elements
2845.10.00.00|重水（氧化氘）|Heavy water (deuterium oxide)
2845.20.00.00|富集硼10的硼及其化合物|Boron enriched in boron-10 and its compounds
2845.30.00.00|富集锂6的锂及其化合物|Lithium enriched in lithium-6 and its compounds
2845.40.00.00|氦3|Helium-3
2845.90.00.00|其他非放射性同位素及其化合物|Other non-radioactive isotopes and their compounds
2846.10.00.00|铈化合物|Cerium compounds
2846.90.00.00|其他稀土钇钪化合物|Other rare-earth, yttrium or scandium compounds
2847.00.00.10|过氧化氢（未用尿素固化）|Hydrogen peroxide (not solidified with urea)
2847.00.00.20|过氧化尿素|Urea hydrogen peroxide
2849.10.00.00|碳化钙|Calcium carbide
2849.20.00.00|碳化硅|Silicon carbide
2849.90.00.10|碳化钨|Tungsten carbide
2849.90.00.90|其他碳化物|Other carbides
2850.00.00.00|氢化物氮化物叠氮化物硅化物及硼化物|Hydrides, nitrides, azides, silicides and borides
2852.10.00.00|汞化合物（化学成分确定，非汞齐）|Chemically defined mercury compounds (excluding amalgams)
2852.90.10.00|白蛋白汞及核蛋白汞|Mercury albuminate and mercury nucleoproteids
2852.90.90.00|其他汞化合物（非汞齐）|Other mercury compounds (excluding amalgams)
2853.10.00.00|氯化氰|Cyanogen chloride
2853.90.00.00|其他无机化合物压缩空气及非贵金属汞齐|Other inorganic compounds, compressed air and non-precious-metal amalgams
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
assert.equal(additions.length,206);
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){assert.ok(sources[entry.code],entry.code);assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
