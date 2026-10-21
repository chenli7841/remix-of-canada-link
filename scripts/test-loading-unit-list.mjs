import {readFileSync} from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import {createRequire} from 'node:module';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {test} from 'node:test';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);function load(path,mocks={}){const module={exports:{}};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require:id=>mocks[id]??require(id)});return module.exports;}
const groups=load('src/lib/loading-unit-groups.ts',{'./delivery-city-groups':load('src/lib/delivery-city-groups.ts')});const {LoadingUnitList}=load('src/components/LoadingUnitList.tsx',{'@/lib/loading-unit-groups':groups,'@/lib/driver-language':{useDriverLanguage:()=>({t:x=>x})}});
test('loading UI hides delivered, repeats domestic numbers and offers city/customer/address/box selection',()=>{const base={city:'Toronto',customer_code:'01234',address:'123 Main St',sequence:7,domestic_numbers:['SF1','SF1']};const html=renderToStaticMarkup(React.createElement(LoadingUnitList,{selected:new Set(),onSelect:()=>{},items:[{...base,id:'a',unit:{id:'a',kind:'waybill',code:'BOX-A',customer_code:'01234',status:'pending'}},{...base,id:'b',unit:{id:'b',code:'BOX-DELIVERED',customer_code:'01234',status:'dispatched'}}]}));assert.match(html,/123 Main St/);assert.match(html,/勾选城市/);assert.match(html,/勾选客户/);assert.match(html,/勾选客户 01234 地址 123 Main St/);assert.equal((html.match(/type="checkbox"/g)||[]).length,3);assert.match(html,/勾选箱子/);assert.doesNotMatch(html,/BOX-DELIVERED/);assert.equal((html.match(/SF1/g)||[]).length,2);});
test('selection count stays outside scroll region and excludes unavailable parcels',()=>{
 const items=[{id:'a',unit:{id:'a',code:'A',status:'pending'}},{id:'b',unit:{id:'b',code:'B',status:'dispatched'}},{id:'c',delivery_run_id:'run',unit:{id:'c',code:'C',status:'pending'}}];
 const render=selected=>renderToStaticMarkup(React.createElement(LoadingUnitList,{items,selected:new Set(selected),onSelect:()=>{}}));
 const html=render(['a','b','c','missing']);
 assert.ok(html.indexOf('已选包裹')<html.indexOf('role="region"'));
 assert.match(html,/text-amber-300">1<\/strong> \/ 1/);
 assert.match(render([]),/text-amber-300">0<\/strong> \/ 1/);
 assert.match(html,/overflow-y-auto/);assert.match(html,/overscroll-contain/);
});

test('container cards hide domestic numbers even when stale data is present',()=>{
 const html=renderToStaticMarkup(React.createElement(LoadingUnitList,{items:[{id:'c',sequence:24,domestic_numbers:['HIDDEN123'],unit:{id:'c',kind:'carton',code:'36904-2',status:'pending'}}]}));
 assert.doesNotMatch(html,/HIDDEN123|国内单号/);assert.match(html,/row-span-2/);assert.doesNotMatch(html,/lg:grid-cols-2/);
});
