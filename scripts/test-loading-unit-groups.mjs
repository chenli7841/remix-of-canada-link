import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {test} from 'node:test';
import assert from 'node:assert/strict';
function load(path,mocks={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,require:id=>mocks[id]});return module.exports;}
const cities=load('src/lib/delivery-city-groups.ts');
const {groupLoadingUnits:group}=load('src/lib/loading-unit-groups.ts',{'./delivery-city-groups':cities});
const unit=(id,city,code,sequence)=>({id,city,province:'ON',country:'CA',sequence,unit:{customer_code:code,code:id}});
test('city then numeric customer order, preserving scan sequence',()=>{const rows=[unit('a','Toronto','20',1),unit('b','Markham','10',9),unit('c','Markham','2',7),unit('d','Markham','2',3)];const result=group(rows);assert.equal(result[0].city,'Markham');assert.deepEqual(Array.from(result[0].customerGroups,g=>g.code),['2','10']);assert.deepEqual(Array.from(result[0].customerGroups[0].units,u=>u.sequence),[3,7]);assert.equal(rows[0].sequence,1);});
test('missing city last and unnumbered units stay unnumbered',()=>{const result=group([unit('a',null,'1',null),unit('b','Toronto','2',4)]);assert.equal(result[1].city,'未填写城市');assert.equal(result[1].customerGroups[0].units[0].sequence,null);});
