import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/delivery-city-groups.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Map,Set});
const rows = [
 {key:'a',city:' Toronto ',province:'ON',country:'CA',customer_code:'001',count:2},
 {key:'b',city:'toronto',province:'on',country:'ca',customer_code:'001',count:3},
 {key:'c',city:'Toronto',province:'BC',country:'CA',customer_code:'002',count:1},
 {key:'d',city:'',customer_code:'003',count:4},
 {key:'e',city:'Montréal',province:'QC',country:'CA',customer_code:'004',count:1},
 {key:'f',city:'Montreal',province:'QC',country:'CA',customer_code:'005',count:2},
];
const groups=exports.groupDeliveriesByCity(rows);
assert.equal(groups.length,4);
assert.equal(groups.at(-1).city,'未填写城市');
const toronto=groups.find(g=>g.city==='Toronto' && g.province==='ON');
assert.equal(toronto.rows.length,2);assert.equal(toronto.customers.size,1);assert.equal(toronto.count,5);
assert.equal(groups.find(g=>g.city==='Montréal').count,3);
assert.equal(groups.reduce((n,g)=>n+g.count,0),13);
assert.equal(rows[0].city,' Toronto ');
console.log('城市分组测试通过：大小写/空格/重音合并、跨省同名分开、客户去重、单位数保留、缺失城市置后。');
