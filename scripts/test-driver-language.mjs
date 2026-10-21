import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const require=createRequire(import.meta.url);
function load(path,mocks={}){
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{crypto:globalThis.crypto,module,exports:module.exports,require:id=>mocks[id]??require(id)});
 return module.exports;
}
const dict=load('src/lib/driver-translations.ts');
const {translateDriver:t}=load('src/lib/driver-language.tsx',{'./driver-translations':dict});
test('driver navigation, camera and delivery actions translate both ways',()=>{
 for(const key of ['司机派送','货物上车','相机扫码','拍照上传','收款','登录']){
  assert.notEqual(t('en',key),key);assert.equal(t('zh',t('en',key)),key);
 }
});
test('dynamic delivery confirmation keeps the exact unit count',()=>{
 const key='确认派送 {0} 个单位？运单将完成，并记录已派送及晚30秒的已完成轨迹。';
 const en=t('en',key,3);
 assert.match(en,/3 units/);assert.match(en,/30 seconds/);
 assert.equal(t('zh',en),t('zh',key,3));
});
test('changing language translates existing barcode feedback without changing barcode',()=>{
 const key='已识别：{0}，继续扫描下一件。';
 const zh=t('zh',key,'SCTG08634260922000');
 assert.equal(t('en',zh),'Scanned: SCTG08634260922000. Continue with the next parcel.');
 assert.equal(t('zh',t('en',zh)),zh);
});
test('missing values and customer data remain unchanged',()=>{
 for(const value of ['', ' ', '08634', '255B Lissington DR SW Calgary', '客户自己填写的备注']){
  assert.equal(t('en',value),value);assert.equal(t('zh',value),value);
 }
});
test('dictionary preserves every dynamic placeholder',()=>{
 for(const [zh,en] of Object.entries(dict.driverEnglish)){
  assert.deepEqual((zh.match(/\{\d+\}/g)||[]).sort(),(en.match(/\{\d+\}/g)||[]).sort(),zh);
 }
});
test('driver role error is actionable in English',()=>{
 assert.match(t('en','仅派送司机可以使用此页面，请联系管理员分配司机角色'),/administrator/);
});
test('driver home renders both languages without changing data-loading keys',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
 for(const language of ['zh','en']){
  const {DriverWorkspace}=load('src/components/DriverWorkspace.tsx',{
   '@tanstack/react-query':{useQuery:()=>({data:[]})},
   '@tanstack/react-start':{useServerFn:()=>async()=>[]},
   '@/lib/driver-trips.functions':{},'@/lib/delivery-route.functions':{},'@/lib/driver.functions':{},
   '@/components/LoadingUnitList':{LoadingUnitList:()=>null},'@/components/admin/CameraScanButton':{},'@/components/admin/DeliveryBatchPhotos':{},
   '@/lib/delivery-sheet':{},'@/lib/auth':{useAuth:()=>({user:{id:'driver'}})},
   '@/lib/driver-language':{useDriverLanguage:()=>({t:(text,...args)=>t(language,text,...args),date:String,money:String})},
  });
  const html=renderToStaticMarkup(React.createElement(DriverWorkspace));
  assert.ok(html.includes(language==='en'?'Driver workspace':'司机工作台'));
  assert.ok(html.includes(language==='en'?'Load parcels':'货物上车'));
  assert.ok(html.includes(language==='en'?'Driver delivery':'司机派送'));
 }
});
