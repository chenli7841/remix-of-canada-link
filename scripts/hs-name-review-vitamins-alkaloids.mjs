import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2935.10.00.00|N-甲基全氟辛基磺酰胺|N-Methylperfluorooctane sulphonamide
2935.20.00.00|N-乙基全氟辛基磺酰胺|N-Ethylperfluorooctane sulphonamide
2935.30.00.00|N-乙基-N-(2-羟乙基)全氟辛基磺酰胺|N-Ethyl-N-(2-hydroxyethyl)perfluorooctane sulphonamide
2935.40.00.00|N-(2-羟乙基)-N-甲基全氟辛基磺酰胺|N-(2-Hydroxyethyl)-N-methylperfluorooctane sulphonamide
2935.50.00.00|其他全氟辛基磺酰胺|Other perfluorooctane sulphonamides
2935.90.00.00|其他磺酰胺|Other sulphonamides
2936.29.00.10|其他维生素及其衍生物（未混合，食品饮料制造用）|Other vitamins and derivatives (unmixed, for human food or beverage manufacture)
2936.29.00.60|烟酸及其衍生物（未混合，非上述食品饮料用途）|Nicotinic acid and derivatives (unmixed, other than specified food or beverage use)
2936.29.00.90|其他未列名维生素及其衍生物（未混合，其他用途）|Other unspecified vitamins and derivatives (unmixed, other uses)
2936.90.00.10|其他维生素原及维生素制品（含混合物，食品饮料制造用）|Other provitamin and vitamin products including mixtures (for human food or beverage manufacture)
2936.90.00.90|其他维生素原及维生素制品（含混合物，其他用途）|Other provitamin and vitamin products including mixtures (other uses)
2937.11.00.00|生长激素及其衍生物和结构类似物|Somatotropin, derivatives and structural analogues
2937.12.00.00|胰岛素及其盐|Insulin and its salts
2937.19.00.00|其他多肽蛋白质及糖蛋白激素及其衍生物和类似物|Other polypeptide, protein and glycoprotein hormones, derivatives and structural analogues
2937.21.00.00|可的松氢化可的松泼尼松及泼尼松龙|Cortisone, hydrocortisone, prednisone and prednisolone
2937.22.00.10|倍他米松|Betamethasone
2937.22.00.90|其他皮质甾类激素卤化衍生物|Other halogenated corticosteroidal hormone derivatives
2937.23.00.00|雌激素及孕激素|Oestrogens and progestogens
2937.29.00.00|其他甾类激素及其衍生物和结构类似物|Other steroidal hormones, derivatives and structural analogues
2937.50.00.00|前列腺素血栓烷白三烯及其衍生物和结构类似物|Prostaglandins, thromboxanes, leukotrienes, derivatives and structural analogues
2937.90.00.00|其他激素及其衍生物和主要作激素用的甾类|Other hormones and derivatives; other steroids used primarily as hormones
2938.10.00.00|芦丁及其衍生物|Rutoside (rutin) and its derivatives
2938.90.00.00|其他糖苷及其盐醚酯和衍生物|Other glycosides, salts, ethers, esters and derivatives
2939.11.00.00|罂粟秆浓缩物及列名鸦片生物碱衍生物和盐|Poppy straw concentrates; specified opium alkaloids, derivatives and salts
2939.19.00.00|其他鸦片生物碱及其衍生物和盐|Other opium alkaloids, derivatives and salts
2939.20.00.00|金鸡纳生物碱及其衍生物和盐|Cinchona alkaloids, derivatives and salts
2939.30.00.00|咖啡因及其盐|Caffeine and its salts
2939.41.00.00|麻黄碱及其盐|Ephedrine and its salts
2939.42.00.00|伪麻黄碱及其盐|Pseudoephedrine and its salts
2939.43.00.00|去甲伪麻黄碱及其盐|Cathine and its salts
2939.44.00.00|去甲麻黄碱及其盐|Norephedrine and its salts
2939.45.00.00|甲基苯丙胺及左旋体外消旋体和盐|Metamfetamine, levometamfetamine, metamfetamine racemate and their salts
2939.49.00.00|其他麻黄生物碱及其衍生物和盐|Other ephedra alkaloids, derivatives and salts
2939.51.00.00|芬乙茶碱及其盐|Fenetylline and its salts
2939.59.00.00|其他茶碱氨茶碱及其衍生物和盐|Other theophylline, aminophylline, derivatives and salts
2939.61.00.00|麦角新碱及其盐|Ergometrine and its salts
2939.62.00.00|麦角胺及其盐|Ergotamine and its salts
2939.63.00.00|麦角酸及其盐|Lysergic acid and its salts
2939.69.00.00|其他麦角生物碱及其衍生物和盐|Other rye ergot alkaloids, derivatives and salts
2939.72.00.00|可卡因芽子碱及其盐酯和其他衍生物|Cocaine, ecgonine, salts, esters and other derivatives
2939.79.00.00|其他植物源生物碱及其衍生物|Other vegetal-origin alkaloids and derivatives
2939.80.00.00|其他非植物源生物碱及其衍生物|Other non-vegetal-origin alkaloids and derivatives
2940.00.00.00|其他化学纯糖及糖醚缩醛酯和盐（列名糖及相关税目产品除外）|Other chemically pure sugars, sugar ethers, acetals, esters and salts (excluding specified sugars and headings)
2941.10.00.30|阿莫西林三水合物|Amoxicillin trihydrate
2941.10.00.90|其他青霉素及含青霉烷酸结构的衍生物和盐|Other penicillins, derivatives with a penicillanic acid structure and salts
2941.20.00.00|链霉素及其衍生物和盐|Streptomycins, derivatives and salts
2941.30.00.00|四环素及其衍生物和盐|Tetracyclines, derivatives and salts
2941.40.00.00|氯霉素及其衍生物和盐|Chloramphenicol, derivatives and salts
2941.50.00.00|红霉素及其衍生物和盐|Erythromycin, derivatives and salts
2941.90.00.90|其他未列名抗生素|Other antibiotics, not elsewhere specified
2942.00.00.00|其他有机化合物|Other organic compounds
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
const vitamins=[['21','维生素A','Vitamins A'],['22','维生素B1','Vitamin B1'],['23','维生素B2','Vitamin B2'],['24','D或DL-泛酸（维生素B5）','D- or DL-pantothenic acid (vitamin B5)'],['25','维生素B6','Vitamin B6'],['26','维生素B12','Vitamin B12'],['27','维生素C','Vitamin C'],['28','维生素E','Vitamin E']];
for(const [sub,zh,en] of vitamins){
  additions.push({code:`2936.${sub}.00.10`,zh:`${zh}及其衍生物（未混合，食品饮料制造用）`,en:`${en} and derivatives (unmixed, for human food or beverage manufacture)`});
  additions.push({code:`2936.${sub}.00.90`,zh:`${zh}及其衍生物（未混合，其他用途）`,en:`${en} and derivatives (unmixed, other uses)`});
}
const holds=['2941.90.00.20'];
const expected=rows.filter(r=>Number(r.hs_code.slice(0,4))>=2935&&Number(r.hs_code.slice(0,4))<=2942&&!/[\u3400-\u9fff]/.test(r.name_zh)&&sources[r.hs_code]&&!holds.includes(r.hs_code));
assert.deepEqual(additions.map(x=>x.code).sort(),expected.map(x=>x.hs_code).sort());
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
