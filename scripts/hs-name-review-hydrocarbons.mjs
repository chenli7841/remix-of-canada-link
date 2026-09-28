import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2901.10.00.11|正丁烷|n-Butane
2901.10.00.12|异丁烷（2-甲基丙烷）|Isobutane (2-methylpropane)
2901.10.00.20|己烷类|Hexanes
2901.10.00.30|戊烷类|Pentanes
2901.10.00.40|乙烷|Ethane
2901.10.00.90|其他饱和无环烃|Other saturated acyclic hydrocarbons
2901.21.00.00|乙烯|Ethylene
2901.22.00.00|丙烯|Propylene
2901.23.00.10|1-丁烯|1-Butene
2901.23.00.20|异丁烯|Isobutene
2901.23.00.90|其他丁烯及其异构体|Other butenes and isomers
2901.24.00.00|1,3-丁二烯及异戊二烯|Buta-1,3-diene and isoprene
2901.29.00.11|1-辛烯（未混合）|1-Octene (unmixed)
2901.29.00.12|1-己烯（未混合）|1-Hexene (unmixed)
2901.29.00.19|其他直链α烯烃（未混合）|Other linear alpha olefins (unmixed)
2901.29.00.91|壬烯类|Nonenes
2901.29.00.99|其他不饱和无环烃|Other unsaturated acyclic hydrocarbons
2902.11.00.00|环己烷|Cyclohexane
2902.19.00.00|其他环烷烃环烯烃及环萜烯|Other cyclanes, cyclenes and cycloterpenes
2902.20.00.00|苯|Benzene
2902.30.00.00|甲苯|Toluene
2902.41.00.00|邻二甲苯|o-Xylene
2902.42.00.00|间二甲苯|m-Xylene
2902.43.00.00|对二甲苯|p-Xylene
2902.44.00.00|混合二甲苯异构体|Mixed xylene isomers
2902.50.00.00|苯乙烯|Styrene
2902.60.00.00|乙苯|Ethylbenzene
2902.70.00.00|异丙苯|Cumene
2902.90.00.30|萘|Naphthalene
2902.90.00.90|其他环烃|Other cyclic hydrocarbons
2903.11.00.00|氯甲烷及氯乙烷|Chloromethane and chloroethane
2903.12.00.00|二氯甲烷|Dichloromethane
2903.13.00.00|三氯甲烷（氯仿）|Chloroform (trichloromethane)
2903.14.00.00|四氯化碳|Carbon tetrachloride
2903.15.00.00|1,2-二氯乙烷|1,2-Dichloroethane
2903.19.00.00|其他饱和无环烃氯化衍生物|Other saturated chlorinated acyclic hydrocarbons
2903.21.00.00|氯乙烯|Vinyl chloride
2903.22.00.00|三氯乙烯|Trichloroethylene
2903.23.00.00|四氯乙烯|Tetrachloroethylene
2903.29.00.00|其他不饱和无环烃氯化衍生物|Other unsaturated chlorinated acyclic hydrocarbons
2903.41.00.00|三氟甲烷（HFC-23）|Trifluoromethane (HFC-23)
2903.42.00.00|二氟甲烷（HFC-32）|Difluoromethane (HFC-32)
2903.43.00.00|氟甲烷及二氟乙烷（HFC-41、152、152a）|Fluoromethane and difluoroethanes (HFC-41, 152, 152a)
2903.44.00.00|五氟乙烷及三氟乙烷（HFC-125、143a、143）|Pentafluoroethane and trifluoroethanes (HFC-125, 143a, 143)
2903.45.00.00|四氟乙烷（HFC-134a、134）|Tetrafluoroethanes (HFC-134a, 134)
2903.46.00.00|七氟丙烷及六氟丙烷（列名HFC类）|Heptafluoropropane and hexafluoropropanes (specified HFCs)
2903.47.00.00|五氟丙烷（HFC-245fa、245ca）|Pentafluoropropanes (HFC-245fa, 245ca)
2903.48.00.00|五氟丁烷及十氟戊烷（列名HFC类）|Pentafluorobutane and decafluoropentane (specified HFCs)
2903.49.00.00|其他饱和无环烃氟化衍生物|Other saturated fluorinated acyclic hydrocarbons
2903.51.00.00|四氟丙烯及六氟丁烯（列名HFO类）|Tetrafluoropropenes and hexafluorobutene (specified HFOs)
2903.59.00.20|1,1,3,3,3-五氟-2-三氟甲基丙-1-烯|1,1,3,3,3-Pentafluoro-2-(trifluoromethyl)prop-1-ene
2903.59.00.90|其他不饱和无环烃氟化衍生物|Other unsaturated fluorinated acyclic hydrocarbons
2903.61.00.00|溴甲烷|Methyl bromide
2903.62.00.00|1,2-二溴乙烷|1,2-Dibromoethane
2903.69.00.00|其他无环烃溴化或碘化衍生物|Other brominated or iodinated acyclic hydrocarbons
2903.71.00.00|一氯二氟甲烷（HCFC-22）|Chlorodifluoromethane (HCFC-22)
2903.72.00.00|二氯三氟乙烷（HCFC-123）|Dichlorotrifluoroethanes (HCFC-123)
2903.73.00.00|二氯一氟乙烷（HCFC-141、141b）|Dichlorofluoroethanes (HCFC-141, 141b)
2903.74.00.00|一氯二氟乙烷（HCFC-142、142b）|Chlorodifluoroethanes (HCFC-142, 142b)
2903.75.00.00|二氯五氟丙烷（HCFC-225类）|Dichloropentafluoropropanes (HCFC-225 family)
2903.76.00.00|溴氟卤代烃（哈龙1211、1301、2402）|Brominated halocarbons (Halon-1211, 1301, 2402)
2903.77.00.00|其他仅含氟氯全卤代无环烃|Other acyclic hydrocarbons perhalogenated only with fluorine and chlorine
2903.78.00.00|其他全卤代无环烃（含不同卤素）|Other perhalogenated acyclic hydrocarbons (with different halogens)
2903.79.00.00|其他混合卤代无环烃|Other mixed-halogen acyclic hydrocarbon derivatives
2903.81.00.00|六氯环己烷（含林丹）|Hexachlorocyclohexane (including lindane)
2903.82.00.00|艾氏剂氯丹及七氯|Aldrin, chlordane and heptachlor
2903.83.00.00|灭蚁灵|Mirex
2903.89.00.10|六溴环十二烷|Hexabromocyclododecanes
2903.89.00.90|其他脂环烃卤化衍生物|Other halogenated cyclanic, cyclenic or cycloterpenic hydrocarbons
2903.91.00.00|氯苯邻二氯苯及对二氯苯|Chlorobenzene, o-dichlorobenzene and p-dichlorobenzene
2903.92.00.00|六氯苯及滴滴涕|Hexachlorobenzene and DDT
2903.93.00.00|五氯苯|Pentachlorobenzene
2903.94.00.00|六溴联苯|Hexabromobiphenyls
2903.99.00.00|其他芳香烃卤化衍生物|Other halogenated aromatic hydrocarbons
2904.10.00.00|仅含磺基烃衍生物及其盐和乙酯|Hydrocarbon derivatives containing only sulpho groups, their salts and ethyl esters
2904.20.00.00|仅含硝基或亚硝基烃衍生物|Hydrocarbon derivatives containing only nitro or nitroso groups
2904.31.00.00|全氟辛烷磺酸|Perfluorooctane sulphonic acid
2904.32.00.00|全氟辛烷磺酸铵|Ammonium perfluorooctane sulphonate
2904.33.00.00|全氟辛烷磺酸锂|Lithium perfluorooctane sulphonate
2904.34.00.00|全氟辛烷磺酸钾|Potassium perfluorooctane sulphonate
2904.35.00.00|其他全氟辛烷磺酸盐|Other perfluorooctane sulphonate salts
2904.36.00.00|全氟辛烷磺酰氟|Perfluorooctane sulphonyl fluoride
2904.91.00.00|三氯硝基甲烷（氯化苦）|Trichloronitromethane (chloropicrin)
2904.99.00.00|其他磺化硝化或亚硝化烃衍生物|Other sulphonated, nitrated or nitrosated hydrocarbon derivatives
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
const expected=rows.filter(r=>/^290[1-4]/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh)&&sources[r.hs_code]);
assert.deepEqual(additions.map(x=>x.code).sort(),expected.map(x=>x.hs_code).sort());
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
