import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2701.11.00.30|无烟煤（蛋块炉用或坚果粒级）|Anthracite (egg, stove or nut size)
2701.11.00.40|无烟煤（荞麦粒级）|Anthracite (buckwheat size)
2701.11.00.90|其他无烟煤|Other anthracite
2701.12.00.11|冶金烟煤（高挥发分）|Metallurgical bituminous coal (high volatile)
2701.12.00.12|冶金烟煤（低挥发分）|Metallurgical bituminous coal (low volatile)
2701.12.00.91|其他烟煤（高挥发分）|Other bituminous coal (high volatile)
2701.12.00.92|其他烟煤（低挥发分）|Other bituminous coal (low volatile)
2701.19.00.10|次烟煤|Sub-bituminous coal
2701.19.00.90|其他煤|Other coal
2701.20.00.00|煤制型煤及类似固体燃料|Coal briquettes and similar manufactured solid fuels
2702.10.00.00|褐煤（未制成型）|Lignite (not agglomerated)
2702.20.00.00|褐煤（已制成型）|Agglomerated lignite
2703.00.00.00|泥煤及泥煤垫料|Peat and peat litter
2704.00.00.11|煤焦炭及半焦（燃料用）|Coal coke and semi-coke (commercially suitable as fuel)
2704.00.00.19|其他煤焦炭及半焦|Other coal coke and semi-coke
2704.00.00.90|褐煤泥煤焦炭及甑炭|Lignite or peat coke and semi-coke and retort carbon
2705.00.00.00|煤气水煤气及类似燃气|Coal gas, water gas, producer gas and similar gases
2706.00.00.00|煤焦油及其他矿物焦油|Coal tar and other mineral tars
2707.10.00.00|苯（煤焦油蒸馏及类似产品）|Benzene (coal-tar distillation and similar products)
2707.20.00.00|甲苯（煤焦油蒸馏及类似产品）|Toluene (coal-tar distillation and similar products)
2707.30.00.00|二甲苯（煤焦油蒸馏及类似产品）|Xylenes (coal-tar distillation and similar products)
2707.40.00.00|萘（煤焦油蒸馏及类似产品）|Naphthalene (coal-tar distillation and similar products)
2707.50.00.00|其他芳烃混合物（250℃馏出体积≥65%）|Other aromatic hydrocarbon mixtures (at least 65% distilled at 250 C)
2707.91.00.00|杂酚油|Creosote oils
2707.99.00.10|炭黑原料油|Carbon black feedstock
2707.99.00.90|其他煤焦油蒸馏油及类似芳香产品|Other coal-tar distillation oils and similar aromatic products
2708.10.00.00|煤焦油或矿物焦油沥青|Pitch from coal tar or other mineral tars
2708.20.00.00|沥青焦|Pitch coke
2709.00.00.30|原油（相对密度≥0.9042）|Crude petroleum oil (relative density at least 0.9042)
2709.00.00.41|天然气凝析油（相对密度＜0.9042）|Natural-gas condensate (relative density under 0.9042)
2709.00.00.42|合成原油（规定密度及低硫类）|Synthetic crude oil (specified density and low-sulphur category)
2709.00.00.49|其他原油（相对密度＜0.9042）|Other crude petroleum oil (relative density under 0.9042)
2710.12.10.00|混合低聚烯烃（轻油类）|Mixed low-polymerization alkylenes (light-oil category)
2710.12.20.00|润滑油（轻油类，零售装）|Lubricating oils (light-oil category; retail)
2710.12.90.11|含铅汽油（含航空汽油）|Leaded gasoline (including aviation spirit)
2710.12.90.14|普通无铅汽油|Regular unleaded gasoline
2710.12.90.16|高级无铅汽油|Premium unleaded gasoline
2710.12.90.19|其他汽油|Other gasoline
2710.12.90.20|石脑油型航空燃料（B型）|Naphtha-type aviation turbine fuel (Jet B)
2710.12.90.31|石脑油（油漆及清洁用）|Naphtha (painters and cleaners use)
2710.12.90.39|其他石脑油（非航空燃料）|Other naphtha (excluding aviation turbine fuel)
2710.12.90.91|石化原料油（轻油类，非气体）|Petrochemical feedstocks (light oils; not gases)
2710.12.90.92|发动机燃料调合料（轻油类）|Motor-fuel blending stock (light-oil category)
2710.12.90.93|石油烷基化油|Petroleum-derived alkylate
2710.12.90.94|天然汽油（完全源自天然气）|Natural gasoline derived wholly from natural gas
2710.12.90.99|其他轻质石油及制品|Other light petroleum oils and preparations
2710.19.10.00|规定级白矿油及特定制造用油|Specified-grade white mineral oil and specified manufacturing oils
2710.19.20.22|发动机润滑油（合成烃＞50%类）|Engine lubricating oils (over 50% synthetic-hydrocarbon category)
2710.19.20.24|汽车齿轮油（合成烃＞50%类）|Automotive gear oils (over 50% synthetic-hydrocarbon category)
2710.19.20.29|其他润滑油（合成烃＞50%类）|Other lubricating oils (over 50% synthetic-hydrocarbon category)
2710.19.20.30|润滑基础油（合成烃＞50%类）|Lubricant basestocks (over 50% synthetic-hydrocarbon category)
2710.19.20.40|石油脂及润滑脂|Petroleum greases and lubricating greases
2710.19.20.90|其他列名油品（低聚烯烃及白油等）|Other specified oils (low-polymerization alkylenes and white oils)
2710.19.30.00|加氢裂化尾油（制造润滑油液用）|Hydrocracker bottoms (for motor oils, transmission or hydraulic fluids)
2710.19.91.20|发动机润滑油（其他类，零售装）|Engine lubricating oils (other category; retail)
2710.19.91.40|汽车齿轮油（其他类，零售装）|Automotive gear oils (other category; retail)
2710.19.91.90|其他润滑油（零售装）|Other lubricating oils (retail)
2710.19.99.11|煤油型航空燃料（A型）|Kerosene-type aviation turbine fuel (Jet A)
2710.19.99.19|其他煤油及一号燃料油|Other kerosene and No. 1 fuel oil
2710.19.99.23|柴油混合燃料（含加氢可再生柴油）|Diesel blended with hydrogenation-derived renewable diesel
2710.19.99.24|内燃机柴油（含硫≤0.05%）|Diesel for internal-combustion engines (sulphur at most 0.05%)
2710.19.99.25|内燃机柴油（含硫＞0.05%）|Diesel for internal-combustion engines (sulphur over 0.05%)
2710.19.99.29|其他二号及三号燃料油|Other No. 2 and No. 3 fuel oils
2710.19.99.31|四号燃料油（含硫≤0.05%）|No. 4 fuel oil (sulphur at most 0.05%)
2710.19.99.32|四号燃料油（含硫＞0.05%）|No. 4 fuel oil (sulphur over 0.05%)
2710.19.99.33|五号燃料油|No. 5 fuel oil
2710.19.99.34|六号燃料油|No. 6 fuel oil
2710.19.99.93|加氢可再生柴油|Hydrogenation-derived renewable diesel
2710.19.99.94|其他石化原料油（非轻油及气体）|Other petrochemical feedstocks (not light oils or gases)
2710.19.99.95|其他发动机燃料调合料（非轻油类）|Other motor-fuel blending stock (not light-oil category)
2710.19.99.99|其他石油及制品（非轻油类）|Other petroleum oils and preparations (not light-oil category)
2710.20.10.00|含生物柴油润滑油（零售装）|Lubricating oils containing biodiesel (retail)
2710.20.90.00|其他含生物柴油石油制品|Other petroleum preparations containing biodiesel
2710.91.00.10|废油（多氯联苯≥50毫克/公斤）|Waste oils (PCBs at least 50 mg/kg)
2710.91.00.90|废油（含多氯三联苯或多溴联苯）|Waste oils containing PCTs or PBBs
2710.99.00.10|其他废油（37.8℃黏度≥7.44平方毫米/秒）|Other waste oils (viscosity at least 7.44 mm2/s at 37.8 C)
2710.99.00.90|其他废油及废油制品|Other waste oils and preparations
2711.11.00.00|液化天然气|Liquefied natural gas
2711.12.10.10|液化丙烷（纯度≥90%，即用容器装）|Liquefied propane (at least 90% liquid-volume purity; ready-use containers)
2711.12.10.90|其他液化丙烷（即用容器装）|Other liquefied propane (ready-use containers)
2711.12.90.10|液化丙烷（纯度≥90%，其他包装）|Liquefied propane (at least 90% liquid-volume purity; other packaging)
2711.12.90.90|其他液化丙烷（其他包装）|Other liquefied propane (other packaging)
2711.13.00.00|液化丁烷|Liquefied butanes
2711.14.00.00|液化乙烯丙烯丁烯及丁二烯|Liquefied ethylene, propylene, butylene and butadiene
2711.19.10.00|其他液化石油气及烃气（即用容器装）|Other liquefied petroleum gases and hydrocarbons (ready-use containers)
2711.19.90.10|液化乙烷（其他包装）|Liquefied ethane (other packaging)
2711.19.90.90|其他液化石油气及烃气（其他包装）|Other liquefied petroleum gases and hydrocarbons (other packaging)
2711.21.00.00|气态天然气|Natural gas in gaseous state
2711.29.00.00|其他气态石油气及烃气|Other petroleum gases and hydrocarbons in gaseous state
2712.10.00.00|凡士林|Petroleum jelly
2712.20.00.00|石蜡（含油＜0.75%）|Paraffin wax (oil content under 0.75%)
2712.90.00.10|石油微晶蜡|Microcrystalline petroleum wax
2712.90.00.90|其他矿物蜡及类似合成蜡|Other mineral waxes and similar synthetic waxes
2713.11.00.00|石油焦（未煅烧）|Petroleum coke (not calcined)
2713.12.00.00|石油焦（已煅烧）|Petroleum coke (calcined)
2713.20.00.10|铺路用沥青油（石油沥青类）|Asphaltum oil for paving (petroleum-bitumen category)
2713.20.00.90|其他石油沥青|Other petroleum bitumen
2713.90.00.00|其他石油或沥青矿物油残渣|Other residues of petroleum or bituminous-mineral oils
2714.10.00.00|沥青页岩油页岩及油砂|Bituminous shale, oil shale and tar sands
2714.90.00.00|其他天然沥青及沥青岩|Other natural bitumen, asphalt and asphaltic rocks
2715.00.00.10|沥青胶泥|Bituminous mastics
2715.00.00.20|铺路用沥青油（混合制品）|Asphaltum oil for paving (bituminous mixtures)
2715.00.00.90|其他沥青混合物|Other bituminous mixtures
2716.00.00.00|电能|Electrical energy
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
assert.equal(additions.length,104);
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){assert.ok(sources[entry.code],entry.code);assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
