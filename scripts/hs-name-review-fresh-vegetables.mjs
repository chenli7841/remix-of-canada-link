import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
// Base names are reviewed per eight-digit item; leaf qualifiers remain explicit below.
const table=`
0701.10.00|种用马铃薯|Seed potatoes
0701.90.00|其他马铃薯|Other potatoes
0702.00.10|番茄（加工用）|Tomatoes (for processing)
0702.00.21|樱桃番茄（非加工用）|Cherry tomatoes (not for processing)
0702.00.29|樱桃番茄（非加工用，其他进口条件）|Cherry tomatoes (not for processing; other import conditions)
0702.00.91|其他番茄|Other tomatoes
0702.00.99|其他番茄（其他进口条件）|Other tomatoes (other import conditions)
0703.10.10|洋葱种球|Onion sets
0703.10.20|西班牙型洋葱（加工用）|Spanish-type onions (for processing)
0703.10.31|青洋葱及青葱头|Green onions or shallots
0703.10.39|青洋葱及青葱头（其他进口条件）|Green onions or shallots (other import conditions)
0703.10.41|干皮葱头|Dry shallots
0703.10.49|干皮葱头（其他进口条件）|Dry shallots (other import conditions)
0703.10.91|其他洋葱及葱头|Other onions and shallots
0703.10.99|其他洋葱及葱头（其他进口条件）|Other onions and shallots (other import conditions)
0703.90.00|韭葱及其他葱属蔬菜|Leeks and other alliaceous vegetables
0704.10.11|花椰菜及结球西兰花|Cauliflowers and head broccoli
0704.10.12|花椰菜及结球西兰花|Cauliflowers and head broccoli
0704.10.20|西兰花（加工用）|Broccoli (for processing)
0704.10.31|其他西兰花|Other broccoli
0704.10.39|其他西兰花（其他进口条件）|Other broccoli (other import conditions)
0704.10.90|花椰菜及西兰花（其他）|Cauliflowers and broccoli (other)
0704.20.11|抱子甘蓝|Brussels sprouts
0704.20.12|抱子甘蓝|Brussels sprouts
0704.20.90|抱子甘蓝（其他进口条件）|Brussels sprouts (other import conditions)
0704.90.31|结球甘蓝|Cabbage (Brassica oleracea capitata)
0704.90.39|结球甘蓝（其他进口条件）|Cabbage (other import conditions)
0704.90.41|大白菜及小白菜|Chinese cabbage and pak choi
0704.90.49|大白菜及小白菜（其他进口条件）|Chinese cabbage and pak choi (other import conditions)
0704.90.90|其他食用芸薹属蔬菜|Other edible brassicas
0705.11.11|结球生菜|Head lettuce
0705.11.12|结球生菜|Head lettuce
0705.11.90|结球生菜（其他进口条件）|Head lettuce (other import conditions)
0705.19.11|其他生菜|Other lettuce
0705.19.12|其他生菜|Other lettuce
0705.19.90|其他生菜（其他进口条件）|Other lettuce (other import conditions)
0705.21.00|比利时菊苣|Witloof chicory
0705.29.00|其他菊苣|Other chicory
0706.10.11|小胡萝卜（长度≤11厘米）|Baby carrots (length not exceeding 11 cm)
0706.10.12|小胡萝卜（长度≤11厘米）|Baby carrots (length not exceeding 11 cm)
0706.10.31|胡萝卜（非长度≤11厘米的小胡萝卜）|Carrots (other than baby carrots of length not exceeding 11 cm)
0706.10.32|胡萝卜（非长度≤11厘米的小胡萝卜）|Carrots (other than baby carrots of length not exceeding 11 cm)
0706.10.40|其他胡萝卜|Other carrots
0706.10.50|芜菁|Turnips
0706.90.10|食用甜菜（加工用）|Salad beetroot (for processing)
0706.90.21|其他食用甜菜|Other salad beetroot
0706.90.22|其他食用甜菜|Other salad beetroot
0706.90.30|其他食用甜菜（其他进口条件）|Other salad beetroot (other import conditions)
0706.90.40|婆罗门参及根芹|Salsify and celeriac
0706.90.51|萝卜|Radishes
0706.90.59|萝卜（其他进口条件）|Radishes (other import conditions)
0706.90.90|其他食用根菜|Other edible roots
0707.00.10|黄瓜及小黄瓜（加工用）|Cucumbers and gherkins (for processing)
0707.00.91|其他黄瓜及小黄瓜|Other cucumbers and gherkins
0707.00.99|其他黄瓜及小黄瓜（其他进口条件）|Other cucumbers and gherkins (other import conditions)
0708.10.10|豌豆（加工用）|Peas (for processing)
0708.10.91|其他豌豆|Other peas
0708.10.99|其他豌豆（其他进口条件）|Other peas (other import conditions)
0708.20.10|嫩荚菜豆（加工用）|Snap beans (for processing)
0708.20.21|其他嫩荚菜豆|Other snap beans
0708.20.22|其他嫩荚菜豆|Other snap beans
0708.20.30|嫩荚菜豆（其他进口条件）|Snap beans (other import conditions)
0708.20.90|其他菜豆及豇豆属豆类|Other beans (Vigna spp. and Phaseolus spp.)
0708.90.00|其他豆类蔬菜|Other leguminous vegetables
0709.20.10|芦笋（加工用）|Asparagus (for processing)
0709.20.91|其他芦笋|Other asparagus
0709.20.99|其他芦笋（其他进口条件）|Other asparagus (other import conditions)
0709.30.00|茄子|Aubergines (eggplants)
0709.40.11|芹菜（非根芹）|Celery other than celeriac
0709.40.12|芹菜（非根芹）|Celery other than celeriac
0709.40.90|芹菜（非根芹，其他进口条件）|Celery other than celeriac (other import conditions)
0709.56.00|松露（块菌属）|Truffles (Tuber spp.)
0709.60.10|辣椒属及多香果属果实|Fruits of Capsicum or Pimenta
0709.60.90|辣椒属及多香果属果实（其他进口条件）|Fruits of Capsicum or Pimenta (other import conditions)
0709.70.00|菠菜、番杏及庭园滨藜|Spinach, New Zealand spinach and orache spinach
0709.91.00|洋蓟|Globe artichokes
0709.92.00|橄榄|Olives
0709.93.00|南瓜属瓜类|Pumpkins, squash and gourds (Cucurbita spp.)
0709.99.11|欧芹|Parsley
0709.99.19|欧芹（其他进口条件）|Parsley (other import conditions)
0709.99.21|食用大黄|Rhubarb
0709.99.29|食用大黄（其他进口条件）|Rhubarb (other import conditions)
0709.99.31|带穗甜玉米|Sweet corn on the cob
0709.99.32|带穗甜玉米|Sweet corn on the cob
0709.99.40|其他带穗甜玉米|Other sweet corn on the cob
0709.99.90|其他蔬菜|Other vegetables
`;
const base=new Map(table.trim().split('\n').map(l=>{const[k,z,e]=l.split('|');return[k,[z,e]];}));
for(const[sub,z,e]of[['51','蘑菇（伞菌属）','Mushrooms (Agaricus spp.)'],['52','牛肝菌（牛肝菌属）','Mushrooms (Boletus spp.)'],['53','鸡油菌（鸡油菌属）','Mushrooms (Cantharellus spp.)'],['54','香菇','Shiitake'],['55','松茸（指定种类）','Matsutake (specified species)'],['59','其他蘑菇','Other mushrooms']]){
 base.set(`0709.${sub}.10`,[`${z}（加工用）`,`${e} (for processing)`]);
 base.set(`0709.${sub}.90`,[`${z}（其他用途）`,`${e} (other uses)`]);
}
base.set('0709.59.90',['其他蘑菇及松露（其他用途）','Other mushrooms and truffles (other uses)']);
const override={
 '0704.90.90.10':['意大利芜菁苗（拉皮尼）','Rapini'],
 '0706.90.90.10':['欧洲防风根','Parsnips'],
 '0706.90.90.20':['辣根','Horseradish'],
 '0708.20.90.10':['赤小豆','Adzuki beans'],
 '0709.99.90.20':['秋葵','Okra'],
 '0709.99.90.30':['竹笋、香菜等指定蔬菜','Bamboo shoots, cilantro and other specified vegetables'],
};
const held=rows.filter(r=>r.hs_code.startsWith('0706.10.20.')).map(r=>r.hs_code);
const additions=[];
for(const row of rows.filter(r=>/^070/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!held.includes(r.hs_code))){
 const code=row.hs_code,d=sources[code]?.description;assert.ok(d,code);
 const names=override[code]??base.get(code.slice(0,10));assert.ok(names,code);
 let[zh,en]=names;const zq=['鲜或冷藏'],eq=['fresh or chilled'];
 if(/not certified organic/i.test(d)){zq.push('未获有机认证');eq.push('not certified organic');}
 else if(/certified organic/i.test(d)){zq.push('已获有机认证');eq.push('certified organic');}
 else if((code.startsWith('0702.00.99.9')||['0707.00.99.80','0707.00.99.90','0709.60.90.80','0709.60.90.90'].includes(code))){zq.push('其他非有机认证类');eq.push('other than certified organic');}
 if(/greenhouse/i.test(d)){zq.push('温室种植');eq.push('greenhouse');}
 if(/Roma/.test(d)){zq.push('罗马型');eq.push('Roma');}
 if(/Imported during such period/i.test(d)){zq.push('规定进口期间');eq.push('specified import period');}
 const weight=d.match(/(?:In packages of a weight|of a weight) (not exceeding|exceeding) ([\d.]+) (kg|g) each/i);
 if(weight){const cmp=weight[1].toLowerCase()==='not exceeding';zq.push(`${/In bulk or/i.test(d)?'散装或':''}每包${cmp?'≤':'＞'}${weight[2]}${weight[3]==='kg'?'公斤':'克'}`);eq.push(`${/In bulk or/i.test(d)?'bulk or ':''}packages ${cmp?'not exceeding':'over'} ${weight[2]} ${weight[3]}`);}
 if(/Packaged fresh salad cut mixes/i.test(d)){zh='生菜混合鲜切沙拉';en='Lettuce fresh-cut salad mixes';zq.push('其他进口条件');eq.push('other import conditions');}
 // A leaf Other with no further organic/size qualifier still needs a visible distinction.
 if(code==='0709.70.00.19'||code==='0709.70.00.29'){zq.push('其他包装');eq.push('other packaging');}
 if(['0702.00.99.19','0702.00.99.99','0707.00.99.19','0707.00.99.90','0709.60.90.19','0709.60.90.90'].includes(code)){zq.push('其他类型');eq.push('other types');}
 additions.push({code,zh:`${zh}（${zq.join('，')}）`,en:`${en} (${eq.join('; ')})`});
}
for(const entry of additions){const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}; carrot source conflicts held: ${held.length}`);
