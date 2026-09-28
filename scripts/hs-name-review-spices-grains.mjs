import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const additions=[];
function add(code,zh,en){
 const d=sources[code]?.description;assert.ok(d,code);
 const zs=[],es=[];
 if(/not certified organic/i.test(d)){zs.push('未获有机认证');es.push('not certified organic');}
 else if(/certified organic/i.test(d)){zs.push('已获有机认证');es.push('certified organic');}
 if(/within access commitment/i.test(d)){zs.push('配额内');es.push('within access commitment');}
 else if(/over access commitment/i.test(d)){zs.push('配额外');es.push('over access commitment');}
 additions.push({code,zh:zh+(zs.length?`（${zs.join('，')}）`:''),en:en+(es.length?` (${es.join('; ')})`:'')});
}
for(const[sub,zs,es]of[['11','未烘焙，未脱咖啡因','not roasted; not decaffeinated'],['21','已烘焙，未脱咖啡因','roasted; not decaffeinated']])for(const leaf of ['10','20'])add(`0901.${sub}.00.${leaf}`,`咖啡（${zs}）`,`Coffee (${es})`);
add('0901.12.00.00','咖啡（未烘焙，已脱咖啡因）','Coffee (not roasted; decaffeinated)');
add('0901.22.00.00','咖啡（已烘焙，已脱咖啡因）','Coffee (roasted; decaffeinated)');
add('0901.90.00.00','咖啡果壳、种皮及含咖啡代用品','Coffee husks, skins and substitutes containing coffee');
for(const[sub,zs,es]of[['10','单次饮用茶包','individual-serving bags'],['90','其他包装','other packaging']])for(const leaf of ['10','20'])add(`0902.10.${sub}.${leaf}`,`绿茶（未发酵，直接包装≤3公斤，${zs}）`,`Green tea (unfermented; immediate packing not exceeding 3 kg; ${es})`);
for(const leaf of ['10','20'])add(`0902.20.00.${leaf}`,'绿茶（未发酵，直接包装＞3公斤）','Green tea (unfermented; immediate packing over 3 kg)');
for(const[sub,zs,es]of[['10','单次饮用茶包','individual-serving bags'],['90','其他包装','other packaging']])for(const[leaf,zc,ec]of[['11','未脱咖啡因','not decaffeinated'],['12','未脱咖啡因','not decaffeinated'],['20','已脱咖啡因','decaffeinated']])add(`0902.30.${sub}.${leaf}`,`红茶及半发酵茶（直接包装≤3公斤，${zs}，${zc}）`,`Black and partly fermented tea (immediate packing not exceeding 3 kg; ${es}; ${ec})`);
for(const[leaf,zs,es]of[['10','未脱咖啡因','not decaffeinated'],['20','已脱咖啡因','decaffeinated']])add(`0902.40.00.${leaf}`,`红茶及半发酵茶（直接包装＞3公斤，${zs}）`,`Black and partly fermented tea (immediate packing over 3 kg; ${es})`);
const explicit=`
0903.00.00.00|马黛茶|Mate
0904.11.00.00|胡椒（未压碎或研磨）|Pepper (neither crushed nor ground)
0904.12.10.00|胡椒（压碎或研磨，加工用）|Pepper (crushed or ground; for processing)
0904.12.90.00|胡椒（压碎或研磨，其他用途）|Pepper (crushed or ground; other uses)
0904.21.00.00|辣椒及多香果属果实（干制，未压碎或研磨）|Capsicum and Pimenta fruits (dried; neither crushed nor ground)
0904.22.00.10|辣椒（压碎或研磨）|Chili peppers (crushed or ground)
0904.22.00.20|红甜椒（压碎或研磨）|Paprikas (crushed or ground)
0904.22.00.90|其他辣椒及多香果属果实（压碎或研磨）|Other Capsicum and Pimenta fruits (crushed or ground)
0905.10.00.00|香草（香荚兰，未压碎或研磨）|Vanilla (neither crushed nor ground)
0905.20.00.00|香草（香荚兰，压碎或研磨）|Vanilla (crushed or ground)
0906.11.00.00|锡兰肉桂（未压碎或研磨）|Ceylon cinnamon (neither crushed nor ground)
0906.19.00.00|其他肉桂及肉桂树花（未压碎或研磨）|Other cinnamon and cinnamon-tree flowers (neither crushed nor ground)
0906.20.00.00|肉桂及肉桂树花（压碎或研磨）|Cinnamon and cinnamon-tree flowers (crushed or ground)
0910.20.00.00|藏红花|Saffron
0910.30.00.00|姜黄|Turmeric (curcuma)
0910.91.00.00|混合香辛料（本章注释一乙所列）|Spice mixtures referred to in Chapter Note 1(b)
0910.99.00.00|其他香辛料|Other spices
1002.10.00.00|黑麦（种用）|Rye (seed)
1002.90.00.00|黑麦（其他）|Rye (other)
1004.10.00.00|燕麦（种用）|Oats (seed)
1004.90.00.00|燕麦（其他）|Oats (other)
1005.10.00.10|黄马齿型玉米（种用）|Yellow dent corn (seed)
1005.10.00.90|其他玉米（种用）|Other maize (seed)
1005.90.00.11|黄马齿型玉米（非种用，美国一级）|Yellow dent corn (other than seed; U.S. No. 1)
1005.90.00.12|黄马齿型玉米（非种用，美国二级）|Yellow dent corn (other than seed; U.S. No. 2)
1005.90.00.13|黄马齿型玉米（非种用，美国三级）|Yellow dent corn (other than seed; U.S. No. 3)
1005.90.00.19|黄马齿型玉米（非种用，其他等级）|Yellow dent corn (other than seed; other grades)
1005.90.00.91|爆裂玉米（非种用）|Popping corn (other than seed)
1005.90.00.99|其他玉米（非种用）|Other maize (other than seed)
1006.10.00.00|稻谷（带壳）|Rice in the husk (paddy)
1006.20.00.10|糙米（长粒）|Brown rice (long grain)
1006.20.00.20|糙米（中粒）|Brown rice (medium grain)
1006.20.00.30|糙米（短粒）|Brown rice (short grain)
1006.20.00.40|糙米（混合粒型）|Brown rice (mixed grain types)
1006.30.00.11|半精米或精米（蒸谷处理，长粒）|Semi-milled or wholly milled rice (parboiled; long grain)
1006.30.00.19|半精米或精米（蒸谷处理，其他含混合粒型）|Semi-milled or wholly milled rice (parboiled; other including mixtures)
1006.30.00.91|半精米或精米（其他，长粒）|Semi-milled or wholly milled rice (other; long grain)
1006.30.00.92|半精米或精米（其他，中粒）|Semi-milled or wholly milled rice (other; medium grain)
1006.30.00.93|半精米或精米（其他，短粒）|Semi-milled or wholly milled rice (other; short grain)
1006.30.00.94|半精米或精米（其他，混合粒型）|Semi-milled or wholly milled rice (other; mixed grain types)
1006.40.00.00|碎米|Broken rice
1007.10.00.00|高粱（种用）|Grain sorghum (seed)
1007.90.00.00|高粱（其他）|Grain sorghum (other)
1008.10.00.00|荞麦|Buckwheat
1008.21.00.00|黍粟类谷物（种用）|Millet (seed)
1008.29.00.00|黍粟类谷物（其他）|Millet (other)
1008.30.00.00|金丝雀草籽|Canary seeds
1008.40.00.00|福尼奥米（马唐属）|Fonio (Digitaria spp.)
1008.50.00.00|藜麦|Quinoa
1008.60.00.00|小黑麦|Triticale
1008.90.00.10|菰米（野米）|Wild rice
1008.90.00.90|其他谷物|Other cereals
`;
for(const line of explicit.trim().split('\n'))add(...line.split('|'));
for(const[p1,p2,zh,en]of[['0907.10','0907.20','丁香（含果实、花蕾及梗）','Cloves (whole fruit, cloves and stems)'],['0908.11','0908.12','肉豆蔻','Nutmeg'],['0908.21','0908.22','肉豆蔻衣','Mace'],['0908.31','0908.32','小豆蔻','Cardamoms'],['0909.21','0909.22','芫荽籽','Coriander seeds'],['0909.31','0909.32','孜然籽','Cumin seeds'],['0909.61','0909.62','茴芹、八角、葛缕子、茴香籽及杜松子','Anise, badian, caraway or fennel seeds and juniper berries'],['0910.11','0910.12','姜','Ginger']]){
 add(p1+'.00.00',`${zh}（未压碎或研磨）`,`${en} (neither crushed nor ground)`);
 add(p2+'.00.00',`${zh}（压碎或研磨）`,`${en} (crushed or ground)`);
}
for(const[sub,zh,en]of[['11','硬粒小麦（种用）','Durum wheat (seed)'],['19','硬粒小麦（其他）','Durum wheat (other)'],['91','其他小麦及混合麦（种用）','Other wheat and meslin (seed)'],['99','其他小麦及混合麦（非种用）','Other wheat and meslin (other than seed)']])for(const q of ['10','20'])add(`1001.${sub}.${q}.00`,zh,en);
for(const[sub,zs,es]of[['10','种用','seed'],['90','非种用','other than seed']])for(const[tail,zu,eu]of[['11','麦芽用途','for malting'],['12','麦芽用途','for malting'],['91','其他用途','other uses'],['92','其他用途','other uses']])add(`1003.${sub}.${tail}.00`,`大麦（${zs}，${zu}）`,`Barley (${es}; ${eu})`);
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
const missing=rows.filter(r=>/^(09|10)/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!reviewed.some(x=>x.code===r.hs_code));assert.equal(missing.length,0,JSON.stringify(missing.map(x=>x.hs_code)));
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
