import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';
const require=createRequire(import.meta.url);
function render(data,search=''){
 const module={exports:{}};
 const mocks={'@tanstack/react-start':{useServerFn:()=>()=>{}},'@tanstack/react-query':{useQuery:()=>({data,isLoading:false,isError:false})},'@tanstack/react-router':{Link:({children})=>React.createElement('a',null,children)},'@/lib/admin-driver-trips.functions':{listAdminLoadedTrips:()=>{}}};
 vm.runInNewContext(ts.transpileModule(readFileSync('src/components/admin/LoadedDeliveryTrips.tsx','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module,exports:module.exports,require:id=>mocks[id]??require(id)});
 return renderToStaticMarkup(React.createElement(module.exports.LoadedDeliveryTrips,{search}));
}
const trip=(id,completed,pending,cancelled=0)=>({id,driver_name:id,created_at:'2026-10-20T12:00:00Z',source:'scan',completed,pending,cancelled,total:completed+pending+cancelled,items:[{id:'unit'+id,unit:{code:'CODE-'+id,customer_code:'06642',status:'pending',batch:{batch_no:'B123'}}}]});
test('completed trips hidden, active and cancelled counts visible',()=>{const html=render([trip('active',1,2,1),trip('done',3,0)]);assert.match(html,/CODE-active/);assert.doesNotMatch(html,/CODE-done/);assert.match(html,/已派送 1/);assert.match(html,/未派送 2/);assert.match(html,/总单 4/);assert.match(html,/已取消 1/);});
test('search matches unit and driver, filters unrelated trips',()=>{const html=render([trip('alice',0,1),trip('bob',0,1)],'CODE-bob');assert.match(html,/CODE-bob/);assert.doesNotMatch(html,/CODE-alice/);});
