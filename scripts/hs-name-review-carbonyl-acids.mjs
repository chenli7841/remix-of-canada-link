import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2911.00.00.00|缩醛半缩醛及其衍生物|Acetals, hemiacetals and derivatives
2912.11.00.00|甲醛|Formaldehyde
2912.12.00.00|乙醛|Acetaldehyde
2912.19.00.00|其他无环醛（无其他含氧基）|Other acyclic aldehydes (without other oxygen function)
2912.21.00.00|苯甲醛|Benzaldehyde
2912.29.00.00|其他环醛（无其他含氧基）|Other cyclic aldehydes (without other oxygen function)
2912.41.00.00|香兰素|Vanillin
2912.42.00.00|乙基香兰素|Ethylvanillin
2912.49.00.00|其他含氧官能基醛（醛醇醛醚等）|Other aldehydes with additional oxygen function
2912.50.00.00|醛的环状聚合物|Cyclic polymers of aldehydes
2912.60.00.00|多聚甲醛|Paraformaldehyde
2913.00.00.00|醛类卤化磺化硝化及亚硝化衍生物|Halogenated, sulphonated, nitrated or nitrosated aldehyde derivatives
2914.11.00.00|丙酮|Acetone
2914.12.00.00|丁酮（甲乙酮）|Butanone (methyl ethyl ketone)
2914.13.00.00|甲基异丁基酮|Methyl isobutyl ketone
2914.19.00.00|其他无环酮（无其他含氧基）|Other acyclic ketones (without other oxygen function)
2914.22.00.00|环己酮及甲基环己酮|Cyclohexanone and methylcyclohexanones
2914.23.00.00|紫罗兰酮及甲基紫罗兰酮|Ionones and methylionones
2914.29.00.00|其他脂环酮（无其他含氧基）|Other cyclanic, cyclenic or cycloterpenic ketones (without other oxygen function)
2914.31.00.00|苯丙酮|Phenylacetone
2914.39.00.00|其他芳香酮（无其他含氧基）|Other aromatic ketones (without other oxygen function)
2914.40.00.00|酮醇及酮醛|Ketone-alcohols and ketone-aldehydes
2914.50.00.00|酮酚及其他含氧官能基酮|Ketone-phenols and ketones with other oxygen function
2914.61.00.00|蒽醌|Anthraquinone
2914.62.00.00|辅酶Q10|Coenzyme Q10
2914.69.00.00|其他醌|Other quinones
2914.71.00.00|十氯酮|Chlordecone
2914.79.00.00|其他酮醌卤化磺化硝化衍生物|Other halogenated, sulphonated, nitrated or nitrosated ketone and quinone derivatives
2915.11.00.00|甲酸|Formic acid
2915.12.00.00|甲酸盐|Formates
2915.13.00.00|甲酸酯|Esters of formic acid
2915.21.00.00|乙酸|Acetic acid
2915.24.00.00|乙酸酐|Acetic anhydride
2915.29.00.00|其他乙酸盐|Other acetates
2915.31.00.00|乙酸乙酯|Ethyl acetate
2915.32.00.00|乙酸乙烯酯|Vinyl acetate
2915.33.00.00|乙酸正丁酯|n-Butyl acetate
2915.36.00.00|地乐酚乙酸酯|Dinoseb acetate
2915.39.00.00|其他乙酸酯|Other esters of acetic acid
2915.40.00.00|一氯二氯三氯乙酸及其盐和酯|Mono-, di- or trichloroacetic acids, salts and esters
2915.50.00.30|丙酸|Propionic acid
2915.50.00.90|丙酸盐及丙酸酯|Salts and esters of propionic acid
2915.60.00.00|丁酸戊酸及其盐和酯|Butanoic and pentanoic acids, salts and esters
2915.70.00.00|棕榈酸硬脂酸及其盐和酯|Palmitic and stearic acids, salts and esters
2915.90.00.10|全氟辛酸及其盐|Perfluorooctanoic acids and their salts
2915.90.00.90|其他饱和无环一元羧酸及衍生物|Other saturated acyclic monocarboxylic acids and derivatives
2916.11.00.00|丙烯酸及其盐|Acrylic acid and its salts
2916.12.00.10|丙烯酸丁酯|Butyl acrylate
2916.12.00.20|丙烯酸乙酯|Ethyl acrylate
2916.12.00.30|丙烯酸异辛酯|2-Ethylhexyl acrylate
2916.12.00.90|其他丙烯酸酯|Other acrylic acid esters
2916.13.00.00|甲基丙烯酸及其盐|Methacrylic acid and its salts
2916.14.00.40|甲基丙烯酸甲酯|Methyl methacrylate
2916.14.00.90|其他甲基丙烯酸酯|Other methacrylic acid esters
2916.15.00.00|油酸亚油酸亚麻酸及其盐和酯|Oleic, linoleic or linolenic acids, salts and esters
2916.19.00.30|山梨酸钾|Potassium sorbate
2916.19.00.90|其他不饱和无环一元羧酸及衍生物|Other unsaturated acyclic monocarboxylic acids and derivatives
2916.20.00.00|脂环一元羧酸及其衍生物|Cyclanic, cyclenic or cycloterpenic monocarboxylic acids and derivatives
2916.31.00.00|苯甲酸及其盐和酯|Benzoic acid, salts and esters
2916.32.00.00|过氧化苯甲酰及苯甲酰氯|Benzoyl peroxide and benzoyl chloride
2916.34.00.00|苯乙酸及其盐|Phenylacetic acid and its salts
2916.39.00.00|其他芳香一元羧酸及衍生物|Other aromatic monocarboxylic acids and derivatives
2917.11.00.00|草酸及其盐和酯|Oxalic acid, salts and esters
2917.12.00.00|己二酸及其盐和酯|Adipic acid, salts and esters
2917.13.00.00|壬二酸癸二酸及其盐和酯|Azelaic and sebacic acids, salts and esters
2917.14.00.00|马来酸酐|Maleic anhydride
2917.19.00.00|其他无环多元羧酸及衍生物|Other acyclic polycarboxylic acids and derivatives
2917.20.00.00|脂环多元羧酸及其衍生物|Cyclanic, cyclenic or cycloterpenic polycarboxylic acids and derivatives
2917.32.00.00|邻苯二甲酸二辛酯|Dioctyl orthophthalates
2917.33.00.10|邻苯二甲酸二异壬酯|Diisononyl orthophthalate
2917.33.00.90|其他邻苯二甲酸二壬酯或二癸酯|Other dinonyl or didecyl orthophthalates
2917.34.00.00|其他邻苯二甲酸酯|Other orthophthalic acid esters
2917.35.00.00|邻苯二甲酸酐|Phthalic anhydride
2917.36.00.00|对苯二甲酸及其盐|Terephthalic acid and its salts
2917.37.00.00|对苯二甲酸二甲酯|Dimethyl terephthalate
2917.39.00.10|偏苯三酸酐|Trimellitic anhydride
2917.39.00.20|间苯二甲酸|Isophthalic acid
2917.39.00.90|其他芳香多元羧酸及衍生物|Other aromatic polycarboxylic acids and derivatives
2918.11.00.10|乳酸|Lactic acid
2918.11.00.20|乳酸盐|Lactates
2918.11.00.30|乳酸酯|Esters of lactic acid
2918.12.00.00|酒石酸|Tartaric acid
2918.13.00.00|酒石酸盐及酒石酸酯|Salts and esters of tartaric acid
2918.14.00.00|柠檬酸|Citric acid
2918.15.00.40|柠檬酸酯|Esters of citric acid
2918.15.00.90|其他柠檬酸盐|Other citrates
2918.16.00.30|葡萄糖酸酯|Esters of gluconic acid
2918.16.00.90|葡萄糖酸及其盐|Gluconic acid and its salts
2918.17.00.00|二苯羟乙酸|Benzilic acid
2918.19.00.00|其他醇酸及衍生物（无其他含氧基）|Other alcohol-function carboxylic acids and derivatives (without other oxygen function)
2918.21.00.00|水杨酸及其盐|Salicylic acid and its salts
2918.22.00.00|乙酰水杨酸及其盐和酯|O-Acetylsalicylic acid, salts and esters
2918.23.00.00|其他水杨酸酯及其盐|Other salicylic acid esters and their salts
2918.29.00.00|其他酚酸及衍生物（无其他含氧基）|Other phenol-function carboxylic acids and derivatives (without other oxygen function)
2918.30.00.00|醛酸酮酸及衍生物（无其他含氧基）|Aldehyde- or ketone-function carboxylic acids and derivatives (without other oxygen function)
2918.91.00.00|2,4,5-三氯苯氧乙酸及其盐和酯|2,4,5-Trichlorophenoxyacetic acid, salts and esters
2918.99.00.10|2,4-二氯苯氧乙酸及其盐和酯|2,4-Dichlorophenoxyacetic acid, salts and esters
2918.99.00.20|2-甲基-4-氯苯氧乙酸及其盐和酯|2-Methyl-4-chlorophenoxyacetic acid, salts and esters
2918.99.00.90|其他含氧官能基羧酸及衍生物|Other carboxylic acids with additional oxygen function and derivatives
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
const holds=['2916.16.00.00','2918.18.00.00'];
const expected=rows.filter(r=>Number(r.hs_code.slice(0,4))>=2911&&Number(r.hs_code.slice(0,4))<=2918&&!/[\u3400-\u9fff]/.test(r.name_zh)&&sources[r.hs_code]&&!holds.includes(r.hs_code));
assert.deepEqual(additions.map(x=>x.code).sort(),expected.map(x=>x.hs_code).sort());
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
