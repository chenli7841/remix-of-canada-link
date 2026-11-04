import fs from 'node:fs';
import ts from 'typescript';
import assert from 'node:assert/strict';
const out={};
new Function('exports',ts.transpileModule(fs.readFileSync('src/lib/prepare-photo.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(out);
let revoked=0,draws=0,fail=false,large=false,dimensions=[];
const originalURL=globalThis.URL;
globalThis.URL={createObjectURL:()=> 'blob:test',revokeObjectURL:()=>revoked++};
globalThis.Image=class {width=4000;height=3000;async decode(){if(fail)throw Error('decode');}};
globalThis.document={createElement:()=>({width:0,height:0,getContext(){return {fillRect(){},drawImage:()=>{draws++;dimensions.push([this.width,this.height]);}};},toDataURL(){return 'data:image/jpeg;base64,'+'A'.repeat(large?4000000:100);}})};
try {
 await assert.rejects(()=>out.preparePhoto({type:'application/pdf',size:10}),/照片/);
 await assert.rejects(()=>out.preparePhoto({type:'image/jpeg',size:26*1024*1024}),/25MB/);
 await out.preparePhoto({type:'image/jpeg',size:100});
 assert.deepEqual(dimensions[0],[1800,1350]);assert.equal(revoked,1);
 fail=true;await assert.rejects(()=>out.preparePhoto({type:'image/heic',size:100}),/兼容格式/);assert.equal(revoked,2);
 fail=false;large=true;await assert.rejects(()=>out.preparePhoto({type:'image/png',size:100}),/压缩后仍过大/);assert.equal(revoked,3);assert.equal(draws,6);
 console.log('PASS: oversized/non-image rejection, aspect-ratio resize, decode guidance, bounded compression retries, object URL cleanup');
}finally{globalThis.URL=originalURL;}
