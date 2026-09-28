import fs from 'node:fs';
import assert from 'node:assert/strict';
const rows=JSON.parse(fs.readFileSync('.hs-names.local/inventory.json','utf8'));
const sources=JSON.parse(fs.readFileSync('.hs-names.local/sources.json','utf8'));
const reviewed=JSON.parse(fs.readFileSync('scripts/hs-names-reviewed.json','utf8'));
const additions=[];
const add=(code,zh,en)=>additions.push({code,zh,en});
// Four preservation variants explicitly represented in the official hierarchy.
for(const [frozen,other,zh,en] of [
 ['0307.12','0307.19','牡蛎','Oysters'],
 ['0307.22','0307.29','扇贝及其他扇贝科贝类','Scallops and other Pectinidae'],
 ['0307.32','0307.39','贻贝（指定属）','Mussels (specified genera)'],
 ['0307.72','0307.79','蛤、鸟蛤及蚶（指定科）','Clams, cockles and ark shells (specified families)'],
 ['0307.83','0307.87','鲍鱼','Abalone'],
 ['0307.84','0307.88','凤凰螺（凤凰螺属）','Stromboid conchs (Strombus spp.)'],
 ['0307.92','0307.99','其他软体动物','Other molluscs'],
 ['0308.12','0308.19','海参','Sea cucumbers'],
 ['0308.22','0308.29','海胆（指定种类）','Sea urchins (specified species)'],
]){
 add(frozen+'.10.00',`${zh}（冷冻，熏制）`,`${en} (frozen; smoked)`);
 add(frozen+'.90.00',`${zh}（冷冻，非熏制）`,`${en} (frozen; not smoked)`);
 add(other+'.10.00',`${zh}（熏制，非冷冻）`,`${en} (smoked; not frozen)`);
 add(other+'.90.00',`${zh}（干制、盐腌或盐渍）`,`${en} (dried, salted or in brine)`);
}
const explicit=`
0307.11.10.00|牡蛎（活、鲜或冷藏，带壳）|Oysters (live, fresh or chilled; in shell)
0307.11.20.00|牡蛎（活、鲜或冷藏，去壳）|Oysters (live, fresh or chilled; shelled)
0307.21.00.10|扇贝及其他扇贝科贝类（活、鲜或冷藏，带壳）|Scallops and other Pectinidae (live, fresh or chilled; in shell)
0307.21.00.90|扇贝及其他扇贝科贝类（活、鲜或冷藏，其他）|Scallops and other Pectinidae (live, fresh or chilled; other)
0307.31.00.10|贻贝（活、鲜或冷藏，养殖）|Mussels (live, fresh or chilled; farmed)
0307.31.00.90|贻贝（活、鲜或冷藏，其他）|Mussels (live, fresh or chilled; other)
0307.42.00.00|墨鱼及鱿鱼（活、鲜或冷藏）|Cuttlefish and squid (live, fresh or chilled)
0307.43.00.10|墨鱼（冷冻）|Cuttlefish (frozen)
0307.43.00.20|鱿鱼（冷冻）|Squid (frozen)
0307.49.00.00|墨鱼及鱿鱼（干制、盐腌、盐渍或熏制）|Cuttlefish and squid (dried, salted, in brine or smoked)
0307.51.00.00|章鱼（活、鲜或冷藏）|Octopus (live, fresh or chilled)
0307.52.00.00|章鱼（冷冻）|Octopus (frozen)
0307.59.00.00|章鱼（干制、盐腌、盐渍或熏制）|Octopus (dried, salted, in brine or smoked)
0307.60.10.00|蜗牛（非海螺，熏制）|Snails other than sea snails (smoked)
0307.60.90.00|蜗牛（非海螺，其他状态）|Snails other than sea snails (other states)
0307.71.00.11|象拔蚌（活、鲜或冷藏，带壳）|Geoduck clams (live, fresh or chilled; in shell)
0307.71.00.19|象拔蚌（活、鲜或冷藏，其他）|Geoduck clams (live, fresh or chilled; other)
0307.71.00.21|其他蛤贝（活、鲜或冷藏，带壳）|Other clams (live, fresh or chilled; in shell)
0307.71.00.29|其他蛤贝（活、鲜或冷藏，其他）|Other clams (live, fresh or chilled; other)
0307.81.00.00|鲍鱼（活、鲜或冷藏）|Abalone (live, fresh or chilled)
0307.82.00.00|凤凰螺（活、鲜或冷藏，凤凰螺属）|Stromboid conchs (live, fresh or chilled; Strombus spp.)
0307.91.00.00|其他软体动物（活、鲜或冷藏）|Other molluscs (live, fresh or chilled)
0308.11.00.00|海参（活、鲜或冷藏）|Sea cucumbers (live, fresh or chilled)
0308.21.00.00|海胆（活、鲜或冷藏，指定种类）|Sea urchins (live, fresh or chilled; specified species)
0308.30.10.00|海蜇（熏制）|Jellyfish (Rhopilema spp.; smoked)
0308.30.90.00|海蜇（其他状态）|Jellyfish (Rhopilema spp.; other states)
0308.90.10.00|其他水生无脊椎动物（非甲壳及软体类，熏制）|Other aquatic invertebrates excluding crustaceans and molluscs (smoked)
0308.90.90.00|其他水生无脊椎动物（非甲壳及软体类，其他状态）|Other aquatic invertebrates excluding crustaceans and molluscs (other states)
0309.10.00.00|鱼粉及鱼颗粒（供人食用）|Fish flours, meals and pellets (fit for human consumption)
0309.90.10.00|甲壳动物粉及颗粒（供人食用）|Crustacean flours, meals and pellets (fit for human consumption)
0309.90.21.00|软体动物粉及颗粒（供人食用，熏制）|Mollusc flours, meals and pellets (fit for human consumption; smoked)
0309.90.29.00|软体动物粉及颗粒（供人食用，其他）|Mollusc flours, meals and pellets (fit for human consumption; other)
0309.90.91.00|其他水生无脊椎动物粉及颗粒（供人食用，熏制）|Other aquatic invertebrate flours, meals and pellets (fit for human consumption; smoked)
0309.90.99.00|其他水生无脊椎动物粉及颗粒（供人食用，其他）|Other aquatic invertebrate flours, meals and pellets (fit for human consumption; other)
`;
for(const line of explicit.trim().split('\n'))add(...line.split('|'));
assert.equal(additions.length,70);
assert.equal(new Set(additions.map(x=>x.code)).size,70);
for(const entry of additions){
 assert.ok(sources[entry.code],entry.code);
 assert.ok(rows.some(r=>r.hs_code===entry.code&&!/[\u3400-\u9fff]/.test(r.name_zh)),entry.code);
 const existing=reviewed.find(r=>r.code===entry.code);
 if(existing)assert.deepEqual(existing,entry);else reviewed.push(entry);
}
assert.equal(rows.filter(r=>/^030[789]/.test(r.hs_code)&&!/[\u3400-\u9fff]/.test(r.name_zh)&&!reviewed.some(x=>x.code===r.hs_code)).length,0);
fs.writeFileSync('scripts/hs-names-reviewed.json',JSON.stringify(reviewed,null,2)+'\n');
console.log(`Reviewed additions: ${additions.length}; total: ${reviewed.length}`);
