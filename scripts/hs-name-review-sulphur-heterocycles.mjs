import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2930.10.00.00|2-(N,N-二甲氨基)乙硫醇|2-(N,N-Dimethylamino)ethanethiol
2930.20.00.00|硫代及二硫代氨基甲酸酯|Thiocarbamates and dithiocarbamates
2930.30.00.00|一硫化二硫化及四硫化秋兰姆|Thiuram mono-, di- or tetrasulphides
2930.40.00.00|蛋氨酸（甲硫氨酸）|Methionine
2930.60.00.00|2-(N,N-二乙氨基)乙硫醇|2-(N,N-Diethylamino)ethanethiol
2930.70.00.00|硫代二甘醇|Thiodiglycol (bis(2-hydroxyethyl)sulfide)
2930.80.00.00|涕灭威敌菌丹及甲胺磷|Aldicarb, captafol and methamidophos
2930.90.00.18|其他列名二烷氨基乙硫醇及其质子化盐|Other specified N,N-dialkylaminoethane-2-thiols and protonated salts
2930.90.00.19|其他硫醇|Other thiols
2930.90.00.20|蛋氨酸衍生物及类似物|Methionine derivatives and analogues
2930.90.00.60|甲拌磷|Phorate
2930.90.00.70|O,O-二乙基-S-[2-(二乙氨基)乙基]硫代磷酸酯及其盐|O,O-Diethyl S-[2-(diethylamino)ethyl]phosphorothioate and its alkylated or protonated salts
2930.90.00.94|其他有机硫化合物（含仅与一个列名烷基碳键合的磷原子）|Other organo-sulphur compounds with phosphorus bonded to one specified alkyl group and no further carbon atoms
2930.90.00.99|其他未列名有机硫化合物|Other organo-sulphur compounds, not elsewhere specified
2931.10.00.00|四甲基铅及四乙基铅|Tetramethyl lead and tetraethyl lead
2931.20.00.00|三丁基锡化合物|Tributyltin compounds
2931.41.00.00|甲基膦酸二甲酯|Dimethyl methylphosphonate
2931.42.00.00|丙基膦酸二甲酯|Dimethyl propylphosphonate
2931.43.00.00|乙基膦酸二乙酯|Diethyl ethylphosphonate
2931.44.00.00|甲基膦酸|Methylphosphonic acid
2931.45.00.00|甲基膦酸与脒基脲的盐（1:1）|Salt of methylphosphonic acid and (aminoiminomethyl)urea (1:1)
2931.49.00.10|甲基亚膦酸丁酯|Butyl methylphosphinate
2931.49.00.20|甲基膦酸双(1-甲基戊基)酯|Bis(1-methylpentyl) methylphosphonate
2931.49.00.91|其他非卤化有机磷衍生物（含仅与一个列名烷基碳键合的磷原子）|Other non-halogenated organo-phosphorous derivatives with phosphorus bonded to one specified alkyl group and no further carbon atoms
2931.49.00.99|其他未列名非卤化有机磷衍生物|Other non-halogenated organo-phosphorous derivatives, not elsewhere specified
2931.51.00.00|甲基膦酰二氯|Methylphosphonic dichloride
2931.52.00.00|丙基膦酰二氯|Propylphosphonic dichloride
2931.54.00.00|敌百虫|Trichlorfon
2931.59.00.91|其他卤化有机磷衍生物（含仅与一个列名烷基碳键合的磷原子）|Other halogenated organo-phosphorous derivatives with phosphorus bonded to one specified alkyl group and no further carbon atoms
2931.59.00.99|其他未列名卤化有机磷衍生物|Other halogenated organo-phosphorous derivatives, not elsewhere specified
2931.90.00.10|三乙基铝|Triethylaluminum
2931.90.00.20|草甘膦及其盐|N-(Phosphonomethyl)glycine (glyphosate) and its salts
2931.90.00.30|有机硅化合物|Organo-silicon compounds
2931.90.00.90|其他有机无机化合物|Other organo-inorganic compounds
2932.11.00.00|四氢呋喃|Tetrahydrofuran
2932.12.00.00|糠醛|2-Furaldehyde (furfural)
2932.13.00.00|糠醇及四氢糠醇|Furfuryl alcohol and tetrahydrofurfuryl alcohol
2932.14.00.00|三氯蔗糖|Sucralose
2932.19.00.00|其他含非稠合呋喃环的含氧杂环化合物|Other oxygen heterocyclic compounds with an unfused furan ring
2932.20.00.00|内酯|Lactones
2932.91.00.00|异黄樟素|Isosafrole
2932.92.00.00|1-(1,3-苯并二氧杂环戊烯-5-基)丙-2-酮|1-(1,3-Benzodioxol-5-yl)propan-2-one
2932.93.00.00|胡椒醛|Piperonal
2932.94.00.00|黄樟素|Safrole
2932.95.00.00|四氢大麻酚（所有异构体）|Tetrahydrocannabinols (all isomers)
2932.96.00.00|克百威|Carbofuran
2932.99.00.00|其他仅含氧杂原子的杂环化合物|Other heterocyclic compounds with oxygen hetero-atoms only
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
const holds=['2930.90.00.50','2931.46.00.00','2931.47.00.00','2931.48.00.00','2931.53.00.00','2931.59.00.10','2931.59.00.20'];
const expected=rows.filter(r=>Number(r.hs_code.slice(0,4))>=2930&&Number(r.hs_code.slice(0,4))<=2932&&!/[\u3400-\u9fff]/.test(r.name_zh)&&sources[r.hs_code]&&!holds.includes(r.hs_code));
assert.deepEqual(additions.map(x=>x.code).sort(),expected.map(x=>x.hs_code).sort());
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
