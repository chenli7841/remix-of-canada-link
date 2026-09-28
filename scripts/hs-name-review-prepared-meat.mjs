import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const table=`
1601.00.11.00|禽肉香肠及类似制品（罐装或玻璃瓶装）|Poultry sausages and similar products (in cans or glass jars)
1601.00.19.00|其他香肠及类似制品（罐装或玻璃瓶装）|Other sausages and similar products (in cans or glass jars)
1601.00.21.00|鸡肉香肠及类似制品（非淘汰鸡，非罐瓶装）|Chicken sausages and similar products (other than spent fowl; not in cans or glass jars)
1601.00.22.00|鸡肉香肠及类似制品（非淘汰鸡，非罐瓶装）|Chicken sausages and similar products (other than spent fowl; not in cans or glass jars)
1601.00.23.00|淘汰鸡香肠及类似制品（非罐瓶装）|Spent-fowl sausages and similar products (not in cans or glass jars)
1601.00.31.00|火鸡香肠及类似制品（非罐瓶装）|Turkey sausages and similar products (not in cans or glass jars)
1601.00.32.00|火鸡香肠及类似制品（非罐瓶装）|Turkey sausages and similar products (not in cans or glass jars)
1601.00.90.10|猪肉香肠（其他包装）|Pork sausages (other packaging)
1601.00.90.20|其他香肠（鲜、冷藏或冷冻）|Other sausages (fresh, chilled or frozen)
1601.00.90.80|其他香肠（腌制）|Other sausages (cured)
1601.00.90.90|其他香肠类制品及其食品|Other sausage-like products and food preparations based on them
1602.10.10.00|鸡或火鸡均化肉制品|Homogenized chicken or turkey preparations
1602.10.90.00|其他均化肉类制品|Other homogenized meat preparations
1602.20.10.00|松露肝酱|Liver pate with truffles
1602.20.21.00|鸡肝酱（非罐瓶装）|Chicken liver paste (not in cans or glass jars)
1602.20.22.00|鸡肝酱（非罐瓶装）|Chicken liver paste (not in cans or glass jars)
1602.20.31.00|火鸡肝酱（非罐瓶装）|Turkey liver paste (not in cans or glass jars)
1602.20.32.00|火鸡肝酱（非罐瓶装）|Turkey liver paste (not in cans or glass jars)
1602.20.90.00|其他动物肝制品|Other prepared or preserved animal liver
1602.31.11.10|火鸡预制餐（特定混合物，罐瓶装）|Prepared turkey meals (specially defined mixtures; in cans or glass jars)
1602.31.11.90|火鸡预制餐（特定混合物，其他包装）|Prepared turkey meals (specially defined mixtures; other packaging)
1602.31.12.00|其他火鸡预制餐|Other prepared turkey meals
1602.31.13.00|其他火鸡预制餐（带骨）|Other prepared turkey meals (bone in)
1602.31.14.00|其他火鸡预制餐（去骨）|Other prepared turkey meals (boneless)
1602.31.91.00|其他火鸡制品（罐瓶装）|Other prepared or preserved turkey (in cans or glass jars)
1602.31.92.00|火鸡制品（特定混合物，非罐瓶装）|Prepared turkey (specially defined mixtures; not in cans or glass jars)
1602.31.93.00|其他火鸡制品|Other prepared or preserved turkey
1602.31.94.00|其他火鸡制品（带骨）|Other prepared or preserved turkey (bone in)
1602.31.95.00|其他火鸡制品（去骨）|Other prepared or preserved turkey (boneless)
1602.32.11.10|淘汰鸡预制餐|Prepared spent-fowl meals
1602.32.11.20|鸡肉预制餐（特定混合物）|Prepared chicken meals (specially defined mixtures)
1602.32.12.00|其他鸡肉预制餐|Other prepared chicken meals
1602.32.13.00|其他鸡肉预制餐（带骨）|Other prepared chicken meals (bone in)
1602.32.14.00|其他鸡肉预制餐（去骨）|Other prepared chicken meals (boneless)
1602.32.91.00|其他鸡肉制品（罐瓶装）|Other prepared or preserved chicken (in cans or glass jars)
1602.32.92.10|鸡肉制品（特定混合物，非罐瓶装）|Prepared chicken (specially defined mixtures; not in cans or glass jars)
1602.32.92.20|淘汰鸡制品（非罐瓶装）|Prepared spent fowl (not in cans or glass jars)
1602.32.93.00|其他鸡肉制品|Other prepared or preserved chicken
1602.32.94.00|其他鸡肉制品（带骨）|Other prepared or preserved chicken (bone in)
1602.32.95.00|其他鸡肉制品（去骨）|Other prepared or preserved chicken (boneless)
1602.39.10.00|其他禽肉预制餐|Prepared meals of other poultry
1602.39.91.00|鸭鹅或珍珠鸡制品（罐瓶装）|Prepared duck, goose or guinea fowl (in cans or glass jars)
1602.39.99.00|其他禽肉制品|Other prepared or preserved poultry
1602.41.10.00|猪后腿及切块制品（罐瓶装）|Prepared hams and cuts (in cans or glass jars)
1602.41.90.00|猪后腿及切块制品（其他包装）|Prepared hams and cuts (other packaging)
1602.42.10.00|猪前腿及切块制品（罐瓶装）|Prepared pork shoulders and cuts (in cans or glass jars)
1602.42.90.00|猪前腿及切块制品（其他包装）|Prepared pork shoulders and cuts (other packaging)
1602.49.10.10|其他猪肉及混合制品（罐瓶装）|Other prepared pork and mixtures (in cans or glass jars)
1602.49.10.20|其他猪肉预制餐|Other prepared pork meals
1602.49.90.00|其他猪肉及混合制品|Other prepared or preserved pork and mixtures
1602.50.10.00|牛肉预制餐|Prepared beef meals
1602.50.91.20|盐腌牛肉（罐瓶装）|Corned beef (in cans or glass jars)
1602.50.91.90|其他牛肉制品（罐瓶装）|Other prepared beef (in cans or glass jars)
1602.50.99.00|其他牛肉制品（非罐瓶装）|Other prepared or preserved beef (not in cans or glass jars)
1602.90.10.00|其他肉类或血制品预制餐|Other prepared meals of meat or blood preparations
1602.90.91.00|其他肉类或血制品（罐瓶装）|Other meat or blood preparations (in cans or glass jars)
1602.90.99.00|其他肉类或血制品（非罐瓶装）|Other meat or blood preparations (not in cans or glass jars)
1603.00.10.00|肉类提取物及肉汁|Meat extracts and juices
1603.00.20.00|鱼及水生无脊椎动物提取物和汁|Extracts and juices of fish and aquatic invertebrates
1604.12.10.00|鲱鱼制品（酸腌，整条或切块）|Prepared herring (pickled; whole or in pieces)
1604.12.90.00|其他鲱鱼制品（整条或切块）|Other prepared or preserved herring (whole or in pieces)
1604.13.10.00|沙丁鱼类制品（罐瓶装）|Prepared sardines, sardinella and sprats (in cans or glass jars)
1604.13.90.00|其他沙丁鱼类制品|Other prepared or preserved sardines, sardinella and sprats
1604.14.10.00|大西洋狐鲣制品|Prepared or preserved Atlantic bonito
1604.14.90.11|其他金枪鱼鲣鱼制品（含油，片状罐瓶装）|Other prepared tuna and bonito (in oil; flakes in cans or glass jars)
1604.14.90.19|其他金枪鱼鲣鱼制品（含油，其他形式）|Other prepared tuna and bonito (in oil; other forms)
1604.14.90.91|其他金枪鱼鲣鱼制品（非含油类，片状罐瓶装）|Other prepared tuna and bonito (not in oil; flakes in cans or glass jars)
1604.14.90.99|其他金枪鱼鲣鱼制品（非含油类，其他形式）|Other prepared tuna and bonito (not in oil; other forms)
1604.15.00.00|鲭鱼制品（整条或切块）|Prepared or preserved mackerel (whole or in pieces)
1604.16.10.00|鳀鱼制品（罐瓶装）|Prepared anchovies (in cans or glass jars)
1604.16.90.00|其他鳀鱼制品|Other prepared or preserved anchovies
1604.17.00.00|鳗鱼制品（整条或切块）|Prepared or preserved eels (whole or in pieces)
1604.18.00.00|鱼翅制品|Prepared or preserved shark fins
1604.19.10.00|小鱼苗制品（罐瓶装）|Prepared whitebait (in cans or glass jars)
1604.19.90.10|裹粉鱼条鱼片及鱼块|Breaded or battered fish sticks, fillets and portions
1604.19.90.91|其他鱼制品（预熟冷冻，整条或切块）|Other prepared fish (pre-cooked, frozen; whole or in pieces)
1604.19.90.99|其他鱼制品（整条或切块）|Other prepared or preserved fish (whole or in pieces)
1604.20.10.00|鱼类预制餐|Prepared fish meals
1604.20.20.00|犹太式鱼肉丸|Gefilte fish
1604.20.90.10|鱼肉酱制品|Prepared fish paste
1604.20.90.21|仿海鲜鱼制品（鲜）|Imitation seafood from fish (fresh)
1604.20.90.22|仿海鲜鱼制品（冷冻）|Imitation seafood from fish (frozen)
1604.20.90.80|其他鱼肉制品（预熟冷冻）|Other prepared fish products (pre-cooked, frozen)
1604.20.90.90|其他加工保藏鱼肉制品|Other prepared or preserved fish products
1604.31.00.00|鲟鱼子酱|Caviar
1604.32.00.00|鱼卵制代用鱼子酱|Caviar substitutes prepared from fish eggs
1605.10.00.10|蟹制品（罐瓶装）|Prepared crab (in cans or glass jars)
1605.10.00.20|蟹制品（冷冻）|Prepared or preserved crab (frozen)
1605.10.00.90|其他蟹制品|Other prepared or preserved crab
1605.21.00.20|虾制品（冷冻，非密封容器装）|Prepared shrimp and prawns (frozen; not in airtight containers)
1605.21.00.90|其他虾制品（非密封容器装）|Other prepared shrimp and prawns (not in airtight containers)
1605.29.00.00|虾制品（密封容器装）|Prepared shrimp and prawns (in airtight containers)
1605.30.10.00|龙虾肉（蒸煮去壳，未进一步加工）|Lobster (shelled, steamed or boiled; not further prepared)
1605.30.90.00|其他龙虾制品|Other prepared or preserved lobster
1605.40.10.00|螯虾制品（罐瓶装）|Prepared crayfish (in cans or glass jars)
1605.40.90.00|其他甲壳动物制品|Other prepared or preserved crustaceans
1605.51.00.00|牡蛎制品|Prepared or preserved oysters
1605.52.00.00|扇贝制品|Prepared or preserved scallops
1605.53.00.00|贻贝制品|Prepared or preserved mussels
1605.54.00.00|墨鱼及鱿鱼制品|Prepared or preserved cuttlefish and squid
1605.55.00.00|章鱼制品|Prepared or preserved octopus
1605.56.00.00|蛤蜊鸟蛤及蚶制品|Prepared or preserved clams, cockles and arkshells
1605.57.00.00|鲍鱼制品|Prepared or preserved abalone
1605.58.00.00|蜗牛制品（非海螺）|Prepared or preserved snails (other than sea snails)
1605.59.90.00|其他软体动物制品|Other prepared or preserved molluscs
1605.61.00.00|海参制品|Prepared or preserved sea cucumbers
1605.62.00.00|海胆制品|Prepared or preserved sea urchins
1605.63.00.00|海蜇制品|Prepared or preserved jellyfish
1605.69.00.00|其他水生无脊椎动物制品|Other prepared or preserved aquatic invertebrates
`;
const additions=table.trim().split('\n').map(line=>{
 let [code,zh,en]=line.split('|');const d=sources[code]?.description;assert.ok(d,code);
 if(/within access commitment/i.test(d)){zh+='（配额内）';en+=' (within access commitment)';}
 if(/over access commitment/i.test(d)){zh+='（配额外）';en+=' (over access commitment)';}
 return {code,zh,en};
});
assert.equal(additions.length,109);
assert.equal(new Set(additions.map(x=>x.code)).size,additions.length);
for(const entry of additions){assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);const old=reviewed.find(r=>r.code===entry.code);if(old)assert.deepEqual(old,entry);else reviewed.push(entry);}
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
