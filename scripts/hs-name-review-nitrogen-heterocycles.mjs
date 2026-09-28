import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
2933.11.00.00|安替比林及其衍生物|Phenazone (antipyrin) and its derivatives
2933.19.00.00|其他含非稠合吡唑环的含氮杂环化合物|Other nitrogen heterocyclic compounds containing an unfused pyrazole ring
2933.21.00.00|乙内酰脲及其衍生物|Hydantoin and its derivatives
2933.29.00.00|其他含非稠合咪唑环的含氮杂环化合物|Other nitrogen heterocyclic compounds containing an unfused imidazole ring
2933.31.00.00|吡啶及其盐|Pyridine and its salts
2933.32.00.00|哌啶及其盐|Piperidine and its salts
2933.33.00.00|芬太尼等列名含氮杂环化合物及其盐|Fentanyl and other specified nitrogen heterocyclic compounds and salts
2933.34.00.00|其他芬太尼类及其衍生物（仅含氮杂原子）|Other fentanyls and derivatives (nitrogen hetero-atoms only)
2933.35.00.00|奎宁环-3-醇|3-Quinuclidinol
2933.36.00.00|4-苯胺基-N-苯乙基哌啶|4-Anilino-N-phenethylpiperidine (ANPP)
2933.37.00.00|N-苯乙基-4-哌啶酮|N-Phenethyl-4-piperidone (NPP)
2933.39.00.50|其他同时含吡啶环与其他含氮杂环的化合物|Other compounds containing a pyridine ring and other nitrogen heterocyclic rings
2933.39.00.69|其他仅以吡啶环为杂环的化合物|Other compounds with a pyridine ring as the only heterocyclic ring
2933.39.00.91|二苯乙醇酸-3-奎宁环酯|3-Quinuclidinyl benzilate
2933.39.00.99|其他未列名含非稠合吡啶环的含氮杂环化合物|Other nitrogen heterocyclic compounds with an unfused pyridine ring, not elsewhere specified
2933.41.00.00|左啡诺及其盐|Levorphanol and its salts
2933.49.00.00|其他含未进一步稠合喹啉或异喹啉环系的化合物|Other compounds with a quinoline or isoquinoline ring-system, not further fused
2933.52.00.00|巴比妥酸及其盐|Malonylurea (barbituric acid) and its salts
2933.53.00.00|列名巴比妥类及其盐|Specified barbiturates and their salts
2933.54.00.00|其他巴比妥酸衍生物及其盐|Other barbituric acid derivatives and their salts
2933.59.00.11|阿昔洛韦|Acyclovir
2933.59.00.19|其他含嘧啶环的含氮杂环化合物|Other nitrogen heterocyclic compounds containing a pyrimidine ring
2933.61.00.00|三聚氰胺|Melamine
2933.69.00.10|三氯异氰尿酸|Trichloroisocyanuric acid
2933.69.00.90|其他含非稠合三嗪环的含氮杂环化合物|Other nitrogen heterocyclic compounds containing an unfused triazine ring
2933.71.00.10|己内酰胺（制造聚己内酰胺用）|Epsilon-caprolactam for polycaprolactam manufacture
2933.71.00.90|己内酰胺（其他用途）|Epsilon-caprolactam (other uses)
2933.79.00.00|其他内酰胺|Other lactams
2933.91.00.00|阿普唑仑等列名含氮杂环化合物及其盐|Alprazolam and other specified nitrogen heterocyclic compounds and salts
2933.92.00.00|甲基谷硫磷|Azinphos-methyl
2933.99.00.10|其他含氮杂环化合物（列名制造用途）|Other nitrogen heterocyclic compounds for specified manufacturing uses
2933.99.00.20|其他含非稠合五元杂环的含氮化合物|Other nitrogen heterocyclic compounds containing an unfused five-membered heterocyclic ring
2933.99.00.30|其他含三环体系的含氮杂环化合物|Other nitrogen heterocyclic compounds with a tricyclic ring system
2933.99.00.90|其他未列名仅含氮杂原子的杂环化合物|Other heterocyclic compounds with nitrogen hetero-atoms only, not elsewhere specified
2934.10.00.00|含非稠合噻唑环的化合物|Compounds containing an unfused thiazole ring
2934.20.00.00|含未进一步稠合苯并噻唑环系的化合物|Compounds with a benzothiazole ring-system, not further fused
2934.30.00.00|含未进一步稠合吩噻嗪环系的化合物|Compounds with a phenothiazine ring-system, not further fused
2934.92.00.00|其他芬太尼类及其衍生物（其他杂环类）|Other fentanyls and derivatives (other heterocyclic category)
2934.99.00.10|核酸核苷核苷酸及其盐（合成寡核苷酸除外）|Nucleic acids, nucleosides, nucleotides and salts (excluding synthetic oligonucleotides and their salts)
2934.99.00.90|其他未列名杂环化合物及核酸类产品|Other heterocyclic compounds and nucleic-acid products, not elsewhere specified
`;
const additions=table.trim().split('\n').map(line=>{const[code,zh,en]=line.split('|');return{code,zh,en};});
const holds=['2933.39.00.61','2933.39.00.62','2933.55.00.00','2933.59.00.20','2933.72.00.00','2934.91.00.00'];
const expected=rows.filter(r=>Number(r.hs_code.slice(0,4))>=2933&&Number(r.hs_code.slice(0,4))<=2934&&!/[\u3400-\u9fff]/.test(r.name_zh)&&sources[r.hs_code]&&!holds.includes(r.hs_code));
assert.deepEqual(additions.map(x=>x.code).sort(),expected.map(x=>x.hs_code).sort());
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
