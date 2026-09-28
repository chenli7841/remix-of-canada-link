import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2905.11.00.00|甲醇|Methanol
2905.12.00.10|正丙醇|Propan-1-ol
2905.12.00.20|异丙醇|Propan-2-ol
2905.13.00.00|正丁醇|Butan-1-ol
2905.14.00.00|其他丁醇|Other butanols
2905.16.00.20|2-乙基己醇|2-Ethyl-1-hexanol
2905.16.00.90|其他辛醇及其异构体|Other octanols and isomers
2905.17.00.00|月桂醇鲸蜡醇及硬脂醇|Lauryl, cetyl and stearyl alcohols
2905.19.00.50|3,3-二甲基丁-2-醇|3,3-Dimethylbutan-2-ol
2905.19.00.90|其他饱和一元无环醇|Other saturated acyclic monohydric alcohols
2905.22.00.00|无环萜烯醇|Acyclic terpene alcohols
2905.29.00.00|其他不饱和一元无环醇|Other unsaturated acyclic monohydric alcohols
2905.31.00.00|乙二醇|Ethylene glycol
2905.32.00.00|1,2-丙二醇|Propane-1,2-diol
2905.39.00.00|其他无环二元醇|Other acyclic diols
2905.41.00.00|三羟甲基丙烷|Trimethylolpropane
2905.42.00.00|季戊四醇|Pentaerythritol
2905.43.00.00|甘露醇|Mannitol
2905.44.00.00|山梨醇|Sorbitol
2905.45.00.00|甘油|Glycerol
2905.49.00.10|甘油酯（与29.04项下酸形成）|Glycerol esters formed with acids of heading 29.04
2905.49.00.90|其他无环多元醇|Other acyclic polyhydric alcohols
2905.59.00.00|其他无环醇卤化磺化硝化衍生物|Other halogenated, sulphonated, nitrated or nitrosated acyclic alcohols
2906.11.00.00|薄荷醇|Menthol
2906.12.00.00|环己醇及甲基二甲基环己醇|Cyclohexanol, methylcyclohexanols and dimethylcyclohexanols
2906.13.00.00|甾醇及肌醇|Sterols and inositols
2906.19.00.00|其他脂环醇及其衍生物|Other cyclanic, cyclenic or cycloterpenic alcohols and derivatives
2906.21.00.00|苯甲醇|Benzyl alcohol
2906.29.00.00|其他芳香醇及其衍生物|Other aromatic alcohols and derivatives
2907.11.00.00|苯酚及其盐|Phenol and its salts
2907.12.00.00|甲酚及其盐|Cresols and their salts
2907.13.00.00|辛基酚壬基酚及异构体和盐|Octylphenol, nonylphenol, their isomers and salts
2907.15.00.00|萘酚及其盐|Naphthols and their salts
2907.19.00.00|其他一元酚|Other monophenols
2907.21.00.00|间苯二酚及其盐|Resorcinol and its salts
2907.22.00.00|对苯二酚及其盐|Hydroquinone and its salts
2907.23.00.00|双酚A及其盐|Bisphenol A and its salts
2907.29.00.00|其他多元酚及酚醇|Other polyphenols and phenol-alcohols
2908.11.00.00|五氯苯酚|Pentachlorophenol
2908.19.00.00|其他卤代酚及酚醇和盐|Other halogen-substituted phenols, phenol-alcohols and salts
2908.91.00.00|地乐酚及其盐|Dinoseb and its salts
2908.92.00.00|4,6-二硝基邻甲酚及其盐|4,6-Dinitro-o-cresol and its salts
2908.99.00.00|其他酚及酚醇磺化硝化衍生物|Other sulphonated, nitrated or nitrosated phenol and phenol-alcohol derivatives
2909.11.00.00|乙醚|Diethyl ether
2909.19.00.00|其他无环醚及其衍生物|Other acyclic ethers and derivatives
2909.20.00.00|脂环醚及其衍生物|Cyclanic, cyclenic or cycloterpenic ethers and derivatives
2909.30.00.20|十溴二苯醚|Decabromodiphenyl ether
2909.30.00.90|其他芳香醚及其衍生物|Other aromatic ethers and derivatives
2909.41.00.00|二甘醇|Diethylene glycol
2909.43.00.00|乙二醇或二甘醇单丁醚|Ethylene glycol or diethylene glycol monobutyl ethers
2909.44.00.00|其他乙二醇或二甘醇单烷基醚|Other ethylene glycol or diethylene glycol monoalkyl ethers
2909.49.00.10|三甘醇|Triethylene glycol
2909.49.00.90|其他醚醇及其衍生物|Other ether-alcohols and derivatives
2909.50.00.00|醚酚醚醇酚及其衍生物|Ether-phenols, ether-alcohol-phenols and derivatives
2909.60.00.00|醇醚缩醛及酮过氧化物和衍生物|Alcohol, ether, acetal, hemiacetal and ketone peroxides and derivatives
2910.10.00.00|环氧乙烷|Ethylene oxide
2910.20.00.00|环氧丙烷|Propylene oxide
2910.30.00.00|环氧氯丙烷|Epichlorohydrin
2910.40.00.00|狄氏剂|Dieldrin
2910.50.00.00|异狄氏剂|Endrin
2910.90.00.00|其他三元环环氧化合物及衍生物|Other three-membered-ring epoxides and derivatives
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
const expected=rows.filter(r=>Number(r.hs_code.slice(0,4))>=2905&&Number(r.hs_code.slice(0,4))<=2910&&!/[\u3400-\u9fff]/.test(r.name_zh)&&sources[r.hs_code]&&r.hs_code!=='2905.51.00.00');
assert.deepEqual(additions.map(x=>x.code).sort(),expected.map(x=>x.hs_code).sort());
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
