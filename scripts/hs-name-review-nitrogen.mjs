import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2926.10.00.00|丙烯腈|Acrylonitrile
2926.20.00.00|双氰胺（1-氰基胍）|1-Cyanoguanidine (dicyandiamide)
2926.30.00.00|芬普雷司及其盐；美沙酮中间体|Fenproporex and its salts; methadone intermediate
2926.40.00.00|α-苯基乙酰乙腈|Alpha-phenylacetoacetonitrile
2926.90.00.00|其他腈基化合物|Other nitrile-function compounds
2927.00.00.00|重氮偶氮及氧化偶氮化合物|Diazo-, azo- and azoxy-compounds
2928.00.00.20|肼及羟胺的芳香族有机衍生物|Aromatic organic derivatives of hydrazine or hydroxylamine
2928.00.00.90|肼及羟胺的其他有机衍生物|Other organic derivatives of hydrazine or hydroxylamine
2929.10.00.10|甲苯二异氰酸酯|Toluene diisocyanates
2929.10.00.20|二苯基甲烷-4,4'-二异氰酸酯|Diphenylmethane-4,4'-diisocyanate
2929.10.00.90|其他异氰酸酯|Other isocyanates
2929.90.00.11|N,N-二甲氨基膦酰二氯|N,N-Dimethylphosphoramidic dichloride
2929.90.00.19|其他列名二烷氨基膦酰二卤|Other specified N,N-dialkylphosphoramidic dihalides
2929.90.00.20|列名二烷氨基膦酸二烷酯|Specified dialkyl N,N-dialkylphosphoramidates
2929.90.00.90|其他含氮官能基化合物|Other nitrogen-function compounds
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
const holds=['2929.90.00.30','2929.90.00.40'];
const expected=rows.filter(r=>Number(r.hs_code.slice(0,4))>=2926&&Number(r.hs_code.slice(0,4))<=2929&&!/[\u3400-\u9fff]/.test(r.name_zh)&&sources[r.hs_code]&&!holds.includes(r.hs_code));
assert.deepEqual(additions.map(x=>x.code).sort(),expected.map(x=>x.hs_code).sort());
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
