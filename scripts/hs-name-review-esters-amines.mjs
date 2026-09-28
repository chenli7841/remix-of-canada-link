import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2919.10.00.00|磷酸三(2,3-二溴丙基)酯|Tris(2,3-dibromopropyl) phosphate
2919.90.00.00|其他磷酸酯及其盐和衍生物|Other phosphoric esters, salts and derivatives
2920.11.00.00|对硫磷及甲基对硫磷|Parathion and parathion-methyl
2920.19.00.00|其他硫代磷酸酯及其盐和衍生物|Other thiophosphoric esters, salts and derivatives
2920.21.00.00|亚磷酸二甲酯|Dimethyl phosphite
2920.22.00.00|亚磷酸二乙酯|Diethyl phosphite
2920.23.00.00|亚磷酸三甲酯|Trimethyl phosphite
2920.24.00.00|亚磷酸三乙酯|Triethyl phosphite
2920.29.00.00|其他亚磷酸酯及其盐和衍生物|Other phosphite esters, salts and derivatives
2920.30.00.00|硫丹|Endosulfan
2920.90.00.00|其他非金属无机酸酯及其盐和衍生物（卤化氢酸酯除外）|Other esters of inorganic acids of non-metals, salts and derivatives (excluding hydrogen halide esters)
2921.11.00.00|一甲胺二甲胺三甲胺及其盐|Methylamine, dimethylamine, trimethylamine and their salts
2921.12.00.00|2-(N,N-二甲氨基)氯乙烷盐酸盐|2-(N,N-Dimethylamino)ethylchloride hydrochloride
2921.13.00.00|2-(N,N-二乙氨基)氯乙烷盐酸盐|2-(N,N-Diethylamino)ethylchloride hydrochloride
2921.14.00.00|2-(N,N-二异丙氨基)氯乙烷盐酸盐|2-(N,N-Diisopropylamino)ethylchloride hydrochloride
2921.19.00.70|N,N-二烷基-2-氯乙胺及其质子化盐（列名烷基）|N,N-Dialkyl-2-chloroethylamines and protonated salts (specified alkyl groups)
2921.19.00.90|其他无环单胺及其衍生物和盐|Other acyclic monoamines, derivatives and salts
2921.21.00.00|乙二胺及其盐|Ethylenediamine and its salts
2921.22.00.00|己二胺及其盐|Hexamethylenediamine and its salts
2921.29.00.00|其他无环多胺及其衍生物和盐|Other acyclic polyamines, derivatives and salts
2921.30.00.00|脂环单胺多胺及其衍生物和盐|Cyclanic, cyclenic or cycloterpenic mono- or polyamines, derivatives and salts
2921.41.00.00|苯胺及其盐|Aniline and its salts
2921.42.00.00|苯胺衍生物及其盐|Aniline derivatives and their salts
2921.43.00.00|甲苯胺及其衍生物和盐|Toluidines, derivatives and salts
2921.44.00.00|二苯胺及其衍生物和盐|Diphenylamine, derivatives and salts
2921.45.00.00|α-萘胺β-萘胺及其衍生物和盐|1-Naphthylamine, 2-naphthylamine, derivatives and salts
2921.46.00.00|安非他明等列名芳香单胺及其盐|Amfetamine and other specified aromatic monoamines and salts
2921.49.00.00|其他芳香单胺及其衍生物和盐|Other aromatic monoamines, derivatives and salts
2921.51.00.00|苯二胺二氨基甲苯及其衍生物和盐|Phenylenediamines, diaminotoluenes, derivatives and salts
2921.59.00.00|其他芳香多胺及其衍生物和盐|Other aromatic polyamines, derivatives and salts
2922.11.00.00|单乙醇胺及其盐|Monoethanolamine and its salts
2922.12.00.00|二乙醇胺及其盐|Diethanolamine and its salts
2922.14.00.00|右丙氧吩及其盐|Dextropropoxyphene and its salts
2922.15.00.00|三乙醇胺|Triethanolamine
2922.16.00.00|全氟辛基磺酸二乙醇铵|Diethanolammonium perfluorooctane sulphonate
2922.17.00.00|甲基二乙醇胺及乙基二乙醇胺|Methyldiethanolamine and ethyldiethanolamine
2922.18.00.00|2-(N,N-二异丙氨基)乙醇|2-(N,N-Diisopropylamino)ethanol
2922.19.00.11|二甲氨基乙醇及其质子化盐|N,N-Dimethyl-2-aminoethanol and protonated salts
2922.19.00.12|二乙氨基乙醇及其质子化盐|N,N-Diethyl-2-aminoethanol and protonated salts
2922.19.00.19|其他列名二烷氨基乙醇及其质子化盐|Other specified N,N-dialkyl-2-aminoethanols and protonated salts
2922.19.00.90|其他氨基醇及其醚酯和盐（无其他含氧基）|Other amino-alcohols, ethers, esters and salts (without other oxygen function)
2922.21.00.00|氨基羟基萘磺酸及其盐|Aminohydroxynaphthalenesulphonic acids and their salts
2922.29.00.00|其他氨基酚及其醚酯和盐（无其他含氧基）|Other amino-phenols, ethers, esters and salts (without other oxygen function)
2922.31.00.00|安非拉酮美沙酮去甲美沙酮及其盐|Amfepramone, methadone, normethadone and their salts
2922.39.00.00|其他氨基醛酮醌及其盐（无其他含氧基）|Other amino-aldehydes, amino-ketones, amino-quinones and salts (without other oxygen function)
2922.41.00.10|赖氨酸及其盐；饲料用赖氨酸酯及其盐|Lysine and its salts; lysine esters and their salts for animal or poultry feed manufacture
2922.41.00.90|其他赖氨酸酯及其盐（非上述饲料用）|Other lysine esters and their salts (other than specified feed manufacture)
2922.42.00.20|谷氨酸钠|Monosodium glutamate
2922.42.00.90|谷氨酸及其他谷氨酸盐|Glutamic acid and other glutamates
2922.43.00.00|邻氨基苯甲酸及其盐|Anthranilic acid and its salts
2922.44.00.00|替利定及其盐|Tilidine and its salts
2922.49.00.11|列名芳香氨基酸及其酯（苯丙氨酸等）|Specified aromatic amino-acids and esters (including L-phenylalanine)
2922.49.00.19|其他芳香氨基酸及其酯和盐（无其他含氧基）|Other aromatic amino-acids, esters and salts (without other oxygen function)
2922.49.00.20|乙二胺四乙酸及其衍生物|Edetic acid and its derivatives
2922.49.00.30|甘氨酸及其衍生物|Glycine and its derivatives
2922.49.00.40|氨三乙酸钠|Sodium nitrilotriacetate
2922.49.00.90|其他氨基酸及其酯和盐（无其他含氧基）|Other amino-acids, esters and salts (without other oxygen function)
2922.50.00.20|L-苏氨酸|L-Threonine
2922.50.00.90|其他含多种含氧基的氨基化合物|Other amino-compounds with multiple oxygen functions
2923.10.00.00|胆碱及其盐|Choline and its salts
2923.20.00.00|卵磷脂及其他磷氨基类脂|Lecithins and other phosphoaminolipids
2923.30.00.00|全氟辛基磺酸四乙基铵|Tetraethylammonium perfluorooctane sulphonate
2923.40.00.00|全氟辛基磺酸二癸基二甲基铵|Didecyldimethylammonium perfluorooctane sulphonate
2923.90.00.00|其他季铵盐及季铵碱|Other quaternary ammonium salts and hydroxides
2924.11.00.00|甲丙氨酯|Meprobamate
2924.12.00.00|氟乙酰胺久效磷及磷胺|Fluoroacetamide, monocrotophos and phosphamidon
2924.19.00.00|其他无环酰胺及其衍生物和盐|Other acyclic amides, derivatives and salts
2924.21.00.00|脲类及其衍生物和盐（环状酰胺类）|Ureines, derivatives and salts (cyclic amide category)
2924.23.00.00|N-乙酰邻氨基苯甲酸及其盐|N-Acetylanthranilic acid and its salts
2924.24.00.00|炔己蚁胺|Ethinamate
2924.25.00.00|甲草胺|Alachlor
2924.29.00.20|对乙酰氨基酚|Acetaminophen
2924.29.00.80|其他芳香酰胺及其衍生物和盐|Other aromatic amides, derivatives and salts
2924.29.00.90|其他非芳香环状酰胺及其衍生物和盐|Other non-aromatic cyclic amides, derivatives and salts
2925.11.00.10|糖精|Saccharin
2925.11.00.20|糖精盐|Salts of saccharin
2925.12.00.00|格鲁米特|Glutethimide
2925.19.00.00|其他酰亚胺及其衍生物和盐|Other imides, derivatives and salts
2925.21.00.00|杀虫脒|Chlordimeform
2925.29.00.00|其他亚胺及其衍生物和盐|Other imines, derivatives and salts
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
const holds=[];
const expected=rows.filter(r=>Number(r.hs_code.slice(0,4))>=2919&&Number(r.hs_code.slice(0,4))<=2925&&!/[\u3400-\u9fff]/.test(r.name_zh)&&sources[r.hs_code]&&!holds.includes(r.hs_code));
assert.deepEqual(additions.map(x=>x.code).sort(),expected.map(x=>x.hs_code).sort());
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
